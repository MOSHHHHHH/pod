#!/usr/bin/env python3
"""Generate independent Hebrew narrator tracks for the Podki control-room promo.

The WAV files and transcripts are uploaded as Actions artifacts only.
Never write the API key to logs or files.
"""
import base64
import os
from pathlib import Path
import time
import wave

from google import genai

MODEL = "gemini-3.8-flash-tts"
VOICE = "Charon"
OUT = Path("podki-promo-narration")
SCENES = [
    (
        "01-control-room",
        "בעולם של אינסוף פודקאסטים, יש מי שעושה בשבילכם את העבודה. "
        "הכירו את פּוֹדְקִי — הדרך החכמה למצוא, לארגן ולשמור את הפודקאסטים שאתם אוהבים.",
    ),
    (
        "02-discovery",
        "מחפשים פודקאסט מסוים? או פרק שמעניין אתכם? "
        "פּוֹדְקִי מאתר את התוכן, מציג את הפרקים הזמינים, "
        "ומאפשר לכם לבחור בדיוק מה תרצו לשמור.",
    ),
]
STYLE = (
    "Narrate in polished, natural Israeli Hebrew with a confident, deep male "
    "professional television technology-promo announcer voice. Dramatic but "
    "not exaggerated; clear diction, measured pace, energetic emphasis and "
    "consistent timbre across both scenes. This is an external narrator, NOT "
    "Podki speaking. Pronounce פּוֹדְקִי as Podki. Read ONLY the exact Hebrew "
    "script. No intro, dialogue, music, sound effects or extra words."
)


def synthesize(client, slug, transcript):
    for attempt in range(1, 5):
        try:
            result = client.interactions.create(
                model=MODEL,
                input=[{
                    "type": "user_input",
                    "content": [{
                        "type": "text",
                        "text": transcript,
                        "annotations": [{"type": "speech_metadata", "style": STYLE}],
                    }],
                }],
                response_format={"type": "audio"},
                generation_config={"speech_config": [{"voice": VOICE}]},
            )
            data = base64.b64decode(result.output_audio.data)
            if not data.startswith(b"RIFF") or b"WAVE" not in data[:16]:
                raise RuntimeError(f"{slug}: unexpected audio format (expected WAV)")
            return data
        except Exception as exc:
            message = str(exc).lower()
            transient = any(x in message for x in ("429", "500", "502", "503", "504", "unavailable", "timeout"))
            # Never print the raw error: some SDK errors contain sensitive request data.
            if not transient or attempt == 4:
                raise RuntimeError(f"{slug}: Gemini generation failed (transient={transient}, attempt={attempt})") from None
            delay = 5 * (2 ** (attempt - 1))
            print(f"{slug}: temporary Gemini error; retry {attempt}/3 after {delay}s")
            time.sleep(delay)


def main():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise SystemExit("Missing GEMINI_API_KEY repository Actions secret.")
    OUT.mkdir(exist_ok=True)
    client = genai.Client(api_key=key)
    try:
        for slug, transcript in SCENES:
            if "פודקי" in transcript:
                raise ValueError("Write mascot name with niqqud: פּוֹדְקִי")
            (OUT / (slug + ".txt")).write_text(transcript + "\n", encoding="utf-8")
            print(f"Generating {slug} with {MODEL}...")
            data = synthesize(client, slug, transcript)
            path = OUT / (slug + ".wav")
            path.write_bytes(data)
            with wave.open(str(path), "rb") as wav:
                duration = wav.getnframes() / wav.getframerate()
            print(f"{slug}: {duration:.2f}s WAV")
            if not 3 <= duration <= 40:
                raise RuntimeError(f"{slug}: audio duration outside expected range")
        (OUT / "README.txt").write_text(
            "קריינות חיצונית בעברית לסרטון חדר הבקרה של פודקי.\n"
            "שני קטעי WAV נפרדים, ללא מוזיקה, לסנכרון מול סרטוני Flow.\n"
            "טקסטים תואמים מצורפים בכל קטע.\n",
            encoding="utf-8",
        )
        print("Narration generated successfully.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
