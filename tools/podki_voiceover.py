#!/usr/bin/env python3
"""Generate a Hebrew Gemini Live telephone menu announcement."""
import json
import os
from pathlib import Path

from google import genai
from google.genai import types

MODEL = "gemini-3.8-flash-tts"
VOICE = "Charon"
OUT = Path("podki-voiceovers")
TRANSCRIPT = "לכניסה לקו Gemini Live, הקישו שמונה."
STYLE = (
    "Professional Israeli Hebrew telephone IVR announcement. "
    "Clear, friendly and calm male voice. "
    "Natural pronunciation and moderate pace. "
    "Pronounce Gemini Live naturally in English. "
    "Speak only the supplied text. "
    "No music or sound effects."
)


def main():
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY repository secret is missing or empty.")
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=types.Content(
                role="user",
                parts=[types.Part(
                    text=TRANSCRIPT,
                    speech_metadata=types.SpeechMetadata(style=STYLE),
                )],
            ),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(voice=VOICE)
                ),
            ),
        )
        audio = next(
            (part.inline_data.data for part in (response.parts or [])
             if part.inline_data and part.inline_data.data),
            None,
        )
        if not audio or not bytes(audio).startswith(b"RIFF"):
            raise RuntimeError("Gemini returned no valid WAV audio.")
        filename = "gemini-live-menu-he.wav"
        (OUT / filename).write_bytes(audio)
        (OUT / "transcripts.json").write_text(
            json.dumps([{
                "file": filename, "transcript": TRANSCRIPT,
                "model": MODEL, "voice": VOICE, "style": STYLE,
            }], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Saved {filename} ({len(audio)} bytes)")
    finally:
        client.close()


if __name__ == "__main__":
    main()
