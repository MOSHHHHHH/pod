#!/usr/bin/env python3
"""Generate Hebrew Podki promo narration as individual WAV files using Gemini 3.8 Flash TTS.
Use the GEMINI_API_KEY environment secret. Never print it.
"""
import base64
import os
from pathlib import Path
import wave

from google import genai

MODEL = "gemini-3.8-flash-tts"
VOICE = "Puck"
OUT = Path("podki-promo-narration")
OUT.mkdir(exist_ok=True)

# Always use niqqud for the mascot's name in spoken scripts: פּוֹדְקִי.
SCENES = [
    ("01-intro", "היי! אני פּוֹדְקִי, ואני כאן כדי להפוך את עולם הפודקאסטים שלכם לפשוט ונוח יותר!"),
    ("02-search", "מחפשים פודקאסט חדש? פּוֹדְקִי מוצא עבורכם ערוצים ופרקים, ומאפשר לבחור בדיוק את מה שמעניין אתכם."),
    ("03-request", "מצאתם פרק שאהבתם? בוחרים את הפרקים הרצויים, שולחים בקשה פשוטה במייל, וזה הכול!"),
    ("04-drive", "פּוֹדְקִי שומר את הפרקים שביקשתם ישירות בדרייב שלכם, מסודרים לפי ערוצים. מגלים, שומרים ומאזינים — בדרך שלכם!"),
]

STYLE = (
    "Speak in natural modern Israeli Hebrew, as a warm, cheerful male technology-news "
    "presenter in a friendly podcast promo. Energetic but not theatrical, clearly articulated, "
    "medium-fast tempo and consistent timbre between takes. "
    "Read the Hebrew text exactly as written, including the vocalized mascot name פּוֹדְקִי. "
    "No music, effects, introductions or extra words."
)

def main():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY repository secret is missing.")
    client = genai.Client(api_key=key)
    for slug, transcript in SCENES:
        assert "פודקי" not in transcript, "Mascot name must always be vocalized."
        print(f"Generating {slug} using {MODEL}...")
        result = client.interactions.create(
            model=MODEL,
            input=[{
                "type": "user_input",
                "content": [{
                    "type": "text",
                    "text": transcript,
                    "annotations": [{
                        "type": "speech_metadata",
                        "style": STYLE,
                    }],
                }],
            }],
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": VOICE}]},
        )
        data = base64.b64decode(result.output_audio.data)
        if not data.startswith(b"RIFF") or b"WAVE" not in data[:16]:
            raise RuntimeError(f"{slug}: API did not return a WAV file")
        path = OUT / (slug + ".wav")
        path.write_bytes(data)
        (OUT / (slug + ".txt")).write_text(transcript + "\n", encoding="utf-8")
        with wave.open(str(path), "rb") as wav:
            duration = wav.getnframes() / wav.getframerate()
            print(f"{slug}: {duration:.2f}s, {wav.getframerate()} Hz, {len(data)} bytes")
        if not (2 <= duration <= 45):
            raise RuntimeError(f"{slug}: unexpected duration {duration:.2f}s")
    (OUT / "README.txt").write_text(
        "קריינות לסרטון פודקי | Gemini 3.8 Flash TTS | WAV ללא מוזיקה\n"
        "הקריינות מופרדת לסצנות; יש לבצע סנכרון ועריכה מול סרטוני Flow.\n",
        encoding="utf-8",
    )
    print("All narration clips generated successfully.")

if __name__ == "__main__":
    main()
