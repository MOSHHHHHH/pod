#!/usr/bin/env python3
"""Generate the approved continuous Hebrew Podki commercial voiceover as a WAV artifact."""
import json
import os
from pathlib import Path

from google import genai
from google.genai import types

MODEL = "gemini-3.8-flash-tts"
VOICE = "Charon"
OUT = Path("podki-voiceovers")
TRANSCRIPT = """אוהבים פודקאסטים?

גם אנחנו!

אבל מה עושים כשרוצים לשמור פרק להאזנה מאוחרת יותר? בלי להיות תלויים באינטרנט או באפליקציה מסוימת?

הכירו את פּוֹדְקִי!

העוזר האישי שלכם לשמירת פודקאסטים.

פשוט מבקשים — ופּוֹדְקִי דואג שהפרקים שאתם אוהבים יגיעו ישירות ל־Google Drive שלכם, מסודרים בתיקיות לפי ערוץ!

משם תוכלו להוריד אותם למכשיר, ולהאזין מתי שתרצו, גם בלי חיבור לאינטרנט, ובנגן שאתם אוהבים.

ואפשר גם להירשם לעדכונים, כדי לא לפספס פרקים חדשים!

הפודקאסטים שלכם. הקבצים שלכם. הבחירה שלכם."""

STYLE = (
    "Professional Israeli Hebrew commercial voiceover. Warm, youthful, charismatic "
    "male voice, friendly and confident, not a newsreader. Begin with playful "
    "curiosity and conversational humor; gradually build genuine excitement. "
    "Introduce פּוֹדְקִי with an enthusiastic, memorable reveal. "
    "Keep a brisk but intelligible pace and natural expressive pauses. "
    "Emphasize the freedom of offline listening and ownership of saved files. Give the 'הפודקאסטים שלכם. הקבצים שלכם. הבחירה שלכם.' slogan a rhythmic, confident cadence; "
    "finish confidently on the three-part slogan, without adding any brand signature. Pronounce פּוֹדְקִי "
    "naturally as POD-kee in Israeli Hebrew. Speak only the supplied transcript, "
    "without stage directions, additions, music, or sound effects."
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
        filename = "podki-commercial-he.wav"
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
