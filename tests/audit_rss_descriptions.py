#!/usr/bin/env python3
"""Read-only audit of subscribed podcast RSS descriptions. No audio downloaded."""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
ATOM = "{http://www.w3.org/2005/Atom}"

def text(node, paths):
    for path in paths:
        match = node.find(path)
        if match is not None and match.text:
            return match.text
    return ""

def extract(blob):
    root = ET.fromstring(blob)
    channel = root.find("channel")
    if channel is not None:
        title = text(channel, ["title"])
        episodes = []
        for item in channel.findall("item"):
            episodes.append({
                "title": text(item, ["title"]),
                "date": text(item, ["pubDate"]),
                "guid": text(item, ["guid"]),
                # GAS currently uses RSS description; content:encoded retained for audit comparison.
                "raw": text(item, ["description"]),
                "content_encoded": text(item, [CONTENT+"encoded"]),
            })
        return title, episodes
    title = text(root, [ATOM+"title"])
    episodes = []
    for item in root.findall(ATOM+"entry"):
        episodes.append({
            "title": text(item, [ATOM+"title"]),
            "date": text(item, [ATOM+"published", ATOM+"updated"]),
            "guid": text(item, [ATOM+"id"]),
            "raw": text(item, [ATOM+"summary", ATOM+"content"]),
            "content_encoded": "",
        })
    if episodes:
        return title, episodes
    raise ValueError("Neither RSS channel/items nor Atom entries found")

def normalize(values):
    if not values:
        return []
    proc = subprocess.run(
        ["node", "tests/rss_description_normalize.cjs"],
        input=json.dumps(values, ensure_ascii=False), capture_output=True, text=True, timeout=120
    )
    if proc.returncode:
        raise RuntimeError("Node normalizer: "+proc.stderr[-1200:])
    return json.loads(proc.stdout)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--feeds", default="tests/subscribed_rss_urls.txt")
    parser.add_argument("--out", default="rss-audit-output")
    parser.add_argument("--timeout", type=int, default=35)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    urls = [line.strip() for line in Path(args.feeds).read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")]
    summary = {"date_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
               "feed_count": len(urls), "feeds": [], "episodes_total": 0,
               "episodes_nonempty": 0, "normalizer_unstable": 0, "failed_feeds": 0}
    for i, url in enumerate(urls, 1):
        result = {"index": i, "url": url, "status": "error", "episodes": []}
        print(f"[{i}/{len(urls)}] Downloading RSS {url}", flush=True)
        try:
            req = Request(url, headers={"User-Agent": "Podki-RSS-Description-Audit/1.0", "Accept": "application/rss+xml, application/xml, text/xml, */*"})
            with urlopen(req, timeout=args.timeout) as response:
                raw_bytes = response.read(12 * 1024 * 1024 + 1)
            if len(raw_bytes) > 12 * 1024 * 1024:
                raise ValueError("RSS feed larger than 12 MiB safety limit")
            title, episodes = extract(raw_bytes)
            normalized = normalize([e["raw"] for e in episodes])
            if len(normalized) != len(episodes):
                raise ValueError("Normalizer output count mismatch")
            for ep, norm in zip(episodes, normalized):
                ep.update(norm)
            nonempty = sum(bool(e["raw"].strip()) for e in episodes)
            unstable = sum(not e["stable"] for e in episodes)
            result.update(status="ok", title=title, episodes=episodes, count=len(episodes),
                          nonempty=nonempty, unstable=unstable, rss_bytes=len(raw_bytes))
            summary["episodes_total"] += len(episodes)
            summary["episodes_nonempty"] += nonempty
            summary["normalizer_unstable"] += unstable
            print(f"  OK {title}: {len(episodes)} episodes, {unstable} unstable", flush=True)
        except Exception as e:
            result["error"] = f"{type(e).__name__}: {e}"
            summary["failed_feeds"] += 1
            print("  ERROR "+result["error"], flush=True)
        (out / f"feed-{i:02}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        summary["feeds"].append({k:v for k,v in result.items() if k!="episodes"})
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    with (out / "summary.md").open("w", encoding="utf-8") as f:
        f.write("# Podcast description audit\n\n")
        f.write(f"Feeds: {len(urls)}; episodes: {summary['episodes_total']}; nonempty: {summary['episodes_nonempty']}; failed feeds: {summary['failed_feeds']}; unstable normalization: {summary['normalizer_unstable']}\n\n")
        f.write("| Feed | Episodes | Unstable | Status |\n|---|---:|---:|---|\n")
        for row in summary["feeds"]:
            f.write(f"| {str(row.get('title') or row['url']).replace('|','/')} | {row.get('count',0)} | {row.get('unstable',0)} | {row['status']} |\n")
    if summary["episodes_nonempty"] < 20:
        raise SystemExit("AUDIT FAILED: fewer than 20 real descriptions")
    if summary["normalizer_unstable"]:
        raise SystemExit("AUDIT FAILED: text normalization not idempotent")
    if summary["failed_feeds"]:
        raise SystemExit("AUDIT PARTIAL: some RSS feeds could not be read")
    print("AUDIT SUCCESS: all feeds processed and >=20 descriptions checked")

if __name__ == "__main__":
    main()
