"""Provider detection + Anthropic cache marker injection (Phase 2).

These are the small invariants that the cost-reduction telemetry rests on
— if detect_provider drifts or the cache markers stop landing on the wire,
the ChatUsage.provider rollup goes wrong and Anthropic's discount evaporates
silently. Worth a tiny test net to lock both.

Run from `agent/` with:

    NEXT_PUBLIC_SUPABASE_URL=stub SUPABASE_SERVICE_ROLE_KEY=stub \
      python -m pytest tests/test_llm_caching.py -v
"""

from __future__ import annotations

import os
import sys

import pytest

# Stub env so config.py doesn't blow up before we import llm. The OpenAI
# keys are required by the AsyncOpenAI constructor, which make_chat_model
# instantiates — without them the SDK refuses to build the client.
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "stub")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
os.environ.setdefault("OPENAI_API_KEY", "stub-openai")
os.environ.setdefault("OPENROUTER_API_KEY", "stub-openrouter")

# Test runs from agent/, but pytest sometimes invokes from repo root.
_AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT_DIR not in sys.path:
    sys.path.insert(0, _AGENT_DIR)

from llm import (  # noqa: E402
    _CACHE_MARKER_PROVIDERS,
    _apply_cache_markers,
    decide_reasoning_effort,
    detect_provider,
    make_chat_model,
)

# Back-compat alias — keep the old test entry points referring to the
# renamed helper. Phase 2's tests used _apply_anthropic_cache_markers;
# Phase 3 renamed it once the marker shape was confirmed identical for
# Gemini. The alias prevents regressions for any external import.
_apply_anthropic_cache_markers = _apply_cache_markers


# ── detect_provider ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "slug,expected",
    [
        ("anthropic/claude-opus-4.7", "anthropic"),
        ("openai/gpt-5.5", "openai"),
        ("x-ai/grok-4.3", "xai"),  # dash normalized out
        ("deepseek/deepseek-chat", "deepseek"),
        ("google/gemini-2.5-pro", "google"),
        ("moonshotai/kimi-k2.6", "moonshotai"),
        ("qwen/qwen3.6-flash", "qwen"),
        # OpenAI-direct fallback path (no slash)
        ("gpt-5-mini", "openai"),
        ("gpt-4o", "openai"),
        # Edge cases
        ("", "unknown"),
        (None, "unknown"),
        ("/", "unknown"),
    ],
)
def test_detect_provider(slug, expected):
    assert detect_provider(slug) == expected


# ── _apply_anthropic_cache_markers ─────────────────────────────────────────


def test_cache_markers_rewrite_system_string_to_block_array():
    """The SDK builds the system message as {'role': 'system', 'content': str}.
    Anthropic on OpenRouter accepts cache_control only on block-content form.
    We rewrite the string into a single text block carrying the ephemeral marker.
    """
    kwargs = {
        "messages": [
            {"role": "system", "content": "You are Chippi..."},
            {"role": "user", "content": "hi"},
        ],
        "tools": [],
    }
    _apply_anthropic_cache_markers(kwargs)
    system = kwargs["messages"][0]
    assert system["role"] == "system"
    assert isinstance(system["content"], list)
    assert len(system["content"]) == 1
    block = system["content"][0]
    assert block["type"] == "text"
    assert block["text"] == "You are Chippi..."
    assert block["cache_control"] == {"type": "ephemeral"}
    # User message untouched.
    assert kwargs["messages"][1] == {"role": "user", "content": "hi"}


def test_cache_markers_attach_to_last_tool():
    """Anthropic caches the entire tools array up through any tool carrying
    a marker, so one marker on the tail covers the whole 30+ tool surface.
    """
    kwargs = {
        "messages": [{"role": "system", "content": "x"}],
        "tools": [
            {"type": "function", "function": {"name": "a"}},
            {"type": "function", "function": {"name": "b"}},
            {"type": "function", "function": {"name": "c"}},
        ],
    }
    _apply_anthropic_cache_markers(kwargs)
    assert "cache_control" not in kwargs["tools"][0]
    assert "cache_control" not in kwargs["tools"][1]
    assert kwargs["tools"][2]["cache_control"] == {"type": "ephemeral"}


def test_cache_markers_idempotent_on_retry():
    """SDK retries can rebuild the same kwargs and reach us twice. The
    second pass must not double-wrap the system content or duplicate the
    cache_control on the last tool.
    """
    kwargs = {
        "messages": [{"role": "system", "content": "x"}],
        "tools": [{"type": "function", "function": {"name": "a"}}],
    }
    _apply_anthropic_cache_markers(kwargs)
    snapshot_msg = kwargs["messages"][0]["content"]
    snapshot_tool = kwargs["tools"][0]
    _apply_anthropic_cache_markers(kwargs)
    # Already a list; should NOT be re-wrapped to [[block]].
    assert kwargs["messages"][0]["content"] == snapshot_msg
    # Already has cache_control; not duplicated/replaced.
    assert kwargs["tools"][0] == snapshot_tool


def test_cache_markers_no_tools_no_crash():
    """Empty tools array is normal at agent build time before tools attach
    — we must not throw."""
    kwargs = {
        "messages": [{"role": "system", "content": "x"}],
        "tools": [],
    }
    _apply_anthropic_cache_markers(kwargs)
    assert kwargs["tools"] == []


