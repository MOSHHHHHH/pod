"""Schedule strict caller-side moderation without blocking the media relay."""

import asyncio
from dataclasses import dataclass
from io import BytesIO
import wave
from datetime import datetime, timezone
from time import monotonic

from phone_decisions import check_caller
from phone_menu import MONITOR_INTERVAL_SECONDS, MONITOR_WINDOW_SECONDS

SAMPLE_RATE = 16000
SAMPLE_BYTES = 2
WINDOW_BYTES = MONITOR_WINDOW_SECONDS * SAMPLE_RATE * SAMPLE_BYTES


def encode_wav(pcm):
    buffer = BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setparams((1, SAMPLE_BYTES, SAMPLE_RATE, 0, "NONE", "not compressed"))
        output.writeframes(pcm)
    return buffer.getvalue()


@dataclass(frozen=True)
class MonitorStop:
    reason: str
    rules: tuple[str, ...] = ()
    details: tuple[dict, ...] = ()


class CallMonitor:
    """Keep at most 12 seconds of caller PCM and request one decision per interval."""

    def __init__(self, api_key, thresholds, *, interval=MONITOR_INTERVAL_SECONDS, deadline=3):
        if not 0 < deadline < interval:
            raise ValueError("Decision deadline must be shorter than the monitoring interval")
        self.api_key = api_key
        self.thresholds = dict(thresholds)
        self.interval = interval
        self.deadline = deadline
        self.started = monotonic()
        self.failures = 0
        self._window = bytearray()
        self._samples_received = 0
        self._samples_checked = 0
        self._closed = asyncio.Event()
        self._check_lock = asyncio.Lock()

    def append_caller_pcm(self, frame):
        if len(frame) % SAMPLE_BYTES:
            raise ValueError("PCM frame contains an incomplete sample")
        if self._closed.is_set():
            return
        self._samples_received += len(frame) // SAMPLE_BYTES
        self._window.extend(frame[-WINDOW_BYTES:])
        del self._window[:max(0, len(self._window) - WINDOW_BYTES)]

    async def _check(self):
        async with self._check_lock:
            if self._samples_received == self._samples_checked:
                return None
            self._samples_checked = self._samples_received
            wav = encode_wav(self._window)
            try:
                rules = await asyncio.wait_for(
                    asyncio.to_thread(
                        check_caller, self.api_key, wav, self.thresholds, timeout=self.deadline,
                    ),
                    timeout=self.deadline,
                )
            except Exception:
                # Private pilot: a quota or monitoring error must not stop the call.
                self.failures += 1
                return None
            if rules:
                from phone_decisions import MONITOR_RULES
                detected = datetime.now(timezone.utc).isoformat()
                end = round(monotonic() - self.started, 3)
                details = tuple({
                    "rule": rule, "description": MONITOR_RULES[rule],
                    "probability": probability, "detected_at": detected,
                    "window_start_seconds": max(0, end - MONITOR_WINDOW_SECONDS),
                    "window_end_seconds": end,
                } for rule, probability in rules.items())
                return MonitorStop("possible_violation", tuple(rules), details)
            return None

    async def run(self):
        """Return a stop reason, or evaluate the last partial window when closed."""
        loop = asyncio.get_running_loop()
        next_check = loop.time() + self.interval
        while not self._closed.is_set():
            try:
                await asyncio.wait_for(self._closed.wait(), max(0, next_check - loop.time()))
            except TimeoutError:
                decision = await self._check()
                if decision:
                    self.close()
                    return decision
                next_check += self.interval
        return await self._check()

    def close(self):
        self._closed.set()
