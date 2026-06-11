"""Tests for Phase 4 dual-path telemetry — the `route` column.

ledger.record_chat_usage gained an optional `route` arg. The Modal agent
path always passes 'agent'; the TS direct path writes its own rows with
'direct' or 'direct→agent'. These tests pin the contract that:

  - default route is 'agent' (back-compat with pre-Phase-4 callers)
  - explicit 'agent' / 'direct' / 'direct→agent' are written verbatim
  - zero-token turns are still skipped (the route doesn't change the
    skip-on-zero-cost rule)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# The agent package is laid out flat (no src/) so add `agent/` to the path.
AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

# Stub the required-env vars Settings() checks for. Same pattern as
# tests/test_broker_tools.py and tests/test_llm_caching.py — `pytest` runs
# from anywhere without a .env so we set the minimum that lets `import
# ledger` (which transitively imports config.settings) succeed.
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "stub")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")

from ledger import record_chat_usage  # noqa: E402


def _capture_table_insert():
    """Build a Supabase chain mock that records the inserted payload."""
    captured: dict[str, object] = {}

    insert_obj = MagicMock()
    insert_obj.execute = AsyncMock(return_value=MagicMock(data=[]))

    def insert(payload):
        captured["payload"] = payload
        return insert_obj

    table_obj = MagicMock()
    table_obj.insert = MagicMock(side_effect=insert)

    db = MagicMock()
    db.table = MagicMock(return_value=table_obj)

    async def supabase():
        return db

    return supabase, captured


@pytest.mark.asyncio
async def test_route_defaults_to_agent_for_back_compat() -> None:
    supabase, captured = _capture_table_insert()
    with patch("ledger.supabase", supabase):
        await record_chat_usage(
            space_id="sp1",
            model="openai/gpt-5.5",
            prompt_tokens=100,
            completion_tokens=50,
        )
    assert captured["payload"]["route"] == "agent"
    assert captured["payload"]["spaceId"] == "sp1"
    assert captured["payload"]["model"] == "openai/gpt-5.5"
    assert captured["payload"]["promptTokens"] == 100
    assert captured["payload"]["completionTokens"] == 50


@pytest.mark.asyncio
async def test_explicit_agent_route_is_written() -> None:
    supabase, captured = _capture_table_insert()
    with patch("ledger.supabase", supabase):
        await record_chat_usage(
            space_id="sp1",
            model="openai/gpt-5.5",
            prompt_tokens=10,
            completion_tokens=5,
            route="agent",
        )
    assert captured["payload"]["route"] == "agent"


@pytest.mark.asyncio
async def test_direct_route_is_written() -> None:
    supabase, captured = _capture_table_insert()
    with patch("ledger.supabase", supabase):
        await record_chat_usage(
            space_id="sp1",
            model="openai/gpt-5.5",
            prompt_tokens=10,
            completion_tokens=5,
            route="direct",
        )
    assert captured["payload"]["route"] == "direct"


@pytest.mark.asyncio
async def test_direct_to_agent_escalation_route_is_written() -> None:
    supabase, captured = _capture_table_insert()
    with patch("ledger.supabase", supabase):
        await record_chat_usage(
            space_id="sp1",
            model="openai/gpt-5.5",
            prompt_tokens=10,
            completion_tokens=5,
            route="direct→agent",
        )
    assert captured["payload"]["route"] == "direct→agent"


@pytest.mark.asyncio
async def test_zero_token_turn_is_skipped_regardless_of_route() -> None:
    supabase, captured = _capture_table_insert()
    with patch("ledger.supabase", supabase):
        await record_chat_usage(
            space_id="sp1",
            model="openai/gpt-5.5",
            prompt_tokens=0,
            completion_tokens=0,
            route="direct",
        )
    assert "payload" not in captured
