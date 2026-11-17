"""Bridge a consenting caller's PCM stream to a fixed Gemini Live model."""

import asyncio
from dataclasses import dataclass

from call_monitor import CallMonitor
from phone_menu import MODELS

SYSTEM_INSTRUCTION = (
    "אתה עוזר קולי בקו טלפוני. ענה בעברית טבעית וקצרה, אלא אם התבקשת לשפה אחרת. "
    "בשיחה קולית, הסבר במילים בלי עיצוב מסמך. אם אינך יודע, אמור זאת."
)


@dataclass(frozen=True)
class CallOutcome:
    reason: str
    announcement: str | None = None
    flagged_rules: tuple[str, ...] = ()


async def send_caller_audio(session, media, monitor, pcm_blob):
    while frame := await media.receive_pcm():
        monitor.append_caller_pcm(frame)
        await session.send_realtime_input(audio=pcm_blob(frame))
    return CallOutcome("caller_disconnected")


async def play_assistant_audio(session, media):
    while True:
        saw_message = False
        async for message in session.receive():
            saw_message = True
            if message.server_content and message.server_content.interrupted:
                await media.flush_audio()
            if message.data:
                await media.play_pcm(message.data)
        if not saw_message:
            return CallOutcome("connection_error", "connection-error")


async def relay(session, media, monitor, pcm_blob):
    audio_in = asyncio.create_task(send_caller_audio(session, media, monitor, pcm_blob))
    audio_out = asyncio.create_task(play_assistant_audio(session, media))
    safety = asyncio.create_task(monitor.run())
    try:
        done, _ = await asyncio.wait((audio_in, audio_out, safety), return_when=asyncio.FIRST_COMPLETED)
        if safety in done and (stop := safety.result()):
            announcement = "policy-stop" if stop.rules else "monitoring-unavailable"
            return CallOutcome(stop.reason, announcement, stop.rules)
        if audio_in in done:
            outcome = audio_in.result()
            audio_out.cancel()
            monitor.close()
            if (stop := await safety) and stop.rules:
                return CallOutcome(outcome.reason, flagged_rules=stop.rules)
            return outcome
        return audio_out.result()
    finally:
        for pending in (audio_in, audio_out, safety):
            pending.cancel()
        await asyncio.gather(audio_in, audio_out, safety, return_exceptions=True)
        monitor.close()
        await media.flush_audio()


async def run_live_call(media, digit, api_key, thresholds, *, consent_given):
    """Use an authenticated caller's API key after the IVR verifies consent.

    The transport supplies receive_pcm (mono signed PCM 16 kHz; EOF is empty bytes),
    play_pcm (mono PCM 24 kHz), and flush_audio (discard queued assistant audio).
    It uses the returned announcement, if any, to play a prompt and exit the SIP leg.
    """
    if not consent_given:
        return CallOutcome("consent_declined")
    if digit not in MODELS or not api_key:
        return CallOutcome("model_unavailable", "model-unavailable")

    from google import genai
    from google.genai import types

    model = MODELS[digit][0]
    monitor = CallMonitor(api_key, thresholds)

    def pcm_blob(frame):
        return types.Blob(data=frame, mime_type="audio/pcm;rate=16000")

    try:
        async with genai.Client(api_key=api_key).aio as client:
            async with client.live.connect(
                model=model,
                config={"response_modalities": ["AUDIO"], "system_instruction": SYSTEM_INSTRUCTION},
            ) as session:
                return await relay(session, media, monitor, pcm_blob)
    except Exception as error:
        status = getattr(error, "code", None) or getattr(error, "status_code", None)
        if status == 429:
            return CallOutcome("quota_exhausted", "quota")
        if status in (403, 404):
            return CallOutcome("model_unavailable", "model-unavailable")
        return CallOutcome("connection_error", "connection-error")
