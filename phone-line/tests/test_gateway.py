"""Exercise the SIP gateway's WebSocket protocol without real calls or API keys."""

import asyncio
import json
import io
from pathlib import Path
import sqlite3
import tempfile
import struct
import wave
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import BasicAuth, WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from cryptography.fernet import Fernet

from live_call import CallOutcome
from phone_gateway import Gateway, PROMPTS, make_app
from phone_users import provision


class GatewayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        cipher = Fernet(Fernet.generate_key())
        roster = root / "roster.json"
        provision(roster, "+972501234567", "123456", "fake-user-key", cipher)
        self.db = root / "reports.sqlite3"
        self.gateway = Gateway(
            roster, cipher, b"fake-asterisk-password-for-tests",
            {name: bytes(640) for name in PROMPTS}, {}, self.db,
        )
        self.client = TestClient(TestServer(make_app(self.gateway)))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.auth = BasicAuth("asterisk", self.gateway.password.decode())

    async def connect(self):
        ws = await self.client.ws_connect(
            "/media?digit=2&caller=0501234567", auth=self.auth, protocols=("media",),
        )
        await ws.send_json({"event": "MEDIA_START", "format": "slin16",
                            "optimal_frame_size": 640, "ptime": 20})
        self.addAsyncCleanup(ws.close)
        return ws

    async def respond_to_prompt(self, ws, digits):
        frame = await ws.receive(timeout=2)
        self.assertEqual(frame.type, WSMsgType.BINARY)
        self.assertEqual(len(frame.data), 640)
        self.assertEqual(await ws.receive_json(timeout=2), {"command": "REPORT_QUEUE_DRAINED"})
        await ws.send_json({"event": "QUEUE_DRAINED"})
        await asyncio.sleep(0.03)
        for digit in digits:
            await ws.send_json({"event": "DTMF_END", "digit": digit})

    async def test_authentication_required_before_socket(self):
        response = await self.client.get("/media?digit=2&caller=0501234567")
        self.assertEqual(response.status, 401)

    async def test_declining_consent_never_opens_live(self):
        with patch("phone_gateway.run_live_call", new_callable=AsyncMock) as live:
            ws = await self.connect()
            await self.respond_to_prompt(ws, "123456")
            await self.respond_to_prompt(ws, "2")
            self.assertIn((await ws.receive(timeout=2)).type, (WSMsgType.CLOSE, WSMsgType.CLOSED))
            live.assert_not_called()
        with sqlite3.connect(self.db) as database:
            self.assertEqual(database.execute("SELECT count(*) FROM calls").fetchone(), (0,))

    async def test_wrong_pin_does_not_open_live(self):
        with patch("phone_gateway.run_live_call", new_callable=AsyncMock) as live:
            ws = await self.connect()
            await self.respond_to_prompt(ws, "654321")
            self.assertIn((await ws.receive(timeout=2)).type, (WSMsgType.CLOSE, WSMsgType.CLOSED))
            live.assert_not_called()

    async def test_call_captures_both_streams_and_saves_report(self):
        call_ready = asyncio.Event()
        playback = (b"\x00\x03" * 480)
        caller = b"\x00\x01" * 320

        async def fake_live(media, digit, key, thresholds, *, consent_given):
            self.assertEqual((digit, key, consent_given), ("2", "fake-user-key", True))
            call_ready.set()
            self.assertEqual(await media.receive_pcm(), caller)
            await media.play_pcm(playback)
            # Give the simulated PSTN enough time to play the 20 ms frame.
            await asyncio.sleep(0.04)
            await media.flush_audio()
            return CallOutcome("possible_violation", "policy-stop", ("shouting",))

        with (patch("phone_gateway.run_live_call", side_effect=fake_live),
              patch("phone_gateway.classify_call", return_value=["science"]) as classify):
            ws = await self.connect()
            await self.respond_to_prompt(ws, "123456")
            await self.respond_to_prompt(ws, "1")
            await asyncio.wait_for(call_ready.wait(), 2)
            await ws.send_bytes(caller)
            frame = await ws.receive(timeout=2)
            self.assertEqual((frame.type, frame.data), (WSMsgType.BINARY, b"\x00\x03" * 320))
            self.assertEqual(await ws.receive_json(timeout=2), {"command": "FLUSH_MEDIA"})
            await self.respond_to_prompt(ws, "")
            self.assertEqual(await ws.receive_json(timeout=2), {"command": "HANGUP"})
            await self.gateway.cleanup(None)

        classify.assert_called_once()
        key, wav = classify.call_args.args
        self.assertEqual(key, "fake-user-key")
        with wave.open(io.BytesIO(wav), "rb") as audio:
            self.assertEqual(audio.getframerate(), 16000)
            samples = list(struct.iter_unpack("<h", audio.readframes(audio.getnframes())))
        self.assertEqual(sum(sample for sample, in samples), (256 + 768) * 320)
        with sqlite3.connect(self.db) as database:
            model, reason, topics, status, rules = database.execute(
                "SELECT model, reason, topics, classification_status, rules FROM calls"
            ).fetchone()
        self.assertEqual(model, "gemini-3.8-live-extended-thinking")
        self.assertEqual((reason, status), ("possible_violation", "complete"))
        self.assertEqual((json.loads(topics), json.loads(rules)), (["science"], ["shouting"]))


if __name__ == "__main__":
    unittest.main()