def test_cache_markers_no_system_no_crash():
    """Message list without a system message (e.g. resume turn replays
    serialized state) must not break — we just skip and still mark tools.
    """
    kwargs = {
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [{"type": "function", "function": {"name": "a"}}],
    }
    _apply_anthropic_cache_markers(kwargs)
    assert kwargs["tools"][0]["cache_control"] == {"type": "ephemeral"}


# ── Phase 3: Gemini joins the cache-marker provider set ────────────────────


def test_cache_marker_providers_include_anthropic_and_google():
    """OpenRouter's docs confirm Gemini explicit caching uses the same
    cache_control shape as Anthropic — Phase 3 extended the marker proxy
    accordingly. xAI / OpenAI / DeepSeek / Moonshot / Qwen are not in the
    set: OpenAI/DeepSeek auto-cache without markers; the rest have no
    OpenRouter caching path today.
    """
    assert "anthropic" in _CACHE_MARKER_PROVIDERS
    assert "google" in _CACHE_MARKER_PROVIDERS
    assert "openai" not in _CACHE_MARKER_PROVIDERS
    assert "deepseek" not in _CACHE_MARKER_PROVIDERS
    assert "xai" not in _CACHE_MARKER_PROVIDERS
    assert "moonshotai" not in _CACHE_MARKER_PROVIDERS
    assert "qwen" not in _CACHE_MARKER_PROVIDERS


def test_make_chat_model_wraps_google_slug_in_caching_proxy():
    """A google/gemini-* slug must route through _CachingChatModel so the
    cache_control markers land on the wire. Locks the wiring against a
    drift that would silently send Gemini turns without the marker.
    """
    from llm import _CachingChatModel

    model = make_chat_model("google/gemini-2.5-pro")
    assert isinstance(model, _CachingChatModel)


def test_make_chat_model_wraps_anthropic_slug_in_caching_proxy():
    """Anthropic stays wrapped after the Phase 3 rename."""
    from llm import _CachingChatModel

    model = make_chat_model("anthropic/claude-opus-4.7")
    assert isinstance(model, _CachingChatModel)


def test_make_chat_model_does_not_wrap_non_cache_providers():
    """xAI / Moonshot / Qwen / bare OpenAI slugs get the plain SDK model.
    The wrapper costs nothing at runtime but the test pins the gating so
    we don't accidentally bypass OpenAI's auto-cache by wrapping it.
    """
    from agents import OpenAIChatCompletionsModel
    from llm import _CachingChatModel

    for slug in ("x-ai/grok-4.3", "moonshotai/kimi-k2.6", "qwen/qwen3.6-flash"):
        m = make_chat_model(slug)
        assert isinstance(m, OpenAIChatCompletionsModel)
        assert not isinstance(m, _CachingChatModel)


# ── decide_reasoning_effort (Phase 3) ──────────────────────────────────────


@pytest.mark.parametrize(
    "message,expected",
    [
        # Trivial / short turns stay low.
        ("hi", "low"),
        ("set a reminder for 3pm", "low"),
        ("draft a follow-up to sarah", "low"),
        ("", "low"),
        (None, "low"),
        # Planning signals escalate.
        ("build a plan for the week", "medium"),
        ("Build me a plan to nurture stale leads", "medium"),
        ("create a plan for Q3 outreach", "medium"),
        ("walk me through what happened last week", "medium"),
        ("compare these two deals side by side", "medium"),
        ("analyze my pipeline", "medium"),
        ("audit my recent activity", "medium"),
        ("research what comparable homes sold for", "medium"),
        ("strategy for converting these leads", "medium"),
        ("should I refinance the listing terms", "medium"),
        # "step-by-step" and "step by step" both lift.
        ("walk me step-by-step through this", "medium"),
        ("explain step by step what to do next", "medium"),
        # Mixed case is normalised.
        ("BUILD A PLAN PLEASE", "medium"),
        # Trailing-space signals avoid false matches on substrings.
        # "audited" should NOT match because the signal is "audit ".
        ("I audited the pipeline yesterday", "low"),
        ("researched comparables already", "low"),
    ],
)
def test_decide_reasoning_effort_heuristic(message, expected):
    # Ensure env override doesn't bleed in from the test runner.
    os.environ.pop("CHIPPI_REASONING_EFFORT", None)
    assert decide_reasoning_effort(message) == expected


def test_decide_reasoning_effort_env_override_low(monkeypatch):
    """A cost emergency can force every turn to "low" via the env var,
    even a turn that would normally escalate. The env var wins."""
    monkeypatch.setenv("CHIPPI_REASONING_EFFORT", "low")
    assert decide_reasoning_effort("build a plan for the week") == "low"


def test_decide_reasoning_effort_env_override_high(monkeypatch):
    """An investor demo can force every turn to "high"."""
    monkeypatch.setenv("CHIPPI_REASONING_EFFORT", "high")
    assert decide_reasoning_effort("hi") == "high"


def test_decide_reasoning_effort_invalid_env_falls_through(monkeypatch):
    """A typo in the env var must not break every turn. Bad values are
    ignored and the heuristic still answers."""
    monkeypatch.setenv("CHIPPI_REASONING_EFFORT", "extreme")
    assert decide_reasoning_effort("hi") == "low"
    assert decide_reasoning_effort("build a plan") == "medium"
