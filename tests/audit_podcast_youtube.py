#!/usr/bin/env python3
"""Compare newest podcast RSS episodes to official YouTube channel feeds. Read-only."""
import datetime as dt, difflib, json, re, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from pathlib import Path
ATOM="{http://www.w3.org/2005/Atom}"
YT="{http://www.youtube.com/xml/schemas/2015}"
CHANNELS=[
 ("על המשמעות","https://rss.buzzsprout.com/278171.rss","https://www.youtube.com/@alhamashmaut"),
 ("Unholy","https://feeds.simplecast.com/oYXzB8F5","https://www.youtube.com/channel/UCGlvtS7As7WHh7YtmU5SMUQ")
]
def fetch(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (Podki RSS matching audit; read only)","Accept":"application/atom+xml,application/rss+xml,text/html,*/*"})
 with urllib.request.urlopen(req,timeout=25) as r: return r.read(50_000_000)
def norm(t):
 t=re.sub(r"(?u)[^\w\s]"," ",(t or "").lower())
 return " ".join(t.split())
def readrss(url):
 root=ET.fromstring(fetch(url));ch=root.find("channel")
 return [{"title":it.findtext("title",""),"date":it.findtext("pubDate","")} for it in ch.findall("item")[:15]]
def ytid(url):
 if "/channel/" in url:return url.split("/channel/")[1].split("/")[0]
 html=fetch(url).decode("utf-8","replace")
 for pattern in (r'"channelId":"(UC[A-Za-z0-9_-]+)"',r'"externalId":"(UC[A-Za-z0-9_-]+)"',r'<meta itemprop="channelId" content="(UC[A-Za-z0-9_-]+)"'):
  m=re.search(pattern,html)
  if m:return m.group(1)
 raise ValueError("Could not discover YouTube channel ID")
def readvideos(url):
 cid=ytid(url); root=ET.fromstring(fetch("https://www.youtube.com/feeds/videos.xml?channel_id="+cid))
 entries=[]
 for e in root.findall(ATOM+"entry"):
  entries.append({"title":e.findtext(ATOM+"title",""),"url":"https://www.youtube.com/watch?v="+e.findtext(YT+"videoId",""),"published":e.findtext(ATOM+"published","")})
 return entries,cid
results=[]
for name,rss,yt in CHANNELS:
 rec={"channel":name,"rss":rss,"youtube":yt,"status":"error","matches":[]}
 try:
  eps=readrss(rss);videos,cid=readvideos(yt)
  rec.update(status="ok",rss_recent=len(eps),youtube_recent=len(videos),youtube_channel_id=cid)
  for ep in eps:
   scored=sorted(((difflib.SequenceMatcher(None,norm(ep["title"]),norm(v["title"])).ratio(),v) for v in videos),key=lambda x:x[0],reverse=True)
   if scored:
    score,v=scored[0]
    rec["matches"].append({"rss_title":ep["title"],"video_title":v["title"],"video_url":v["url"],"confidence_title_score":round(score,3),"candidate_only":True})
  rec["strong_title_candidates"]=sum(m["confidence_title_score"]>=0.75 for m in rec["matches"])
  print(name,"episodes",len(eps),"videos",len(videos),"strong-title-candidates",rec["strong_title_candidates"],flush=True)
 except Exception as ex:
  rec["error"]=type(ex).__name__+": "+str(ex)
  print(name,"ERROR",rec["error"],flush=True)
 results.append(rec)
Path("youtube-match-audit.json").write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
md=["# Podcast RSS vs YouTube (exploratory)","","This compares the latest 15 RSS episodes to the latest 15 public videos from linked channels. A title match is not proof of identical content or download permission.",""]
for r in results:
 md += ["## "+r["channel"],"Status: "+r["status"]]
 if r["status"]=="ok":
  md += [f"Strong title candidates (>=0.75): {r['strong_title_candidates']}/{r['rss_recent']}"]
  for m in r["matches"][:10]:md += [f"- {m['confidence_title_score']:.2f}: {m['rss_title']} | {m['video_url']} ({m['video_title']})"]
 else:md += ["Error: "+r["error"]]
 md += [""]
Path("youtube-match-audit.md").write_text("\n".join(md),encoding="utf-8")
import os
if os.getenv("GITHUB_STEP_SUMMARY"):
 with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:f.write("\n".join(md))
