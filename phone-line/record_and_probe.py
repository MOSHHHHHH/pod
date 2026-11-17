#!/usr/bin/env python3
"""Render phone prompts and probe Gemini with synthetic Hebrew speech."""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import wave

from google import genai
from google.genai import types

from phone_menu import DECISION_MODEL, MODELS, TEST_UTTERANCE, prompts

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from podki_voiceover import MODEL as TTS_MODEL, VOICE  # noqa: E402

STYLE = (
    "Clear native Israeli Hebrew for a phone menu. Friendly, neutral voice. "
    "Pause after each instruction. Read exactly the supplied text. No music or effects."
)
OUT = Path("gemini-live-phone-audio")
SYSTEM_TEST = "ענה בעברית. לבדיקת שמע, אמור בקצרה: הבדיקה הצליחה."


def synthesize(client, transcript):
    response = client.models.generate_content(
        model=TTS_MODEL,
        contents=types.Content(
            role="user",
            parts=[types.Part(text=transcript, speech_metadata=types.SpeechMetadata(style=STYLE))],
        ),
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(voice=VOICE)),
        ),
    )
    audio = next(
        (bytes(part.inline_data.data) for part in response.parts or []
         if part.inline_data and part.inline_data.data),
        b"",
    )
    if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
        raise RuntimeError("TTS returned no WAV audio")
    return audio


def ffmpeg(audio, *arguments):
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", *arguments],
        input=audio,
        capture_output=True,
        check=True,
    ).stdout


def error_status(error):
    # Avoid putting credentials, endpoints or raw provider errors into artifacts.
    status = getattr(error, "code", None)
    return {"ok": False, "error_type": type(error).__name__, "provider_code": status}


async def probe_live(client, model, speech_pcm):
    try:
        async with asyncio.timeout(25):
            async with client.live.connect(
                model=model,
                config={"response_modalities": ["AUDIO"], "system_instruction": SYSTEM_TEST},
            ) as session:
                for offset in range(0, len(speech_pcm), 3200):
                    await session.send_realtime_input(
                        audio=types.Blob(data=speech_pcm[offset:offset + 3200], mime_type="audio/pcm;rate=16000"),
                    )
                    await asyncio.sleep(0.1)
                await session.send_realtime_input(audio_stream_end=True)
                async for message in session.receive():
                    if message.data:
                        return {"ok": True, "received_audio": True}
                return {"ok": False, "error_type": "NoAudio", "provider_code": None}
    except Exception as error:
        return error_status(error)


async def probe(client, audio):
    speech_pcm = ffmpeg(audio, "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1")
    results = {}
    async with client.aio as async_client:
        for digit, (model, _, _) in MODELS.items():
            results[digit] = {"model": model, **await probe_live(async_client, model, speech_pcm)}
        try:
            response = await asyncio.wait_for(async_client.decisions.create(
                model=DECISION_MODEL,
                input=[{"type": "audio", "mime_type": "audio/wav",
                        "data": base64.b64encode(audio).decode("ascii")}],
                questions={"audio_test": {"type": "noul",
                                          "instructions": "האם הדובר מבקש לבצע בדיקת שמע?"}},
            ), timeout=20)
            result = response.answers["audio_test"]
            results["decision"] = {"model": DECISION_MODEL, "ok": True, "probability_yes": result.noul}
        except Exception as error:
            results["decision"] = {"model": DECISION_MODEL, **error_status(error)}
    return results


def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY is missing")
    OUT.mkdir(parents=True, exist_ok=True)
    with genai.Client(api_key=api_key) as client:
        manifest = []
        for stem, transcript in prompts().items():
            filename = f"{stem}.wav"
            try:
                audio = synthesize(client, transcript)
                pcm = ffmpeg(audio, "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1")
                if not pcm:
                    raise RuntimeError("Empty phone audio")
                with wave.open(str(OUT / filename), "wb") as wav:
                    wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                    wav.writeframes(pcm)
                manifest.append({"file": filename, "transcript": transcript, "ok": True})
                print(f"Saved {filename}", flush=True)
            except Exception as error:
                manifest.append({"file": filename, "transcript": transcript, **error_status(error)})
                print(f"Failed {filename}: {type(error).__name__}", flush=True)
        write_json("transcripts.json", {"model": TTS_MODEL, "voice": VOICE, "prompts": manifest})
        try:
            test_audio = synthesize(client, TEST_UTTERANCE)
            write_json("api-probe.json", asyncio.run(probe(client, test_audio)))
        except Exception as error:
            write_json("api-probe.json", {"probe_setup": error_status(error)})
        if not all(prompt["ok"] for prompt in manifest):
            raise SystemExit("Some phone prompts failed. See transcripts.json.")


if __name__ == "__main__":
    main()
