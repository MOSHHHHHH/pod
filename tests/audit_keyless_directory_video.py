#!/usr/bin/env python3
"""Keyless Podcast Index directory search audit for subscribed RSS feeds.
Read-only: never downloads media and never modifies subscription data.
Results are candidates, not verified matching video episodes.
"""
import datetime as dt
import difflib
import ipaddress
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

POD = "{https://podcastindex.org/namespace/1.0}"
MEDIA = "{http://search.yahoo.com/mrss/}"
YT = "{http://www.youtube.com/xml/schemas/2015}"
VIDEO_EXT = re.compile(r"\.(?:mp4|m4v|mov|webm|mkv|m3u8)(?:$|[?#])", re.I)
AUDIO_EXT = re.compile(r"\.(?:mp3|m4a|aac|ogg|opus|wav|flac)(?:$|[?#])", re.I)
HLS_TYPES = ("application/vnd.apple.mpegurl","application/x-mpegurl","application/mpegurl","application/dash+xml")

def get(url, size_limit=5_000_000):
    req=urllib.request.Request(url,headers={"User-Agent":"Podki-Directory-Audit/1.0 (read-only; contact via GitHub MOSHHHHHH/pod)", "Accept":"application/json,application/xml,text/xml,application/rss+xml,*/*"})
    with urllib.request.urlopen(req, timeout=22) as resp:
        status=resp.status
        data=resp.read(size_limit+1)
        content_type=resp.headers.get("Content-Type","")
    if len(data)>size_limit: raise ValueError("response exceeds safety cap")
    return data, status, content_type

def safe_external(url):
    try:
        p=urllib.parse.urlsplit(url)
        if p.scheme!="https" or not p.hostname or p.username or p.password: return False
        host=p.hostname.lower()
        if host=="localhost" or host.endswith((".local",".internal")): return False
        try:
            ip=ipaddress.ip_address(host)
            if not ip.is_global: return False
        except ValueError: pass
        return True
    except Exception: return False

def normalize(s):
    return " ".join(re.sub(r"(?u)[^\w\s]"," ",s.lower()).split())

def search_title(title):
    t=re.sub(r"[|｜].*$","",title).strip()
    t=re.sub(r"\s*[-–—:]\s*(?:הפודקאסט|מבית תוכן|בהגשת).*$","",t).strip()
    return t[:90] if len(t)>1 else title[:90]

def kind(t, url):
    t=(t or "").lower().split(";")[0].strip()
    u=url or ""
    if t.startswith("video/") or t in HLS_TYPES or VIDEO_EXT.search(u): return "video"
    if t.startswith("audio/") or AUDIO_EXT.search(u): return "audio"
    return "unknown"

def inspect_feed(url):
    if not safe_external(url): return {"error":"not a safe public HTTPS URL"}
    try:
        data,_,_=get(url,12_000_000)
        root=ET.fromstring(data)
        ch=root.find("channel")
        if ch is None: return {"error":"not an RSS channel"}
        med=(ch.findtext(POD+"medium") or "").strip()
        video=both=items=0
        for it in ch.findall("item")[:500]:
            items+=1
            m=[]
            for enc in it.findall("enclosure"): m.append(kind(enc.get("type"),enc.get("url")))
            for alt in it.findall(POD+"alternateEnclosure"):
                sources=alt.findall(POD+"source")
                if sources:
                    for src in sources: m.append(kind(alt.get("type") or src.get("contentType"),src.get("uri")))
                else:m.append(kind(alt.get("type"),""))
            for c in it.findall(".//"+MEDIA+"content"): m.append(kind(c.get("type") or c.get("medium"),c.get("url")))
            if "video" in m:
                video+=1
                if "audio" in m: both+=1
        return {"title":ch.findtext("title",""),"medium":med,"inspected_episodes":items,"video_episodes":video,"audio_and_video_episodes":both}
    except Exception as e:return {"error":type(e).__name__+": "+str(e)[:150]}

def candidates_from_response(doc):
    if not isinstance(doc,dict):return []
    result=doc.get("results",doc.get("feeds",[]))
    return result if isinstance(result,list) else []

