"""Local WebSocket gateway between Asterisk and Gemini Live."""

import asyncio
from contextlib import closing
from datetime import datetime, timezone
import hmac
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import wave
from time import monotonic
from uuid import uuid4

from aiohttp import BasicAuth, web
from cryptography.fernet import Fernet

from asterisk_media import AsteriskMedia, ConversationAudio, Disconnected
from call_monitor import encode_wav
from forms_export import FormsExporter
from live_call import CallOutcome, run_live_call
from phone_decisions import MONITOR_RULES, classify_call
from phone_menu import MODELS, CONSENT_VERSION, DEFAULT_THRESHOLDS
from phone_users import normalize_number
from news_feeds import NewsFeeds

LOGGER = logging.getLogger("phone-gateway")
PROMPTS = (
    "opening", "models", "unknown-caller", "consent", "privacy", "policy-stop", "quota",
    "connection-error", "model-unavailable", "call-limit",
)
GATEWAY = web.AppKey("gateway", object)


def load_prompt(path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 8000):
            raise ValueError(f"{path.name}: expected 8 kHz mono PCM16 WAV")
        source = audio.readframes(audio.getnframes())
        if not source or len(source) > 180 * 16000:
            raise ValueError(f"{path.name}: invalid prompt length")
    # Each 8 kHz PCM sample plays for two samples in the 16 kHz channel.
    return b"".join(source[i:i + 2] * 2 for i in range(0, len(source), 2))


