"""Verify the ISO datetime coercion in db.py.

Run from the repo root with:

    NEXT_PUBLIC_SUPABASE_URL=stub SUPABASE_SERVICE_ROLE_KEY=stub \\
      python -m unittest agent.test_db_coercion -v

No pytest, no live database, no Modal. The shim's value is preventing the
"expected datetime, got str" error every write path was hitting; one test
pinning the behavior is enough.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone

# db.py pulls in config at import-time which requires Supabase env vars.
# Provide harmless stubs so this test doesn't need real credentials.
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "stub")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")

# Allow importing the agent module directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from db import _coerce_param  # noqa: E402


class CoerceParamTests(unittest.TestCase):
    def test_coerces_iso_with_offset(self) -> None:
        out = _coerce_param("2026-05-04T14:00:00-07:00")
        self.assertIsInstance(out, datetime)
        self.assertIsNotNone(out.tzinfo)

    def test_coerces_iso_with_zulu(self) -> None:
        out = _coerce_param("2026-05-04T21:00:00Z")
        self.assertIsInstance(out, datetime)
        self.assertEqual(out.tzinfo, timezone.utc)

    def test_naive_iso_treated_as_utc(self) -> None:
        out = _coerce_param("2026-05-04T14:00:00")
        self.assertIsInstance(out, datetime)
        self.assertEqual(out.tzinfo, timezone.utc)

    def test_does_not_touch_plain_strings(self) -> None:
        for v in ("%alex%", "active", "", "hello world", "2026-05-04"):
            self.assertEqual(_coerce_param(v), v)

    def test_does_not_touch_non_strings(self) -> None:
        self.assertEqual(_coerce_param(42), 42)
        self.assertIsNone(_coerce_param(None))
        self.assertEqual(_coerce_param([1, 2]), [1, 2])

    def test_real_datetime_passes_through(self) -> None:
        dt = datetime(2026, 5, 4, 14, tzinfo=timezone.utc)
        self.assertIs(_coerce_param(dt), dt)


if __name__ == "__main__":
    unittest.main()
