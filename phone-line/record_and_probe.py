#!/usr/bin/env python3
"""Generate changed phone prompts, checkpoint each file, and stop on quota exhaustion."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import wave

from google import genai
from google.genai import types

from phone_menu import prompts

OUT = Path("gemini-live-phone-audio")
TTS_MODEL = "gemini-3.8-flash-tts"
PRIVACY_MODEL = "gemini-3.8-flash-lite-tts"
VOICE = "Charon"
STYLE = "Native Israeli Hebrew telephone instructions. Friendly, calm, clear. Read only the supplied text. No music."
MANIFEST = OUT / "transcripts.json"


def write_manifest(manifest):
    temporary = MANIFEST.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(MANIFEST)


def synthesize(client, transcript, model):
    response = client.models.generate_content(
        model=model,
        contents=types.Content(role="user", parts=[
            types.Part(text=transcript, speech_metadata=types.SpeechMetadata(style=STYLE)),
        ]),
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(voice=VOICE)),
        ),
    )
    audio = b"".join(bytes(part.inline_data.data) for part in response.parts or []
                     if part.inline_data and part.inline_data.data)
    if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
        raise ValueError("No WAV audio returned")
    return audio


def convert(source, target):
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(source), "-ar", "8000", "-ac", "1",
         "-f", "s16le", "pipe:1"], capture_output=True, check=True,
    ).stdout
    if not pcm:
        raise ValueError("Empty audio conversion")
    temporary = target.with_suffix(".tmp")
    with wave.open(str(temporary), "wb") as audio:
        audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        audio.writeframes(pcm)
    temporary.replace(target)


def main():
    OUT.mkdir(exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    # Older runs wrote a list-based manifest. Those files lack content hashes.
    if not isinstance(manifest, dict) or "prompts" in manifest:
        manifest = {}
    made_request = False
    with genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options={"api_version": "v1beta"}) as client:
        for stem, transcript in prompts().items():
            model = PRIVACY_MODEL if stem == "privacy" else TTS_MODEL
            fingerprint = hashlib.sha256(json.dumps(
                [transcript, model, VOICE, STYLE], ensure_ascii=False,
            ).encode()).hexdigest()
            filename = f"{stem}.wav"
            raw = OUT / f"{stem}.source.wav"
            target = OUT / filename
            previous = manifest.get(stem, {})
            if previous.get("hash") == fingerprint and previous.get("ok") and target.exists():
                print(f"Reusing {filename}", flush=True)
                continue
            entry = {"file": filename, "transcript": transcript, "hash": fingerprint,
                     "model": model, "voice": VOICE, "ok": False}
            manifest[stem] = entry
            try:
                if previous.get("source_hash") != fingerprint or not raw.exists():
                    if made_request:
                        time.sleep(15)
                    made_request = True
                    raw.write_bytes(synthesize(client, transcript, model))
                    entry["source_hash"] = fingerprint
                    write_manifest(manifest)
                entry["source_hash"] = fingerprint
                convert(raw, target)
                entry["ok"] = True
                write_manifest(manifest)
                print(f"Saved {filename}", flush=True)
            except Exception as error:
                code = getattr(error, "code", None) or getattr(error, "status_code", None)
                entry.update(error_type=type(error).__name__, provider_code=code)
                write_manifest(manifest)
                print(f"Stopped at {filename}: {type(error).__name__}, code={code}", flush=True)
                if code == 429:
                    print("Quota exhausted. Completed audio is checkpointed for the next run.", flush=True)
                    return
                raise
    print("All phone prompts are recorded.", flush=True)


if __name__ == "__main__":
    main()
