"""Regression checks for pilot consent, fail-open monitoring, and direct forms."""

import asyncio
from io import BytesIO
import json
import sqlite3
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs

from call_monitor import CallMonitor
from forms_export import FormsExporter, discover_entries, FIELD_TITLES, CALL_REQUIRED, VIOLATION_REQUIRED
from live_call import live_config
from phone_gateway import Gateway
from cryptography.fernet import Fernet


class MonitorTest(unittest.IsolatedAsyncioTestCase):
    async def test_quota_failure_does_not_end_call_and_next_check_can_flag(self):
        monitor = CallMonitor("test", {"shouting": .97}, interval=.08, deadline=.04)
        monitor.append_caller_pcm(b"\x00\x01" * 320)
        def result(*args, **kwargs):
            if mock.call_count == 1:
                monitor.append_caller_pcm(b"\x00\x01" * 320)
                raise URLError("simulated quota limit")
            return {"shouting": .99}
        with patch("call_monitor.check_caller", side_effect=result) as mock:
            stop = await asyncio.wait_for(monitor.run(), 1)
        self.assertEqual(monitor.failures, 1)
        self.assertEqual(stop.rules, ("shouting",))
        self.assertEqual(stop.details[0]["probability"], .99)
        self.assertIn("detected_at", stop.details[0])

    async def test_monitor_failure_when_closing_leaves_call_unflagged(self):
        monitor = CallMonitor("test", {}, interval=.08, deadline=.04)
        monitor.append_caller_pcm(b"\x00\x01" * 320)
        monitor.close()
        with patch("call_monitor.check_caller", side_effect=TimeoutError):
            self.assertIsNone(await monitor.run())


class FormsTest(unittest.TestCase):
    def configuration(self):
        return {name: {
            "url": "https://docs.google.com/forms/d/e/test/formResponse",
            "fields": {key: f"entry.{i+1}" for i, key in enumerate(sorted(required))},
        } for name, required in (("calls", CALL_REQUIRED), ("violations", VIOLATION_REQUIRED))}

    def test_discover_entry_ids_from_public_form_data(self):
        rows = [[10+i, title, None, 0, [[100+i, None, 1]]] for i, title in enumerate(FIELD_TITLES.values())]
        html = "<script>var FB_PUBLIC_LOAD_DATA_ = " + json.dumps([None, [None, rows]]) + ";</script>"
        entries = discover_entries(html)
        self.assertEqual(entries["שם פרטי"], "entry.101")
        self.assertEqual(len(entries), len(FIELD_TITLES))

    def test_complete_identity_and_violation_are_posted_directly(self):
        exporter = FormsExporter(self.configuration())
        report = {"id":"test", "full_name":"יעקב ישראלי", "phone":"+972501234567",
                  "started_at":"2026-11-18T00:00:00+02:00", "topics":'["science"]',
                  "reason":"possible_violation", "duration_seconds":20,
                  "violation_details":'[{"rule":"shouting","probability":0.99}]'}
        def accept(request, timeout):
            fields = parse_qs(request.data.decode())
            self.assertIn("יעקב ישראלי", [value[0] for value in fields.values()])
            return BytesIO(b'<div class="freebirdFormviewerViewResponseConfirmationMessage">OK</div>')
        with patch("forms_export.urlopen", side_effect=accept) as post:
            exporter.send("calls", report)
            exporter.send("violations", report)
        self.assertTrue(all(call.args[0].full_url.endswith("/formResponse") for call in post.call_args_list))

    def test_unknown_delivery_is_retained_and_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "calls.db"
            gateway = Gateway(Path(tmp)/"roster", Fernet(Fernet.generate_key()), b"test", {}, {}, db)
            gateway.save_report(("test","user","2026-11-18",2,"live","possible_violation",
                                 "[]","complete",'["shouting"]',"יעקב","ישראלי","+972501234567","[]"))
            exporter = FormsExporter(self.configuration())
            with patch.object(exporter, "send", side_effect=[TimeoutError, None]) as send:
                self.assertEqual(exporter.pending(db), 1)
                self.assertEqual(exporter.pending(db), 0)
                self.assertEqual(send.call_count, 2)
            with sqlite3.connect(db) as database:
                self.assertEqual(dict(database.execute("SELECT target,state FROM direct_form_exports")),
                                 {"calls":"uncertain", "violations":"sent"})

    def test_personalization_uses_only_supplied_first_name(self):
        config = live_config("יעקב")
        self.assertIn("יעקב", config["system_instruction"])
        self.assertIn("פתח תמיד בעברית", config["system_instruction"])
        self.assertEqual(config["tools"][1]["function_declarations"][0]["name"], "read_news")


if __name__ == "__main__":
    unittest.main()
