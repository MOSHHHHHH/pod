"""Fetch bounded RSS news summaries from four operator-selected sources."""

import asyncio
from datetime import datetime, timezone
from html import unescape
import re
from time import monotonic
from urllib.parse import urlparse

from aiohttp import ClientSession, ClientTimeout
from defusedxml import ElementTree

FEEDS = {
    "israel": {"source": "מעריב", "url": "https://www.maariv.co.il/Rss/RssFeedsMivzakiChadashot"},
    "world": {"source": "Fox News", "url": "https://moxie.foxnews.com/google-publisher/world.xml"},
    "sports": {"source": "BBC Sport", "url": "https://feeds.bbci.co.uk/sport/rss.xml"},
    "economy": {"source": "גלובס", "url": "https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2"},
}


def plain_text(value, limit):
    return unescape(re.sub("<[^>]+>", " ", value or "")).strip()[:limit]


def parse_feed(raw):
    root = ElementTree.fromstring(raw)
    items = []
    for entry in root.findall(".//item")[:8]:
        link = entry.findtext("link", "")
        if urlparse(link).scheme not in ("https", "http"):
            link = ""
        items.append({
            "title": plain_text(entry.findtext("title"), 250),
            "summary": plain_text(entry.findtext("description"), 650),
            "published_at": entry.findtext("pubDate", ""),
            "url": link,
        })
    if not items:
        raise ValueError("RSS feed contains no items")
    return items


class NewsFeeds:
    def __init__(self):
        self.cache = {}
        self.locks = {category: asyncio.Lock() for category in FEEDS}

    async def read(self, category):
        if category not in FEEDS:
            return {"error": "Unknown news category"}
        async with self.locks[category]:
            cached = self.cache.get(category)
            if cached and monotonic() - cached[0] < 180:
                return cached[1]
            source = FEEDS[category]
            try:
                async with ClientSession(timeout=ClientTimeout(total=10), trust_env=True) as client:
                    async with client.get(source["url"]) as response:
                        response.raise_for_status()
                        raw = bytearray()
                        async for chunk in response.content.iter_chunked(65536):
                            raw.extend(chunk)
                            if len(raw) > 2_000_000:
                                raise ValueError("RSS response is too large")
                data = {
                    **source, "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "items": parse_feed(raw),
                }
                self.cache[category] = (monotonic(), data)
                return data
            except Exception:
                return {"source": source["source"], "error": "News feed unavailable; try web search"}
