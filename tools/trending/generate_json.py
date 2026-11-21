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
    return sum("א" <= ch <= "ת" for ch in title) / len(title) if title else 0.0

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

# Thirty experiments; balanced is the provisional default.
SCENARIOS = {
    "balanced": (35,25,15,15,10),
    "relevance_first": (60,15,10,10,5),
    "freshness_first": (25,45,10,10,10),
    "trend_popularity_first": (25,15,40,10,10),
    "quality_first": (25,15,10,40,10),
    "multi_trend_first": (25,15,10,10,40),
    "relevance_quality": (40,10,5,40,5),
    "news_focused": (35,40,15,5,5),
    "discovery_focused": (20,15,20,20,25),
    "even_weights": (20,20,20,20,20),
    "extreme_relevance_90": (90,3,3,3,1),
    "extreme_freshness_90": (3,90,3,3,1),
    "extreme_popularity_90": (3,3,90,3,1),
    "extreme_quality_90": (3,3,3,90,1),
    "extreme_multi_trend_90": (3,3,3,1,90),
    "pure_relevance": (100,0,0,0,0),
    "pure_freshness": (0,100,0,0,0),
    "pure_popularity": (0,0,100,0,0),
    "pure_quality": (0,0,0,100,0),
    "pure_multi_trend": (0,0,0,0,100),
    "relevance_freshness": (50,50,0,0,0),
    "relevance_popularity": (50,0,50,0,0),
    "relevance_multi_trend": (50,0,0,0,50),
    "freshness_quality": (0,50,0,50,0),
    "popularity_quality": (0,0,50,50,0),
    "quality_multi_trend": (0,0,0,50,50),
    "strong_relevance_freshness": (45,40,5,5,5),
    "strong_relevance_quality": (45,5,5,40,5),
    "freshness_popularity": (5,45,40,5,5),
    "quality_diversity": (10,10,10,35,35),
}
METRICS = ("relevance","freshness","popularity","quality","multi_trend")

def decision_scores(client, items, instructions, criteria):
    """One Gemini Decision 1 scoring question per item, batched."""
    results = []
    for start in range(0, len(items), 15):
        batch = items[start:start+15]
        shared = "\n\n".join(f"ITEM {i}: {item}" for i,item in enumerate(batch))
        questions = {
            f"item_{i}": {
                "type":"score",
                "instructions":f"Evaluate ITEM {i} only. {instructions}",
                "criteria":criteria
            } for i in range(len(batch))
        }
        response = client.decisions.create(
            model="gemini-decision-1", input=shared, questions=questions)
        for i in range(len(batch)):
            ans = response.answers[f"item_{i}"]
            results.append((round(float(ans.score)*25,2), float(ans.confidence)))
    return results

