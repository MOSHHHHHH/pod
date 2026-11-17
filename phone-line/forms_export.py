"""Send pseudonymous call reports to the line's Google Apps Script deployment."""

import argparse
from contextlib import closing
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
from urllib.parse import urlparse
from urllib.request import Request, urlopen

FIELDS = (
    "id", "user_id", "started_at", "duration_seconds", "model", "reason",
    "topics", "classification_status", "rules",
)



def initialize(database):
    database.execute("CREATE TABLE IF NOT EXISTS form_exports (id TEXT PRIMARY KEY)")


class FormsExporter:
    def __init__(self, url, signing_key):
        address = urlparse(url)
        if (address.scheme != "https" or address.netloc != "script.google.com"
                or not address.path.startswith("/macros/s/") or not address.path.endswith("/exec")
                or address.query or address.fragment):
            raise ValueError("Use the HTTPS /exec URL from the Apps Script deployment")
        if len(signing_key) < 32:
            raise ValueError("Use a dedicated signing key of at least 32 bytes")
        self.url = url
        self.key = signing_key

    @classmethod
    def from_env(cls):
        url = os.environ.get("PHONE_FORMS_URL")
        key = os.environ.get("PHONE_FORMS_KEY")
        if not url and not key:
            return None
        return cls(url or "", (key or "").encode())

    def send(self, report):
        payload = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
        signature = hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()
        request = Request(
            self.url, data=json.dumps({"payload": payload, "signature": signature}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read(16384))
        if result != {"ok": True, "id": report["id"]}:
            raise RuntimeError("Google Forms endpoint did not acknowledge the call ID")

    def pending(self, path, *, call_id=None):
        """Retry local rows that lack an acknowledgment from both forms."""
        with closing(sqlite3.connect(path)) as database, database:
            initialize(database)
            rows = database.execute(
                """SELECT calls.* FROM calls LEFT JOIN form_exports ON calls.id = form_exports.id
                   WHERE form_exports.id IS NULL AND (? IS NULL OR calls.id = ?)
                   ORDER BY calls.started_at""",
                (call_id, call_id),
            ).fetchall()
        for row in rows:
            report = dict(zip(FIELDS, row, strict=True))
            self.send(report)
            with closing(sqlite3.connect(path)) as database, database:
                database.execute("INSERT OR IGNORE INTO form_exports VALUES (?)", (report["id"],))
        return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    exporter = FormsExporter.from_env()
    if not exporter:
        parser.error("Set PHONE_FORMS_URL and PHONE_FORMS_KEY")
    print(f"Exported {exporter.pending(args.database)} pending call reports")


if __name__ == "__main__":
    main()
