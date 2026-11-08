#!/usr/bin/env python3
"""Generate separate Hebrew voiceover WAV files with Gemini 3.8 Flash TTS.

Audio is uploaded as a GitHub Actions artifact; it is never committed to the public repo.
The Gemini API key is read only from the GEMINI_API_KEY Actions secret.
"""
import json
import os
from pathlib import Path

from google import genai
from google.genai import types

MODEL = "gemini-3.8-flash-tts"
OUT = Path("podki-voiceovers")
VOICE = "Charon"

# Keep the name fully vocalized in EVERY spoken transcript.
SCENES = [
    ("01-intro", "הכירו את פּוֹדְקִי! הדרך הנוחה לגלות פודקאסטים ולשמור את הפרקים שאתם אוהבים."),
    ("02-discovery", "מחפשים פודקאסט חדש? פּוֹדְקִי עוזר לכם למצוא ערוצים ופרקים שמתאימים בדיוק לכם."),
    ("03-email", "מצאתם פרק מעניין? בוחרים אותו ושולחים בקשת שמירה פשוטה במייל. פּוֹדְקִי מטפל בהמשך."),
    ("04-drive", "פּוֹדְקִי שומר את קובצי השמע בדרייב שלכם, מסודרים לפי ערוצים. מגלים, שומרים ומאזינים!"),
]

def main():
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY repository secret is missing or empty.")
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    manifest = []
    try:
        for file_stem, transcript in SCENES:
            if "פודקי" in transcript or "פּוֹדְקִי" not in transcript:
                raise ValueError(f"Unvocalized/missing product name in {file_stem}")
            print(f"Producing {file_stem} with {MODEL} ...")
            response = client.models.generate_content(
                model=MODEL,
                contents=types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=transcript,
                            speech_metadata=types.SpeechMetadata(
                                style=(
                                    "Natural, polished Israeli Hebrew; warm, friendly male "
                                    "technology-news presenter voice, medium pace, clear articulation; "
                                    "say the name פּוֹדְקִי exactly as written. "
                                    "Read ONLY the supplied Hebrew transcript, without additions."
                                )
                            ),
                        )
                    ],
                ),
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            voice=VOICE
                        )
                    ),
                ),
            )
            audio = next(
                (part.inline_data.data for part in (response.parts or [])
                 if part.inline_data and part.inline_data.data),
                None
            )
            if not audio:
                raise RuntimeError(f"{file_stem}: Gemini produced no audio.")
            # The new 3.8 TTS non-streaming API returns a complete WAV.
            if not bytes(audio).startswith(b"RIFF"):
                raise RuntimeError(f"{file_stem}: API returned unexpected non-WAV bytes.")
            output = OUT / (file_stem + ".wav")
            output.write_bytes(audio)
            manifest.append({"file": output.name, "transcript": transcript, "model": MODEL, "voice": VOICE})
            print(f"Saved {output.name} ({len(audio)} bytes)")
    finally:
        client.close()
    (OUT / "transcripts.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "README.txt").write_text(
        "קריינות לפודקי - הקלטות ניסיון לפי סצנות.\\n"
        "השמות בכל התמלילים מנוקדים: פּוֹדְקִי.\\n"
        "בדקו את ההגייה, התוכן ומשך הקריינות לפני עריכה לסרטון.\\n",
        encoding="utf-8",
    )

if __name__ == "__main__":
    main()
