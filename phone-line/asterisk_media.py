"""Asterisk chan_websocket transport for a single slin16 call."""

import asyncio
from array import array
import json
import sys
from time import monotonic

from aiohttp import WSMsgType


class Disconnected(Exception):
    pass


class AsteriskMedia:
    def __init__(self, socket, frame_size, packet_ms):
        self.socket = socket
        self.frame_size = frame_size
        self.packet_seconds = packet_ms / 1000
        self.incoming = asyncio.Queue(maxsize=64)
        self.digits = asyncio.Queue(maxsize=16)
        self.drained = asyncio.Event()
        self.disconnected = asyncio.Event()
        self.write_ready = asyncio.Event()
        self.write_ready.set()
        self.pending = bytearray()
        self.resample_tail = b""
        self.recorded = None

    @classmethod
    async def start(cls, socket):
        start = await socket.receive(timeout=5)
        if start.type != WSMsgType.TEXT:
            raise ValueError("Missing Asterisk MEDIA_START")
        event = json.loads(start.data)
        frame = event.get("optimal_frame_size")
        packet_ms = event.get("ptime")
        if (event.get("event") != "MEDIA_START" or event.get("format") != "slin16"
                or type(packet_ms) is not int or packet_ms not in (10, 20, 30, 40, 60)
                or frame != packet_ms * 32):
            raise ValueError("Expected aligned 16 kHz mono PCM from Asterisk")
        return cls(socket, frame, packet_ms)

    async def read_events(self):
        try:
            async for message in self.socket:
                if message.type == WSMsgType.BINARY:
                    if self.recorded is not None:
                        self.incoming.put_nowait(message.data)
                    continue
                if message.type != WSMsgType.TEXT:
                    continue
                event = json.loads(message.data)
                name = event.get("event")
                if name == "DTMF_END":
                    digit = event.get("digit")
                    if digit in tuple("0123456789"):
                        self.digits.put_nowait(digit)
                elif name == "QUEUE_DRAINED":
                    self.drained.set()
                elif name == "MEDIA_XOFF":
                    self.write_ready.clear()
                elif name == "MEDIA_XON":
                    self.write_ready.set()
        finally:
            self.disconnected.set()
            self.write_ready.set()
            if self.incoming.full():
                self.incoming.get_nowait()
            self.incoming.put_nowait(b"")

    async def command(self, name):
        if not self.socket.closed:
            await self.socket.send_str(json.dumps({"command": name}))

    async def send_frames(self, pcm):
        if len(pcm) % self.frame_size:
            raise ValueError("Playback audio does not align with Asterisk frames")
        for offset in range(0, len(pcm), self.frame_size * 4):
            await asyncio.wait_for(self.write_ready.wait(), 3)
            if self.disconnected.is_set():
                raise Disconnected()
            chunk = pcm[offset:offset + self.frame_size * 4]
            await self.socket.send_bytes(chunk)
            if self.recorded is not None:
                self.recorded.play(chunk)

    async def announce(self, pcm):
        missing = -len(pcm) % self.frame_size
        pcm += bytes(missing)
        # Pace long prerecorded notices below the channel driver's queue limit.
        for offset in range(0, len(pcm), self.frame_size * 10):
            chunk = pcm[offset:offset + self.frame_size * 10]
            await self.send_frames(chunk)
            if offset + len(chunk) < len(pcm):
                await asyncio.sleep(len(chunk) / 32000)
        self.drained.clear()
        await self.command("REPORT_QUEUE_DRAINED")
        await asyncio.wait_for(self.drained.wait(), 4)

    async def read_digits(self, count):
        # Ignore keys pressed before the prompt finishes.
        while not self.digits.empty():
            self.digits.get_nowait()
        async with asyncio.timeout(15):
            return "".join([await self.digits.get() for _ in range(count)])

    async def receive_pcm(self):
        frame = await self.incoming.get()
        if len(frame) % self.frame_size:
            raise ValueError("Caller audio does not align with Asterisk frames")
        if not self.disconnected.is_set() and self.recorded is not None and frame:
            self.recorded.hear(frame)
            return frame
        return b""

    async def play_pcm(self, pcm):
        # Three 24 kHz samples span the same time as two 16 kHz samples.
        pcm = self.resample_tail + pcm
        consumed = len(pcm) // 6 * 6
        self.resample_tail = pcm[consumed:]
        samples = array("h")
        samples.frombytes(pcm[:consumed])
        if sys.byteorder != "little":
            samples.byteswap()
        downsampled = array("h")
        for a, b, c in zip(samples[::3], samples[1::3], samples[2::3]):
            downsampled.extend(((2 * a + b) // 3, (b + 2 * c) // 3))
        if sys.byteorder != "little":
            downsampled.byteswap()
        self.pending.extend(downsampled.tobytes())
        ready = len(self.pending) // self.frame_size * self.frame_size
        frames = bytes(self.pending[:ready])
        del self.pending[:ready]
        await self.send_frames(frames)

    async def finish_turn(self):
        if self.pending:
            pcm = bytes(self.pending).ljust(self.frame_size, b"\0")
            self.pending.clear()
            await self.send_frames(pcm)
        self.resample_tail = b""

    async def flush_audio(self):
        self.pending.clear()
        self.resample_tail = b""
        if self.recorded is not None:
            self.recorded.flush()
        await self.command("FLUSH_MEDIA")
        self.write_ready.set()


class ConversationAudio:
    """Keep caller and assistant on separate timelines until final in-memory mixing."""

    def __init__(self, clock=monotonic):
        self.clock = clock
        self.started = clock()
        self.caller = bytearray()
        self.assistant = bytearray()

    def offset(self):
        return max(0, round((self.clock() - self.started) * 16000)) * 2

    @staticmethod
    def extend_at(stream, pcm, start):
        if start > len(stream):
            stream.extend(bytes(start - len(stream)))
        stream.extend(pcm)

    def hear(self, pcm):
        self.extend_at(self.caller, pcm, self.offset() - len(pcm))

    def play(self, pcm):
        self.extend_at(self.assistant, pcm, self.offset())

    def flush(self):
        del self.assistant[self.offset():]

    def mixed_pcm(self):
        length = max(len(self.caller), len(self.assistant))
        if not length:
            return b""
        caller = array("h")
        caller.frombytes(self.caller.ljust(length, b"\0"))
        assistant = array("h")
        assistant.frombytes(self.assistant.ljust(length, b"\0"))
        if sys.byteorder != "little":
            caller.byteswap()
            assistant.byteswap()
        mixed = array("h", (max(-32768, min(32767, a + b)) for a, b in zip(caller, assistant)))
        if sys.byteorder != "little":
            mixed.byteswap()
        return mixed.tobytes()
