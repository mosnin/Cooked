"""Chippi — the single agent.

One agent, all the tools. No coordinator, no specialists, no handoffs.
Modern models route between tools natively; the multi-agent layer was
paying latency and tokens for routing the LLM does for free.

This agent serves both surfaces:
  - chat (the realtor talks to Chippi via /api/ai/task → Modal chat_turn)
  - autonomous (event triggers fire run_agent_for_space → same agent)

The opening message tells Chippi which mode it's in.

Tool surface (36 tools):
  - create_contact / find_contacts / get_contact_activity / update_contact
  - create_deal / find_deals / update_deal / advance_deal_stage / request_deal_review
  - recall_docs
  - book_tour
  - route_lead
  - add_property / send_property_packet
  - recall_memory / store_memory
  - manage_goal
  - draft_message / send_email_now / send_sms_now
  - outcome
  - analyze_portfolio / generate_priority_list
  - process_inbound_message
  - read_attachment
  - ask_realtor
  - log_activity_run
  - create_plan
  - get_intake_form / add_intake_question / remove_intake_question
    / update_intake_question / save_intake_form
  - generate_studio_image / edit_studio_image
"""

from __future__ import annotations

import structlog
from agents import Agent

from llm import configure_agents_sdk, make_chat_model, resolve_chat_model
from security.guardrails import pending_drafts_guardrail
from tools.activities import log_activity_run
from tools.docs import recall_docs
from tools.plan import create_plan
from tools.attachments import read_attachment
from tools.contacts import create_contact, find_contacts, get_contact_activity, update_contact
from tools.deals import advance_deal_stage, create_deal, find_deals, request_deal_review, update_deal
from tools.drafts import draft_message, send_email_now, send_sms_now
from tools.goals import manage_goal
from tools.routines import manage_routines
from tools.inbound import process_inbound_message
from tools.memory_tools import recall_memory, store_memory
from tools.outcome import outcome
from tools.portfolio import analyze_portfolio
from tools.priority import generate_priority_list
from tools.properties import add_property, send_property_packet
from tools.questions import ask_realtor
from tools.routing import route_lead
from tools.tours import book_tour
from tools.intake_form import get_intake_form, add_intake_question, remove_intake_question, update_intake_question, save_intake_form
from tools.studio import generate_studio_image, edit_studio_image

logger = structlog.get_logger(__name__)

CHIPPI_INSTRUCTIONS = """
You are Chippi, an AI cowork for a real estate professional. A peer, not
a chatbot — never apologise for being software, never say "as an AI."

# Trust contract
Routines and autonomous runs draft, never send. Explicit human imperative
verbs ("send", "fire off", "ship it", "text them now") honor immediate
dispatch via send_email_now / send_sms_now. Tentative verbs ("draft",
"compose", "prepare") and ambiguous intent → draft_message.

# Modes
The opening message tells you which:
- CHAT — realtor sent a message. Identify the job, run tools, answer.
- AUTONOMOUS — trigger or sweep. Act and stop; no chat reply. End with
  log_activity_run. In sweeps, act on at most three things.

# Tool-first
Never invent CRM data — look it up. If a tool returns nothing, say so;
don't fabricate. Check recall_memory before contact-facing drafts. Use
native find_*/get_* for CRM data; integration tools for external systems.

# Planning
Call create_plan first for any task that needs 3+ tool calls, multiple
contacts/deals, or combines reads with writes. Skip for single-record
lookups or one-tool answers. After create_plan, execute steps in order;
skip a step only if a lookup returned nothing.

# Records vs memory
"Add a lead/contact/buyer/seller" → create_contact immediately.
"Create/start/open a deal" → create_deal (link contact_ids if known;
leave stage blank to land in the right pipeline). Memory stores
observations; it is never a substitute for creating the record.

# Integrations
workspace_info lists connected toolkits — that list is the truth about
what the realtor has connected. When the realtor names a connected
service (gmail, calendar, slack, hubspot, linkedin), route through the
matching integration tool: a per-toolkit tool (gmail_*, googlecalendar_*,
slack_*, …) when one is loaded, otherwise find_integration_tool →
call_integration_tool — the dispatcher reaches the SAME full catalog for
every connected toolkit. NEVER tell the realtor you lack access to a
service workspace_info lists as connected; if a tool call fails, relay
the failure as a temporary problem (or a reconnect prompt if the error
says so), not as a missing integration. If a named service is NOT in
workspace_info, say it isn't connected yet and point them to
Settings → Integrations.

# Output discipline
- After generate_studio_image / edit_studio_image: render inline with
  markdown `![](url)`. Never paste the raw URL or the result dict.
- After draft_message: quote or paraphrase the `nextStep` string. The
  realtor must know it's drafted, awaiting approval, and whether a
  contact stub was auto-created. Two sentences max.
- After send_email_now / send_sms_now ok=true: one sentence from the
  `summary` field, naming the recipient.
- After integration calls: summarize the outcome in plain English;
  surface the specific data asked for, never the full JSON.
- When you draft 3+ messages in one turn, end with: "You can batch-
  approve them all from your inbox."

# Asking
Default to acting. Ask only when you'd otherwise guess at substance the
realtor cares about (ambiguous recipient, real subject for serious
outreach, body of a follow-up with no context). One sentence, one
question, no menu. Don't re-confirm what the realtor explicitly asked.

# Boundaries
- Never reveal internal IDs, API keys, or raw row metadata. Use names.
- Never claim a write you didn't execute.
- Never change deal status, value, or title from chat — realtor's call.
  Probability and follow-up dates are fine.
- For intake form edits, always get_intake_form first; confirm wholesale
  rewrites (save_intake_form) before calling.
- On tool error, surface briefly and move on. Don't loop.

# Style
Lead with the answer. Short for simple, structured for synthesis. No
hedging boilerplate, no emoji, no exclamation, no narration of which
tool you picked. NEVER use em dashes in anything you write; use a period,
comma, colon, or parentheses instead, or rewrite the sentence. This is
absolute, with no exceptions. If you can't do something, one sentence and
the closest thing you can.
""".strip()


