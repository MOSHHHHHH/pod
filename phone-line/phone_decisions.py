"""Gemini Decisions checks for caller audio and completed conversation audio."""

import base64
import json
import math
from urllib.request import Request, urlopen

from phone_menu import DECISION_MODEL

DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions"
MONITOR_RULES = {
    "sexual_content": "האם נשמע בחלון השמע דיון על מיניות, על אחד מהיבטיה?",
    "shouting": "האם נשמעת צעקה של הדובר? התחשב באופן הדיבור ובעוצמה היחסית.",
    "profanity": "האם נשמעת קללה ברורה מפי הדובר?",
}
TOPICS = {
    "israel_politics": "פוליטיקה בישראל", "world_news": "חדשות בעולם", "security": "ביטחון",
    "economy": "כלכלה", "consumer": "צרכנות", "science": "מדע", "technology": "טכנולוגיה",
    "ai": "בינה מלאכותית", "health": "בריאות כללית", "education": "חינוך",
    "judaism": "דת ויהדות", "law": "משפט וממשל", "transport": "תחבורה",
    "weather": "מזג אוויר", "environment": "סביבה", "history": "היסטוריה",
    "geography": "גאוגרפיה", "culture": "תרבות", "music": "מוזיקה",
    "books": "ספרים", "sports": "ספורט", "travel": "תיירות", "food": "אוכל",
    "work": "עבודה", "languages": "שפות",
}


def evaluate_audio(api_key, wav_audio, questions, *, timeout):
    """Evaluate named yes/no questions against one inline WAV recording."""
    if not api_key or wav_audio[:4] != b"RIFF" or wav_audio[8:12] != b"WAVE":
        raise ValueError("A Gemini API key and WAV audio are required")
    body = {
        "model": DECISION_MODEL,
        "input": [{
            "type": "audio", "mime_type": "audio/wav",
            "data": base64.b64encode(wav_audio).decode("ascii"),
        }],
        "questions": {
            key: {"type": "noul", "instructions": instruction}
            for key, instruction in questions.items()
        },
    }
    request = Request(
        DECISIONS_URL,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    with urlopen(request, timeout=timeout) as response:
        answers = json.loads(response.read(262144))["answers"]
    scores = {}
    for key in questions:
        answer = answers[key]
        probability = answer["noul"]
        if answer.get("type") != "noul" or type(probability) not in (float, int) or not 0 <= probability <= 1:
            raise ValueError(f"Invalid decision result for {key}")
        scores[key] = probability
    return scores


def check_caller(api_key, caller_wav, thresholds, *, timeout=3):
    """Return rule and score for each possible violation; propagate service errors."""
    if set(thresholds) != set(MONITOR_RULES):
        raise ValueError("Configure one threshold per moderation rule")
    if any(not math.isfinite(value) or not 0.5 < value <= 1 for value in thresholds.values()):
        raise ValueError("Moderation thresholds must be above 0.5 and at most 1")
    scores = evaluate_audio(api_key, caller_wav, MONITOR_RULES, timeout=timeout)
    return {rule: score for rule, score in scores.items() if score >= thresholds[rule]}


def classify_call(api_key, conversation_wav, *, threshold=0.7, timeout=20):
    """Return the topic IDs discussed in one completed conversation."""
    if not math.isfinite(threshold) or not 0.5 < threshold <= 1:
        raise ValueError("Topic threshold must be above 0.5 and at most 1")
    questions = {
        topic: f"האם בשיחה התקיים דיון של ממש בנושא {label}?"
        for topic, label in TOPICS.items()
    }
    scores = evaluate_audio(api_key, conversation_wav, questions, timeout=timeout)
    return [topic for topic, score in scores.items() if score >= threshold]