def main():
    urls=[x.strip() for x in Path("tests/subscribed_rss_urls.txt").read_text(encoding="utf-8").splitlines() if x.strip() and not x.lstrip().startswith("#")]
    rows=[]
    for idx,source in enumerate(urls,1):
        row={"index":idx,"rss_url":source,"status":"error","candidates":[],"search_count":0}
        try:
            source_info=inspect_feed(source)
            row["source"]=source_info
            title=source_info.get("title","")
            if not title: raise ValueError("could not read source channel title")
            q=search_title(title)
            row["query"]=q
            endpoint="https://api.podcastindex.org/search?"+urllib.parse.urlencode({"term":q})
            raw,status,ctype=get(endpoint)
            row["http_status"]=status
            row["response_content_type"]=ctype
            parsed=json.loads(raw)
            results=candidates_from_response(parsed)
            row["search_count"]=len(results)
            picked=[]
            seen=set()
            for c in results:
                if not isinstance(c,dict):continue
                name=str(c.get("collectionName") or c.get("title") or c.get("trackName") or "")
                feed=str(c.get("feedUrl") or c.get("url") or "")
                if not feed or feed in seen:continue
                seen.add(feed)
                score=difflib.SequenceMatcher(None,normalize(title),normalize(name)).ratio()
                # Include same-feed matches as directory sanity check and plausible other feeds
                if score>=0.55 or urllib.parse.urlsplit(feed).path==urllib.parse.urlsplit(source).path:
                    picked.append({"title":name,"rss_url":feed,"similarity":round(score,3),"same_url":feed.rstrip("/")==source.rstrip("/")})
            picked.sort(key=lambda x:x["similarity"],reverse=True)
            # Limit remote fetching; no more than 4 candidates per subscribed channel
            for p in picked[:4]:
                p["rss_audit"]=inspect_feed(p["rss_url"])
            row["candidates"]=picked[:4]
            row["status"]="ok"
            matches=[p for p in row["candidates"] if p["rss_audit"].get("video_episodes",0)]
            print(f"[{idx}/{len(urls)}] {title[:52]} | results {len(results)} | plausible {len(picked)} | inspected {len(row['candidates'])} | video feeds {len(matches)}",flush=True)
        except Exception as e:
            row["error"]=type(e).__name__+": "+str(e)[:200]
            print(f"[{idx}/{len(urls)}] ERROR {row['error']}",flush=True)
        rows.append(row)
        time.sleep(0.3)
    stats={"feeds":len(rows),"search_ok":sum(r["status"]=="ok" for r in rows),"search_failed":sum(r["status"]!="ok" for r in rows),"directory_candidates":sum(len(r["candidates"]) for r in rows),"separate_video_feeds":sum(any(c.get("rss_audit",{}).get("video_episodes",0)>0 and not c["same_url"] for c in r["candidates"]) for r in rows)}
    Path("directory-video-audit.json").write_text(json.dumps({"checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"stats":stats,"feeds":rows},ensure_ascii=False,indent=2),encoding="utf-8")
    lines=["# Keyless Podcast Index search audit","",f"Readable directory searches: {stats['search_ok']}/{len(rows)}. Failed: {stats['search_failed']}. Inspected candidate feeds: {stats['directory_candidates']}. Channels with confirmed additional RSS video candidates: {stats['separate_video_feeds']}.","",
           "**Limits:** Only up to four relevant candidates per query are inspected; false negatives possible. No video downloaded. Search is not exhaustive.","",
           "| Source | Search results | RSS candidates inspected | Candidate with direct video | Status |","|---|---:|---:|---:|---|"]
    for r in rows:
        count=sum(bool(c.get("rss_audit",{}).get("video_episodes")) for c in r["candidates"])
        name=(r.get("source",{}).get("title") or r["rss_url"]).replace("|","/")
        lines.append(f"| {name} | {r['search_count']} | {len(r['candidates'])} | {count} | {r['status']} |")
    for r in rows:
        if any(c.get("rss_audit",{}).get("video_episodes",0)>0 for c in r["candidates"]):
            lines+=["",f"## {r['source']['title']}"]
            for c in r["candidates"]:
                if c.get("rss_audit",{}).get("video_episodes",0)>0:
                    lines.append(f"- {c['title']} — {c['rss_url']} — {c['rss_audit']['video_episodes']} video items")
    Path("directory-video-audit.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    import os
    if "GITHUB_STEP_SUMMARY" in os.environ:
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:f.write("\n".join(lines)+"\n")
    print("STATS "+json.dumps(stats),flush=True)
if __name__=="__main__":main()
