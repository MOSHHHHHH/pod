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
from live_call import CallOutcome, run_live_call
from phone_decisions import MONITOR_RULES, classify_call
from phone_menu import MODELS
from phone_users import PIN_LENGTH, normalize_number, verify_pin

LOGGER = logging.getLogger("phone-gateway")
PROMPTS = (
    "pin", "consent", "policy-stop", "quota", "monitoring-unavailable",
    "connection-error", "model-unavailable", "call-limit",
)
GATEWAY = web.AppKey("gateway", object)


def load_prompt(path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 8000):
            raise ValueError(f"{path.name}: expected 8 kHz mono PCM16 WAV")
        source = audio.readframes(audio.getnframes())
        if not source or len(source) > 60 * 16000:
            raise ValueError(f"{path.name}: invalid prompt length")
    # Each 8 kHz PCM sample plays for two samples in the 16 kHz channel.
    return b"".join(source[i:i + 2] * 2 for i in range(0, len(source), 2))


class Gateway:
    def __init__(self, roster, cipher, password, prompts, thresholds, report_db, *, call_seconds=480, capacity=8):
        self.roster = roster
        self.cipher = cipher
        self.password = password
        self.prompts = prompts
        self.thresholds = thresholds
        self.report_db = report_db
        self.call_seconds = call_seconds
        self.capacity = capacity
        self.active = 0
        self.pending_reports = set()
        self.locked_callers = set()
        self.rejected_until = {}
        self.initialize_reports()

    def initialize_reports(self):
        self.report_db.touch(mode=0o600, exist_ok=True)
        with closing(sqlite3.connect(self.report_db)) as database, database:
            database.execute("""CREATE TABLE IF NOT EXISTS calls (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at TEXT NOT NULL,
                duration_seconds REAL NOT NULL, model TEXT NOT NULL, reason TEXT NOT NULL,
                topics TEXT NOT NULL, classification_status TEXT NOT NULL, rules TEXT NOT NULL
            )""")

    def save_report(self, values):
        with closing(sqlite3.connect(self.report_db)) as database, database:
            database.execute("INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", values)

    async def report(self, metadata, recording, api_key, outcome):
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
                (*metadata, outcome.reason, json.dumps(topics), status, json.dumps(outcome.flagged_rules)),
            )
        finally:
            self.active -= 1

    def report_done(self, task):
        self.pending_reports.discard(task)
        if not task.cancelled() and task.exception():
            LOGGER.error("Post-call report failed (%s)", type(task.exception()).__name__)

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
        if digit not in MODELS:
            raise web.HTTPBadRequest()
        try:
            number = normalize_number(request.query.get("caller", ""))
        except ValueError:
            raise web.HTTPForbidden() from None
        record = json.loads(self.roster.read_text(encoding="utf-8")).get(number)
        if not record or number in self.locked_callers:
            raise web.HTTPForbidden()
        self.rejected_until = {key: expiry for key, expiry in self.rejected_until.items() if expiry > monotonic()}
        if number in self.rejected_until or self.active >= self.capacity:
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
            await media.announce(self.prompts["pin"])
            pin = await media.read_digits(PIN_LENGTH)
            api_key = await asyncio.to_thread(verify_pin, record, pin, self.cipher)
            if not api_key:
                self.rejected_until[number] = monotonic() + 30
                return socket
            await media.announce(self.prompts["consent"])
            if await media.read_digits(1) != "1":
                return socket

            started = datetime.now(timezone.utc).isoformat()
            recording = ConversationAudio()
            media.recorded = recording
            try:
                async with asyncio.timeout(self.call_seconds):
                    outcome = await run_live_call(media, digit, api_key, self.thresholds, consent_given=True)
            except TimeoutError:
                outcome = CallOutcome("time_limit", "call-limit")

            recording.flush()
            media.recorded = None
            elapsed = round(monotonic() - recording.started, 2)
            metadata = (uuid4().hex, record["id"], started, elapsed, MODELS[digit][0])
            task = asyncio.create_task(self.report(metadata, recording, api_key, outcome))
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
    thresholds = json.loads(os.environ["PHONE_THRESHOLDS"])
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
    )
    # Request access logs would contain the caller number in the WebSocket URL.
    web.run_app(make_app(gateway), host="127.0.0.1", port=8765, access_log=None)


if __name__ == "__main__":
    main()
