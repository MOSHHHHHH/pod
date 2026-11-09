#!/usr/bin/env python3
"""Read-only RSS video audit; never download media or follow arbitrary linked feeds."""
import datetime as dt
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

POD = "{https://podcastindex.org/namespace/1.0}"
MEDIA = "{http://search.yahoo.com/mrss/}"
ATOM = "{http://www.w3.org/2005/Atom}"
VIDEO_EXT = re.compile(r"\.(?:mp4|m4v|mov|webm|mkv|m3u8)(?:$|[?#])", re.I)
AUDIO_EXT = re.compile(r"\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])", re.I)
VIDEO_TYPES = {"application/vnd.apple.mpegurl", "application/x-mpegurl", "application/mpegurl", "application/dash+xml"}

def classify(mime, url):
    t = (mime or "").split(";", 1)[0].lower().strip()
    if t.startswith("video/") or t in VIDEO_TYPES or VIDEO_EXT.search(url or ""): return "video"
    if t.startswith("audio/") or AUDIO_EXT.search(url or ""): return "audio"
    return "unknown"

def media_for(node):
    entries = []
    def add(src, mime, url):
        entries.append({"source": src, "type": mime or "", "kind": classify(mime, url)})
    for enc in node.findall("enclosure"):
        add("enclosure", enc.get("type"), enc.get("url"))
    for alt in node.findall(POD+"alternateEnclosure"):
        a_type=alt.get("type", "")
        sources=alt.findall(POD+"source")
        for source in sources:
            # contentType on source describes transport; alternate enclosure type describes media
            add("podcast:alternateEnclosure", a_type or source.get("contentType"), source.get("uri"))
        if not sources: add("podcast:alternateEnclosure (no source)",a_type,"")
    for c in node.findall(".//"+MEDIA+"content"):
        add("media:content", c.get("type") or c.get("medium"), c.get("url"))
    for link in node.findall(ATOM+"link"):
        if link.get("rel") == "enclosure": add("atom:enclosure", link.get("type"), link.get("href"))
    return entries

def report():
    urls=[s.strip() for s in Path("tests/subscribed_rss_urls.txt").read_text(encoding="utf-8").splitlines() if s.strip() and not s.lstrip().startswith("#")]
    feeds=[]
    for i,url in enumerate(urls,1):
        r={"index":i,"url":url,"status":"error","episodes":0,"direct_video":0,"audio_and_video":0,"live_video":0,"video_formats":{},"examples":[],"medium":"","related_rss_links":[],"remote_item_count":0,"page_video_hints":0}
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Podki-RSS-Video-Audit/2.0","Accept":"application/rss+xml, application/xml, text/xml, */*"})
            with urllib.request.urlopen(req,timeout=30) as resp: data=resp.read(12*1024*1024+1)
            if len(data)>12*1024*1024: raise ValueError("RSS larger than 12 MiB")
            root=ET.fromstring(data)
            channel=root.find("channel")
            if channel is None: raise ValueError("No RSS channel (Atom root not supported)")
            r["title"]=channel.findtext("title","")
            r["medium"]=channel.findtext(POD+"medium","")
            # related RSS/Atom references are pointers, NOT proof of a corresponding video feed
            for link in channel.findall(ATOM+"link"):
                href=link.get("href","")
                if link.get("rel") in ("alternate","related") and (link.get("type","").lower() in ("application/rss+xml","application/atom+xml")):
                    r["related_rss_links"].append({"rel":link.get("rel"),"url":href})
            items=channel.findall("item")
            r["episodes"]=len(items)
            r["remote_item_count"]=len(channel.findall(POD+"remoteItem"))
            for it in items:
                r["remote_item_count"]+=len(it.findall(POD+"remoteItem"))
                entries=media_for(it)
                video=[x for x in entries if x["kind"]=="video"]
                audio=[x for x in entries if x["kind"]=="audio"]
                if video:
                    r["direct_video"]+=1
                    if audio: r["audio_and_video"]+=1
                    for x in video:
                        key=x["source"]+" | "+(x["type"] or "extension-detected")
                        r["video_formats"][key]=r["video_formats"].get(key,0)+1
                    if len(r["examples"])<3:r["examples"].append({"title":it.findtext("title",""),"video_sources":[x["source"] for x in video],"has_audio":bool(audio)})
                # Hints only: webpage URLs may link to video but are NOT media enclosures
                text=" ".join((it.findtext("description") or "",it.findtext("link") or ""))
                if re.search(r"(?:youtube\.com/watch|youtu\.be/|vimeo\.com/|open\.spotify\.com/episode)",text,re.I):
                    r["page_video_hints"]+=1
            for live in channel.findall(POD+"liveItem"):
                if any(x["kind"]=="video" for x in media_for(live)):r["live_video"]+=1
            r["status"]="ok"
            print(f"[{i}/{len(urls)}] {r['title']}: {r['direct_video']} video / {r['episodes']} episodes, {r['audio_and_video']} both, {r['live_video']} live-video, hints {r['page_video_hints']}",flush=True)
        except Exception as e:
            r["error"]=f"{type(e).__name__}: {e}"
            print(f"[{i}/{len(urls)}] ERROR {r['error']}",flush=True)
        feeds.append(r)
    summary={"date_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"total":len(feeds),"readable":sum(x["status"]=="ok" for x in feeds),"episodes":sum(x["episodes"] for x in feeds),"video_feeds":sum(x["direct_video"]>0 for x in feeds),"video_episodes":sum(x["direct_video"] for x in feeds),"feeds_with_both":sum(x["audio_and_video"]>0 for x in feeds),"video_live_feeds":sum(x["live_video"]>0 for x in feeds),"medium_video_feeds":sum(x["medium"].lower()=="video" for x in feeds),"feeds_with_video_page_hints":sum(x["page_video_hints"]>0 for x in feeds),"feeds_with_related_rss":sum(bool(x["related_rss_links"]) for x in feeds),"feeds":feeds}
    Path("video-audit.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    md=["# Podki RSS video audit v2","","Direct video counts only actual media declarations. Page hints, medium flags and related feeds are **not** proof of downloadable video.","",f"Readable: {summary['readable']}/{summary['total']}; episodes: {summary['episodes']}; feeds with direct video: {summary['video_feeds']}; video episodes: {summary['video_episodes']}; feeds with both: {summary['feeds_with_both']}; live video feeds: {summary['video_live_feeds']}; medium=video feeds: {summary['medium_video_feeds']}; feeds with external page hints: {summary['feeds_with_video_page_hints']}.","","| Channel | Episodes | Video | Both | Live video | Page hints | Medium | Status |","|---|---:|---:|---:|---:|---:|---|---|"]
    for r in feeds:
        title=(r.get("title") or r["url"]).replace("|","/")
        md.append(f"| {title} | {r['episodes']} | {r['direct_video']} | {r['audio_and_video']} | {r['live_video']} | {r['page_video_hints']} | {r['medium']} | {r['status']} |")
    Path("video-audit.md").write_text("\n".join(md)+"\n",encoding="utf-8")
    import os
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:f.write("\n".join(md)+"\n")
    print("SUMMARY "+json.dumps({k:v for k,v in summary.items() if k!="feeds"},ensure_ascii=False),flush=True)

if __name__=="__main__": report()
