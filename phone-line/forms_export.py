"""Discover Google Forms entry IDs and POST complete phone reports directly."""

import argparse
from contextlib import closing
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

FIELD_TITLES = {
    "id": "מזהה שיחה", "first_name": "שם פרטי", "last_name": "שם משפחה",
    "full_name": "שם משתמש", "phone": "מספר טלפון", "started_at": "תאריך ושעת התחלה",
    "duration_seconds": "משך שיחה", "model": "מודל", "reason": "עילת סיום",
    "topics": "נושאי שיחה", "violation_details": "פרטי החריגה",
    "violation_type": "סוג החריגה", "detected_at": "תאריך ושעת החריגה",
}
CALL_REQUIRED = {"full_name", "phone", "started_at", "topics", "reason", "duration_seconds"}
VIOLATION_REQUIRED = {"full_name", "phone", "violation_details", "violation_type", "detected_at"}


class ConfirmationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.confirmed = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        marker = attrs.get("class", "")
        if ("freebirdFormviewerViewResponseConfirmationMessage" in marker
                or attrs.get("role") == "heading" and "vHW8K" in marker):
            self.confirmed = True


def form_url(url, ending):
    address = urlparse(url)
    match = re.fullmatch(r"/forms/(?:u/[0-9]+/)?(d/(?:e/)?[^/]+)/(?:viewform|formResponse)", address.path)
    if address.scheme != "https" or address.netloc != "docs.google.com" or not match:
        raise ValueError("Use the full docs.google.com/forms/.../viewform address")
    return f"https://docs.google.com/forms/{match[1]}/{ending}"


def discover_entries(html):
    match = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*", html)
    if not match:
        raise ValueError("Form fields are unavailable. Check public responder access.")
    data, _ = json.JSONDecoder().raw_decode(html[match.end():])
    entries = {}

    def walk(node):
        if not isinstance(node, list):
            return
        if (len(node) >= 5 and type(node[0]) is int and isinstance(node[1], str)
                and type(node[3]) is int and isinstance(node[4], list) and node[4]
                and isinstance(node[4][0], list) and node[4][0] and type(node[4][0][0]) is int):
            if node[3] not in (0, 1):
                raise ValueError(f"Use text fields for phone reporting: {node[1]}")
            if node[1] in entries:
                raise ValueError("Duplicate form field title")
            entries[node[1]] = f"entry.{node[4][0][0]}"
            return
        for child in node:
            walk(child)

    walk(data)
    if not entries:
        raise ValueError("No text fields found")
    return entries


def configure_form(url, required):
    view = form_url(url, "viewform")
    with urlopen(view, timeout=15) as response:
        entries = discover_entries(response.read(2_000_000).decode("utf-8"))
    fields = {key: entries[title] for key, title in FIELD_TITLES.items() if title in entries}
    missing = required - fields.keys()
    if missing:
        raise ValueError(f"Add these form fields or edit the field mapping: {sorted(missing)}")
    return {"url": form_url(url, "formResponse"), "fields": fields}


class FormsExporter:
    def __init__(self, configuration):
        self.forms = configuration
        for name, required in (("calls", CALL_REQUIRED), ("violations", VIOLATION_REQUIRED)):
            form = configuration[name]
            form_url(form["url"], "formResponse")
            if not required <= form["fields"].keys():
                raise ValueError(f"Missing {name} fields")
            if not all(re.fullmatch(r"entry\.[0-9]+", value) for value in form["fields"].values()):
                raise ValueError("Invalid Google Forms entry IDs")

    @classmethod
    def from_env(cls):
        path = os.environ.get("PHONE_FORMS_CONFIG")
        return cls(json.loads(Path(path).read_text())) if path else None

    def send(self, target, report):
        form = self.forms[target]
        data = urlencode({entry: str(report.get(field, "")) for field, entry in form["fields"].items()})
        request = Request(form["url"], data=data.encode(), headers={
            "Content-Type": "application/x-www-form-urlencoded",
        })
        with urlopen(request, timeout=20) as response:
            parser = ConfirmationParser()
            parser.feed(response.read(1_000_000).decode("utf-8"))
        if not parser.confirmed:
            raise RuntimeError("Form submission was not confirmed")

    def pending(self, path, *, call_id=None):
        """Send each form independently; retain ambiguous deliveries for manual review."""
        with closing(sqlite3.connect(path)) as database, database:
            database.row_factory = sqlite3.Row
            database.execute("""CREATE TABLE IF NOT EXISTS direct_form_exports (
                id TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL,
                PRIMARY KEY (id, target))""")
            rows = database.execute(
                "SELECT * FROM calls WHERE (? IS NULL OR id=?) ORDER BY started_at",
                (call_id, call_id),
            ).fetchall()
        sent = 0
        for row in rows:
            report = dict(row)
            report["full_name"] = " ".join(filter(None, (report["first_name"], report["last_name"])))
            details = json.loads(report.get("violation_details") or "[]")
            report["violation_type"] = ", ".join(json.loads(report["rules"]))
            report["detected_at"] = details[0].get("detected_at", report["started_at"]) if details else report["started_at"]
            targets = ["calls"]
            if json.loads(report["rules"]):
                targets.append("violations")
            for target in targets:
                with closing(sqlite3.connect(path)) as database, database:
                    claimed = database.execute(
                        "INSERT OR IGNORE INTO direct_form_exports VALUES (?, ?, 'sending')",
                        (report["id"], target),
                    ).rowcount
                if not claimed:
                    continue
                try:
                    self.send(target, report)
                except Exception:
                    state = "uncertain"
                else:
                    state = "sent"
                    sent += 1
                with closing(sqlite3.connect(path)) as database, database:
                    database.execute("UPDATE direct_form_exports SET state=? WHERE id=? AND target=?",
                                     (state, report["id"], target))
        return sent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calls-url")
    parser.add_argument("--violations-url")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--database", type=Path)
    args = parser.parse_args()
    if args.database:
        exporter = FormsExporter.from_env()
        if not exporter:
            parser.error("Set PHONE_FORMS_CONFIG")
        print(f"Sent {exporter.pending(args.database)} form submissions")
        return
    if not (args.calls_url and args.violations_url and args.output):
        parser.error("Provide both form URLs and an output configuration path")
    config = {
        "calls": configure_form(args.calls_url, CALL_REQUIRED),
        "violations": configure_form(args.violations_url, VIOLATION_REQUIRED),
    }
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
        json.dump(config, output, ensure_ascii=False, indent=2)
    print("Saved private form entry ID mappings")


if __name__ == "__main__":
    main()