def main():
    from google import genai
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY secret is required")
    client = genai.Client(api_key=key, http_options={"api_version":"v1beta"})
    ts = trends()
    history = load_history()
    candidates = []
    seen = set()
    filtered_non_hebrew = 0
    for trend in ts:
        for ep in episodes(trend["term"]):
            eid = str(ep.get("trackId") or ep.get("episodeUrl") or "")
            if not eid or (trend["term"], eid) in seen:
                continue
            seen.add((trend["term"], eid))
            title = ep.get("trackName") or ""
            if hebrew_share(title) < .20:
                filtered_non_hebrew += 1
                continue
            description = re.sub("<[^>]*>", " ", ep.get("description") or ep.get("shortDescription") or "")
            if not description.strip():
                continue
            candidates.append({
                "trend":trend["term"],"traffic":trend["traffic"],
                "episode_id":eid,"title":title,
                "podcast":ep.get("collectionName",""),
                "description":description[:1600],
                "published_at":ep.get("releaseDate"),
                "episode_url":ep.get("trackViewUrl") or ep.get("episodeUrl"),
                "feed_url":ep.get("feedUrl"),
                "duration_ms":ep.get("trackTimeMillis"),
                "image_url":ep.get("artworkUrl600") or ep.get("artworkUrl100")
            })
    # Limit Decision API costs; score each episode-trend association only once.
    candidates = candidates[:60]
    if not candidates:
        raise RuntimeError("No Hebrew-titled episode candidates found")
    inputs = [
        f"TREND {x['trend']}; EPISODE {x['title']}; SHOW {x['podcast']}; DESCRIPTION {x['description']}"
        for x in candidates
    ]
    relevance = decision_scores(
        client, inputs,
        "How closely does the episode actually address the specific trending search intent? Penalize keyword-only coincidences.",
        ["Unrelated","Weak overlap","Some relevance","Strong relevance","Directly addresses intent"])
    # Assess likely content value and event currency using metadata only, not audio.
    unique = {}
    for x in candidates:
        unique.setdefault(x["episode_id"], x)
    unique_items = list(unique.values())
    quality_inputs = [
        f"EPISODE {x['title']}; SHOW {x['podcast']}; DESCRIPTION {x['description']}"
        for x in unique_items
    ]
    quality = decision_scores(
        client, quality_inputs,
        "Estimate expected informational value, specificity and substance based ONLY on the title and description. Do not claim to have heard the episode.",
        ["No evident value","Very limited","Moderate","Substantial","Exceptional"])
    currency_inputs = [
        f"TREND {x['trend']}; EPISODE {x['title']}; PUBLISHED {x['published_at']}; DESCRIPTION {x['description']}"
        for x in candidates
    ]
    currency = decision_scores(
        client, currency_inputs,
        "Assess whether this episode's discussion is still current for the trending event as of "+NOW.date().isoformat()+". Distinguish previews from post-event analysis. Use metadata only.",
        ["Clearly obsolete","Mostly outdated","Unclear or evergreen","Mostly current","Directly current"])
    topics = list(dict.fromkeys(x["trend"] for x in candidates))
    topic_pairs = [(a,b) for i,a in enumerate(topics) for b in topics[i+1:]]
    similarities = {}
    if topic_pairs:
        sim_inputs = [f"TREND A: {a}; TREND B: {b}" for a,b in topic_pairs]
        sim_scores = decision_scores(
            client, sim_inputs,
            "Are these essentially the SAME public interest or event, not merely broadly related? Score high only for near-duplicate search intents.",
            ["Unrelated","Weakly related","Related but distinct","Nearly same","Same intent"])
        similarities = {tuple(sorted(pair)):score/100 for pair,(score,_) in zip(topic_pairs,sim_scores)}
    max_traffic = max((traffic_value(x["traffic"]) for x in candidates),default=0)
    grouped = {}
    for i,x in enumerate(candidates):
        popularity = 100*traffic_value(x["traffic"])/max_traffic if max_traffic else 0
        dated = recency(parse_date(x["published_at"]))
        # Blend actual release age and semantic event currency.
        freshness = round(.5*dated+.5*currency[i][0],2)
        assoc = {**x,"relevance":relevance[i][0],
                 "decision_confidence":relevance[i][1],
                 "event_currency":currency[i][0],
                 "release_recency":dated,"freshness":freshness,
                 "popularity":round(popularity,2)}
        grouped.setdefault(x["episode_id"],[]).append(assoc)
    ranked = []
    for eid, associations in grouped.items():
        primary = max(associations,key=lambda a:(a["relevance"]*.7+a["popularity"]*.3))
        extras = sorted((a for a in associations if a is not primary),
                        key=lambda a:a["relevance"]*a["popularity"],reverse=True)
        counted = [primary["trend"]]
        bonus = 0.0
        for a in extras:
            novelty = 1-max((similarities.get(tuple(sorted((a["trend"],t))),0)
                             for t in counted),default=0)
            bonus += 10*(a["relevance"]/100)*(a["popularity"]/100)*novelty
            counted.append(a["trend"])
        # Multi-trend metric is capped and normalized to 0..100.
        multi_trend = round(min(100,bonus*10),2)
        q = quality[unique_items.index(unique[eid])][0]
        entry = {**primary, "quality":q,"multi_trend":multi_trend,
                 "extra_trend_bonus_points":round(min(10,bonus),2),
                 "matched_trends":associations,
                 "repetition_penalty":repetition_penalty(primary,history)}
        # Also discourage repeat shows; requires persistent history to be effective.
        for item in history:
            date = parse_date(item.get("recommended_at") or item.get("date"))
            if date and 0 <= (NOW-date).total_seconds()/86400 < 7 and item.get("podcast")==entry["podcast"]:
                entry["repetition_penalty"] = min(70,entry["repetition_penalty"]+12)
        ranked.append(entry)
    experiments = []
    for name,weights in SCENARIOS.items():
        scored = []
        for item in ranked:
            raw = sum(item[k]*w/100 for k,w in zip(METRICS,weights))
            score = round(max(0,raw-item["repetition_penalty"]),2)
            scored.append({**item,"base_score":round(raw,2),"total_score":score})
        scored.sort(key=lambda x:(x["total_score"],x["relevance"]),reverse=True)
        experiments.append({
            "name":name,"weights":dict(zip(METRICS,weights)),
            "recommendation":scored[0] if scored else None,
            "top_5":[{"episode_id":x["episode_id"],"title":x["title"],
                      "podcast":x["podcast"],"trend":x["trend"],
                      "score":x["total_score"]} for x in scored[:5]]
        })
    assert len(SCENARIOS)==30 and all(sum(w)==100 for w in SCENARIOS.values())
    result = {
        "generated_at":NOW.isoformat(),"model":"gemini-decision-1",
        "selected_scenario":"balanced",
        "recommendation":experiments[0]["recommendation"],
        "status":"experiment_only_no_email",
        "trends_scanned":len(ts),"episode_trend_pairs_evaluated":len(candidates),
        "unique_episodes":len(ranked),
        "filtered_non_hebrew_titles":filtered_non_hebrew,
        "history_entries_loaded":len(history),
        "hebrew_title_threshold":.20,
        "methodology":"Quality and event currency estimated from metadata only; multi-trend bonus discounts similar topics; all scenarios reuse identical model assessments.",
        "trend_similarities":[{"a":a,"b":b,"similarity":v} for (a,b),v in similarities.items()],
        "experiments":experiments,
        "candidates":ranked
    }
    (OUT/"daily_recommendation.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    latest_path = Path("data/trending/latest.json")
    latest_path.parent.mkdir(parents=True,exist_ok=True)
    latest_path.write_text(json.dumps({"generated_at":result["generated_at"],"selected_scenario":"balanced","recommendation":result["recommendation"]},ensure_ascii=False,indent=2),encoding="utf-8")
    # Experiment archive is not publication history; do not penalize unpublished choices.
    run_id = os.getenv("GITHUB_RUN_ID", NOW.strftime("%Y%m%dT%H%M%S"))
    archive = Path("data/trending/experiments")
    archive.mkdir(parents=True,exist_ok=True)
    archive_file = archive / (str(run_id)+".json")
    archive_file.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    summary_path = Path("data/trending/experiment_history.json")
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {"schema_version":1,"runs":[]}
    runs = [entry for entry in summary.get("runs",[]) if str(entry.get("run_id"))!=str(run_id)]
    chosen = experiments[0]["recommendation"]
    runs.append({"run_id":str(run_id),"generated_at":NOW.isoformat(),
                 "selected_scenario":"balanced","selected_episode_id":chosen["episode_id"],
                 "selected_title":chosen["title"],"selected_score":chosen["total_score"],
                 "scenarios":len(experiments),"archive_path":str(archive_file)})
    summary["runs"] = sorted(runs,key=lambda entry:entry["generated_at"])
    summary_path.parent.mkdir(parents=True,exist_ok=True)
    summary_path.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Scanned {len(ts)} trends, filtered {filtered_non_hebrew} titles, assessed {len(candidates)} pairs and {len(ranked)} unique episodes.")
    for exp in experiments:
        chosen = exp["recommendation"]
        print(f"{exp['name']}: {chosen['title'] if chosen else 'NONE'} ({chosen['total_score'] if chosen else '-'})")
    print("Output: trending-output/daily_recommendation.json")

if __name__=="__main__":
    main()
