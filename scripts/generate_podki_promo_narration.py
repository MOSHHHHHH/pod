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
    """Use the documented GenerateContent TTS API; emit safe, actionable diagnostics."""
    for attempt in range(1, 5):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[{
                    "role": "user",
                    "parts": [{
                        "text": transcript,
                        "speech_metadata": {"style": STYLE},
                    }],
                }],
                config={
                    "response_modalities": ["AUDIO"],
                    "speech_config": {"voice_config": {"voice": VOICE}},
                },
            )
            parts = response.candidates[0].content.parts if response.candidates else []
            audio = next(
                (p.inline_data.data for p in parts if p.inline_data and p.inline_data.data),
                None,
            )
            if not audio:
                raise RuntimeError("EMPTY_AUDIO: Gemini returned no audio parts")
            data = bytes(audio)  # google-genai already decodes base64
            if not data.startswith(b"RIFF") or b"WAVE" not in data[:16]:
                raise RuntimeError("UNEXPECTED_FORMAT: expected a complete WAV")
            return data
        except Exception as exc:
            import re
            status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
            category = type(exc).__name__
            # Show the meaningful API diagnostic while redacting the key and credentials.
            detail = str(exc).replace(os.environ["GEMINI_API_KEY"], "[REDACTED]")
            detail = re.sub(r"(?i)(key|token|authorization|password)([=: ]+)([^\\s,;]+)",
                            r"\\1\\2[REDACTED]", detail)
            detail = detail.replace("\\n", " ")[:450]
            print(f"::error title=Gemini TTS {slug}::{category}; HTTP={status}; {detail}", flush=True)
            transient = str(status) in ("429", "500", "502", "503", "504") or any(
                word in detail.lower() for word in ("timeout", "temporarily unavailable", "overloaded")
            )
            if not transient or attempt == 4:
                raise RuntimeError(f"{slug}: TTS failed (HTTP={status}, type={category})") from None
            delay = 5 * (2 ** (attempt - 1))
            print(f"{slug}: retry after {delay}s ({attempt}/3)", flush=True)
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