class Gateway:
    def __init__(self, roster, cipher, password, prompts, thresholds, report_db, *, call_seconds=480, capacity=8, forms=None):
        self.roster = roster
        self.cipher = cipher
        self.password = password
        self.prompts = prompts
        self.thresholds = thresholds
        self.report_db = report_db
        self.call_seconds = call_seconds
        self.capacity = capacity
        self.forms = forms
        self.news = NewsFeeds()
        self.active = 0
        self.pending_reports = set()
        self.locked_callers = set()
        self.initialize_reports()

    def initialize_reports(self):
        self.report_db.touch(mode=0o600, exist_ok=True)
        with closing(sqlite3.connect(self.report_db)) as database, database:
            database.execute("""CREATE TABLE IF NOT EXISTS calls (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at TEXT NOT NULL,
                duration_seconds REAL NOT NULL, model TEXT NOT NULL, reason TEXT NOT NULL,
                topics TEXT NOT NULL, classification_status TEXT NOT NULL, rules TEXT NOT NULL
            )""")
            columns = {row[1] for row in database.execute("PRAGMA table_info(calls)")}
            for column in ("first_name", "last_name", "phone", "violation_details"):
                if column not in columns:
                    database.execute(f"ALTER TABLE calls ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
            database.execute("""CREATE TABLE IF NOT EXISTS consents (
                user_id TEXT PRIMARY KEY, version TEXT NOT NULL, accepted_at TEXT NOT NULL)""")

    def save_report(self, values):
        with closing(sqlite3.connect(self.report_db)) as database, database:
            database.execute("INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values)

    async def report(self, metadata, recording, api_key, outcome, profile):
        try:
            pcm = recording.mixed_pcm()
            status, topics = "empty", []
            if pcm:
                try:
                    topics = await asyncio.to_thread(classify_call, api_key, encode_wav(pcm))
                    status = "complete"
                except Exception:
                    status = "failed"
            await asyncio.to_thread(
                self.save_report,
                (*metadata, outcome.reason, json.dumps(topics), status, json.dumps(outcome.flagged_rules),
                 *profile, json.dumps(outcome.violation_details, ensure_ascii=False)),
            )
            if self.forms:
                try:
                    await asyncio.to_thread(self.forms.pending, self.report_db, call_id=metadata[0])
                except Exception as error:
                    LOGGER.warning("Google Forms export pending (%s)", type(error).__name__)
        finally:
            self.active -= 1

    def report_done(self, task):
        self.pending_reports.discard(task)
        if not task.cancelled() and task.exception():
            LOGGER.error("Post-call report failed (%s)", type(task.exception()).__name__)

    def has_consent(self, user_id):
        with closing(sqlite3.connect(self.report_db)) as database:
            return database.execute("SELECT 1 FROM consents WHERE user_id=?", (user_id,)).fetchone() is not None

    def accept_consent(self, user_id):
        with closing(sqlite3.connect(self.report_db)) as database, database:
            database.execute("INSERT OR IGNORE INTO consents VALUES (?, ?, ?)",
                             (user_id, CONSENT_VERSION, datetime.now(timezone.utc).isoformat()))

    def authenticate_transport(self, request):
        # The service binds to loopback. Require a dedicated Asterisk password as well.
        try:
            login = request.headers["Authorization"]
            if not login.startswith("Basic "):
                return False
            credentials = BasicAuth.decode(login)
        except (KeyError, ValueError):
            return False
        supplied = credentials.password.encode("utf-8")
        return credentials.login == "asterisk" and hmac.compare_digest(supplied, self.password)

    async def handle(self, request):
        if not self.authenticate_transport(request):
            raise web.HTTPUnauthorized()
        digit = request.query.get("digit")
        if digit not in (*MODELS, "9", "0"):
            raise web.HTTPBadRequest()
        try:
            number = normalize_number(request.query.get("caller", ""))
        except ValueError:
            number = ""
        record = json.loads(self.roster.read_text(encoding="utf-8")).get(number)
        if number in self.locked_callers:
            raise web.HTTPForbidden()
        if self.active >= self.capacity:
            raise web.HTTPTooManyRequests()

        self.active += 1
        self.locked_callers.add(number)
        socket = web.WebSocketResponse(protocols=("media",), heartbeat=20, max_msg_size=65500)
        reader = None
        report_scheduled = False
        try:
            await socket.prepare(request)
            media = await AsteriskMedia.start(socket)
            reader = asyncio.create_task(media.read_events())
            if not record:
                await media.announce(self.prompts["unknown-caller"])
                await media.command("HANGUP")
                return socket
            if digit == "9":
                await media.announce(self.prompts["privacy"])
                await media.command("HANGUP")
                return socket
            if digit == "0":
                await media.announce(self.prompts["opening"])
            if not self.has_consent(record["id"]):
                await media.announce(self.prompts["consent"])
                if await media.read_digits(1) != "1":
                    return socket
                self.accept_consent(record["id"])
            if digit == "0":
                while True:
                    await media.announce(self.prompts["models"])
                    digit = await media.read_digits(1)
                    if digit in MODELS:
                        break
                    if digit == "9":
                        await media.announce(self.prompts["privacy"])
            api_key = self.cipher.decrypt(record["key"].encode()).decode()

            started = datetime.now(timezone.utc).isoformat()
            recording = ConversationAudio()
            media.recorded = recording
            try:
                async with asyncio.timeout(self.call_seconds):
                    outcome = await run_live_call(
                        media, digit, api_key, self.thresholds, consent_given=True,
                        first_name=record.get("first_name", ""), news=self.news,
                    )
            except TimeoutError:
                outcome = CallOutcome("time_limit", "call-limit")

            recording.flush()
            media.recorded = None
            elapsed = round(monotonic() - recording.started, 2)
            metadata = (uuid4().hex, record["id"], started, elapsed, MODELS[digit][0])
            task = asyncio.create_task(self.report(metadata, recording, api_key, outcome,
                                                     (record.get("first_name", ""), record.get("last_name", ""), number)))
            self.pending_reports.add(task)
            task.add_done_callback(self.report_done)
            report_scheduled = True

            if outcome.announcement and not socket.closed:
                await media.announce(self.prompts[outcome.announcement])
            await media.command("HANGUP")
        except (asyncio.TimeoutError, Disconnected, ConnectionError):
            pass
        except Exception as error:
            LOGGER.warning("Call ended with a gateway error (%s)", type(error).__name__)
        finally:
            if reader:
                reader.cancel()
                await asyncio.gather(reader, return_exceptions=True)
            self.locked_callers.discard(number)
            if not report_scheduled:
                self.active -= 1
            await socket.close()
        return socket

    async def cleanup(self, _):
        if self.pending_reports:
            await asyncio.gather(*self.pending_reports, return_exceptions=True)


def make_app(gateway):
    app = web.Application()
    app[GATEWAY] = gateway
    app.router.add_get("/media", gateway.handle)
    app.on_cleanup.append(gateway.cleanup)
    return app


def main():
    logging.basicConfig(level=logging.INFO)
    directory = Path(os.environ["PHONE_PROMPT_DIR"])
    thresholds = json.loads(os.environ.get("PHONE_THRESHOLDS", json.dumps(DEFAULT_THRESHOLDS)))
    if set(thresholds) != set(MONITOR_RULES) or any(
        not math.isfinite(value) or not 0.5 < value <= 1 for value in thresholds.values()
    ):
        raise SystemExit("Configure a calibrated threshold for each moderation rule")
    call_seconds = int(os.environ.get("PHONE_MAX_CALL_SECONDS", "480"))
    if not 60 <= call_seconds <= 900:
        raise SystemExit("PHONE_MAX_CALL_SECONDS must be between 60 and 900")
    secret = os.environ["PHONE_ASTERISK_PASSWORD"].encode()
    if len(secret) < 24:
        raise SystemExit("Set a dedicated Asterisk password of at least 24 characters")
    gateway = Gateway(
        Path(os.environ["PHONE_ROSTER"]), Fernet(os.environ["PHONE_MASTER_KEY"].encode()), secret,
        {name: load_prompt(directory / f"{name}.wav") for name in PROMPTS},
        thresholds, Path(os.environ["PHONE_REPORT_DB"]), call_seconds=call_seconds,
        forms=FormsExporter.from_env(),
    )
    # Request access logs would contain the caller number in the WebSocket URL.
    web.run_app(make_app(gateway), host="127.0.0.1", port=8765, access_log=None)


if __name__ == "__main__":
    main()