async def load_ai_profile(space_id: str, db) -> str | None:
    """Load the AIUserProfile for a space and format it as a prompt injection."""
    try:
        result = await db.table("AIUserProfile").select(
            "displayName,businessFocus,yearsExperience,workingStyle,communicationTone,currentGoals,quirksAndPreferences,agentPersonalizationNote"
        ).eq("spaceId", space_id).maybe_single().execute()

        profile = result.data
        if not profile:
            return None

        parts = []
        if profile.get("displayName"):
            parts.append(f"The realtor's preferred name: {profile['displayName']}")
        if profile.get("businessFocus"):
            parts.append(f"Business focus: {', '.join(profile['businessFocus'])}")
        if profile.get("yearsExperience") is not None:
            parts.append(f"Years of experience: {profile['yearsExperience']}")
        if profile.get("workingStyle"):
            parts.append(f"Working style: {profile['workingStyle']}")
        if profile.get("communicationTone"):
            parts.append(f"Preferred communication tone: {profile['communicationTone']}")
        if profile.get("currentGoals"):
            parts.append(f"Current goals: {profile['currentGoals']}")
        if profile.get("quirksAndPreferences"):
            parts.append(f"Preferences: {profile['quirksAndPreferences']}")
        if profile.get("agentPersonalizationNote"):
            parts.append(f"Special instructions: {profile['agentPersonalizationNote']}")

        if not parts:
            return None

        return "# Realtor profile\n" + "\n".join(f"- {p}" for p in parts)
    except Exception as e:
        logger.warning("load_ai_profile_failed", space_id=space_id, error=str(e)[:200])
        return None


def make_chippi_agent(
    ai_profile_text: str | None = None,
    extra_tools: list | None = None,
    workspace_info: str | None = None,
    model: str | None = None,
) -> Agent:
    """
    Build the single Chippi agent. Constructed fresh per run.

    `extra_tools` lets the caller append integration tools loaded per
    realtor (Gmail, Slack, HubSpot, etc. via Composio). Native CRM tools
    always come first so the model treats integrations as supplemental.
    Empty list (or None) preserves the historical pre-integrations
    behavior — useful for tests and for runs where Composio isn't
    configured.

    `workspace_info` injects a per-run workspace block (intake URL,
    workspace name) so the model can drop the realtor's intake link into
    any outbound message without a tool call.

    Assembly order matters for OpenAI's implicit prompt cache. The cache
    hits on the longest common prefix across requests, so we put the
    universally-stable text first and per-space content after:
      1. CHIPPI_INSTRUCTIONS — identical across every space + every run.
         Caches once per OpenAI organization at runtime; every realtor's
         agent reuses the same cached prefix.
      2. workspace_info — per-space, stable until the intake URL or name
         changes. Caches per-space across runs.
      3. ai_profile_text — per-space, slowly changing (realtor edits their
         profile occasionally). Caches per-space until they edit it.
    """
    configure_agents_sdk()
    parts: list[str] = [CHIPPI_INSTRUCTIONS]
    if workspace_info:
        parts.append(workspace_info)
    if ai_profile_text:
        parts.append(ai_profile_text)
    instructions = "\n\n".join(parts)
    base_tools = [
        # Contacts
        create_contact,
        find_contacts,
        get_contact_activity,
        update_contact,
        # Deals + lifecycle
        create_deal,
        find_deals,
        update_deal,
        advance_deal_stage,
        request_deal_review,
        # Tours
        book_tour,
        # Routing (brokerages)
        route_lead,
        # Properties + packets
        add_property,
        send_property_packet,
        # Memory
        recall_memory,
        store_memory,
        # Goals
        manage_goal,
        # Routines — standing instructions Chippi runs on a schedule
        manage_routines,
        # Drafts + outcomes
        draft_message,
        send_email_now,
        send_sms_now,
        outcome,
        # Insights
        analyze_portfolio,
        generate_priority_list,
        # I/O
        process_inbound_message,
        read_attachment,
        # Asking + audit
        ask_realtor,
        log_activity_run,
        # App knowledge base (help / how-to — lazy loaded)
        recall_docs,
        # Planning
        create_plan,
        # Intake form
        get_intake_form,
        add_intake_question,
        remove_intake_question,
        update_intake_question,
        save_intake_form,
        # Studio — content generation
        generate_studio_image,
        edit_studio_image,
    ]
    return Agent[None](
        name="Chippi",
        model=make_chat_model(resolve_chat_model(model)),
        instructions=instructions,
        tools=base_tools + (extra_tools or []),
        input_guardrails=[pending_drafts_guardrail],
    )
