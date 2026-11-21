#!/usr/bin/env python3
"""Standalone Podki trending recommendation experiment. Does not send email."""
import datetime as dt
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
HEADERS = {"User-Agent": "Podki-Trending-Experiment/1.0"}
OUT = Path("trending-output")
OUT.mkdir(exist_ok=True)

def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read()

def trends():
    root = ET.fromstring(get("https://trends.google.com/trending/rss?geo=IL"))
    items = []
    for item in root.findall("./channel/item")[:15]:
        title = (item.findtext("title") or "").strip()
        if title:
            traffic = next((e.text for e in item if e.tag.endswith("approx_traffic")), None)
            items.append({"term": title, "traffic": traffic})
    return items

def traffic_value(s):
    if not s:
        return 0
    m = re.search(r"([\d,.]+)\s*([KMB]?)", s, re.I)
    if not m:
        return 0
    return float(m.group(1).replace(",", "")) * {"":1,"K":1000,"M":1000000,"B":1000000000}[m.group(2).upper()]

def episodes(term):
    qs = urllib.parse.urlencode({"term": term, "media":"podcast", "entity":"podcastEpisode", "country":"IL", "limit":15})
    data = json.loads(get("https://itunes.apple.com/search?" + qs))
    return [r for r in data.get("results", []) if r.get("kind") == "podcast-episode" or r.get("wrapperType") == "podcastEpisode"]

def parse_date(s):
    try:
        return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
    except (ValueError, AttributeError):
        return None

def recency(date):
    if not date:
        return 0
    days = max(0, (NOW - date).days)
    return round(100 * (0.5 ** (days / 30)), 2)

def hebrew_share(title):
    """Hebrew letters divided by all Unicode characters in the episode title."""
    return sum("\\u05d0" <= ch <= "\\u05ea" for ch in title) / len(title) if title else 0.0

def normalize_topic(topic):
    return " ".join((topic or "").casefold().split())

def load_history():
    """Optional persistent recommendation history, supplied by a later publishing workflow."""
    path = Path(os.getenv("TRENDING_HISTORY_PATH", "data/trending/history.json"))
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data.get("recommendations", [])

def repetition_penalty(candidate, history):
    """Recent repeated episodes and topics lose points, without hard exclusion."""
    penalty = 0.0
    for item in history:
        date = parse_date(item.get("recommended_at") or item.get("date"))
        if not date:
            continue
        days = (NOW - date).total_seconds() / 86400
        if days < 0 or days > 90:
            continue
        if str(item.get("episode_id")) == candidate["episode_id"]:
            penalty += 45 * (1 - days / 90)
        if normalize_topic(item.get("trend")) == normalize_topic(candidate["trend"]):
            penalty += 25 * (1 - days / 14) if days < 14 else 0
    return round(min(70, penalty), 2)

def main():
    from google import genai
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY secret is required; no unranked recommendation will be published")
    client = genai.Client(api_key=key, http_options={"api_version":"v1beta"})
    ts = trends()
    candidates = []
    seen = set()
    filtered_non_hebrew = 0
    history = load_history()
    for trend in ts:
        for ep in episodes(trend["term"]):
            eid = str(ep.get("trackId") or ep.get("episodeUrl") or "")
            if not eid or (trend["term"],eid) in seen:
                continue
            seen.add((trend["term"],eid))
            title = ep.get("trackName") or ""
            if hebrew_share(title) < 0.20:
                filtered_non_hebrew += 1
                continue
            published = ep.get("releaseDate")
            description = re.sub("<[^>]*>", " ", ep.get("description") or ep.get("shortDescription") or "")
            if not description.strip():
                continue
            candidates.append({
                "trend":trend["term"],"traffic":trend["traffic"],
                "episode_id":eid,"title":title,
                "podcast":ep.get("collectionName",""),
                "description":description[:1600],
                "published_at":published,
                "episode_url":ep.get("trackViewUrl") or ep.get("episodeUrl"),
                "feed_url":ep.get("feedUrl"),
                "duration_ms":ep.get("trackTimeMillis")
            })
    # Keep a modest bounded test set; use one decision question per candidate.
    candidates = candidates[:60]
    if not candidates:
        raise RuntimeError("No podcast episode candidates returned from Apple Podcasts")
    ranked = []
    for start in range(0,len(candidates),15):
        batch = candidates[start:start+15]
        shared = "\n\n".join(
            f"ITEM {i}: TREND {x['trend']}\nEPISODE {x['title']}\nSHOW {x['podcast']}\nDESCRIPTION {x['description']}"
            for i,x in enumerate(batch))
        questions = {
            f"item_{i}":{"type":"score",
              "instructions":f"Evaluate ITEM {i}: How closely does this episode genuinely address the specific trending search intent, rather than just sharing a keyword? Penalize unrelated or misleading matches.",
              "criteria":["Unrelated","Weak keyword overlap","Some topical relevance","Strong relevant explanation","Directly addresses search intent"]}
            for i in range(len(batch))}
        response = client.decisions.create(model="gemini-decision-1",input=shared,questions=questions)
        for i,x in enumerate(batch):
            ans = response.answers[f"item_{i}"]
            relevance = round(float(ans.score)/4*100,2)
            freshness = recency(parse_date(x["published_at"]))
            ranked.append({**x,"relevance":relevance,"freshness":freshness,"decision_confidence":float(ans.confidence)})
    max_traffic = max((traffic_value(x["traffic"]) for x in ranked),default=0)
    for x in ranked:
        popularity = 100*traffic_value(x["traffic"])/max_traffic if max_traffic else 0
        x["popularity"] = round(popularity,2)
        x["base_score"] = round(.55*x["relevance"]+.30*x["freshness"]+.15*popularity,2)
        x["repetition_penalty"] = repetition_penalty(x, history)
        x["total_score"] = round(max(0, x["base_score"] - x["repetition_penalty"]),2)
    ranked.sort(key=lambda x:x["total_score"],reverse=True)
    eligible = [x for x in ranked if x["relevance"]>=80 and x["total_score"]>=75]
    result = {
        "generated_at":NOW.isoformat(),"model":"gemini-decision-1",
        "source":"Google Trends Israel RSS + Apple iTunes Search API",
        "status":"candidate_only_no_email",
        "trends_scanned":len(ts),"episodes_evaluated":len(ranked),\n        "filtered_non_hebrew_titles":filtered_non_hebrew,\n        "history_entries_loaded":len(history),"hebrew_title_threshold":0.20,
        "recommendation":eligible[0] if eligible else None,
        "reason": "Highest weighted score above quality thresholds" if eligible else "No episode passed quality thresholds",
        "candidates":ranked[:20]
    }
    (OUT/"daily_recommendation.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Scanned {len(ts)} trends, filtered {filtered_non_hebrew} non-Hebrew titles, ranked {len(ranked)} episodes, eligible {len(eligible)}, history entries {len(history)}")
    print("Output: trending-output/daily_recommendation.json")

if __name__=="__main__":
    main()
