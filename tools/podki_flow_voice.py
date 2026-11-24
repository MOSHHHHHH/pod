#!/usr/bin/env python3
"""One isolated Podki spoken-word proof of concept. No music, no podcast code changes."""
import io
import os
import wave
from pathlib import Path
from google import genai
from google.genai import types

OUT=Path("podki-flow-voice")
OUT.mkdir(exist_ok=True)
WORD="פּוֹדְקִי"
MODEL="gemini-3.8-flash-tts"
VOICE="Puck"

if not os.getenv("GEMINI_API_KEY"):
    raise SystemExit("Missing GEMINI_API_KEY")
client=genai.Client(api_key=os.environ["GEMINI_API_KEY"])
try:
    content=types.Content(role="user",parts=[
        types.Part(text=WORD,speech_metadata=types.SpeechMetadata(style=(
            "Speak one Hebrew word, exactly as written, in natural modern Israeli Hebrew. "
            "Warm, friendly, confident, youthful male brand voice. Pronounce it POD-kee. "
            "Speech only; no singing, musical notes, sound effects, repetitions, or extra words. "
            "Make the consonants crisp and finish cleanly."
        )))
    ])
    response=client.models.generate_content(
        model=MODEL, contents=content,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(voice=VOICE)
            )
        )
    )
    audio=next((p.inline_data.data for p in (response.parts or [])
                if p.inline_data and p.inline_data.data),None)
    if not audio:
        raise RuntimeError("Gemini returned no audio")
    data=bytes(audio)
    if not data.startswith(b"RIFF"):
        with io.BytesIO() as buffer:
            with wave.open(buffer,"wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                wav.writeframes(data)
            data=buffer.getvalue()
    path=OUT/"podki-spoken-hebrew.wav"
    path.write_bytes(data)
    with wave.open(str(path),"rb") as wav:
        print(f"SUCCESS {path}: {wav.getnframes()/wav.getframerate():.2f} seconds")
finally:
    client.close()
