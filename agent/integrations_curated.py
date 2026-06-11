"""Curated top-N most-used Composio actions per toolkit.

Why this exists (Musk-lens): the dispatcher pattern (find_integration_tool →
call_integration_tool) costs ~3-5s of perceived latency per integration call
because it's two LLM hops + two HTTP round-trips. A realtor with Gmail +
HubSpot + Slack + Calendar uses maybe 6 actions each = 24 tools, well under
xAI's 200-tool ceiling. Pre-loading those skips the dispatcher hops for
common actions while keeping the dispatcher as fallback for the long tail.

Curation rules:
- 4-8 slugs per toolkit, chosen by what a realtor *actually does* daily.
- Every slug verified against docs.composio.dev/toolkits/{toolkit} on
  2026-05-24. A guessed slug that 404s at execute time would burn a turn
  and a token budget; correctness here is non-negotiable.
- Toolkits whose slugs we can't verify (twilio, outlook_calendar 404'd on
  docs at audit time) are OMITTED — they fall back to the dispatcher.
  Better to ship 8 right than 12 with two wrong.
- Read-shaped actions (LIST, FETCH, GET) over write-shaped where both fit
  the realtor's verb. Writes still go through the approval-gated draft
  pipeline; the curated set is mostly about killing latency on reads.

Format: { toolkit_slug: [SLUG, SLUG, ...] } — flat lists, uppercase, no
namespacing on this side (lowercasing + collision-prefixing happens in
integrations.py:_build_curated_tool when these become FunctionTool names).

If a slug here doesn't match what Composio's catalog ships, the agent
build won't crash — the search endpoint just won't return a schema for it,
and we silently fall back to dispatcher-only for that toolkit. So the
worst-case of a stale entry is degraded latency, not broken chat.
"""
from __future__ import annotations

# Order within each list is the realtor's likely frequency-of-use,
# highest first. The dispatch loop in integrations.py preserves the
# order when materializing FunctionTools — useful only as documentation
# of intent; the model doesn't prioritize by list order.
CURATED_ACTIONS: dict[str, list[str]] = {
    # ── Email ────────────────────────────────────────────────────────────
    # Read-then-reply is the bread-and-butter loop. Draft creation is here
    # because realtors often want Chippi to PREP a Gmail draft they'll then
    # tweak — distinct from the native draft_message pipeline (which is
    # CRM-Contact-shaped and awaits approval). Both coexist.
    "gmail": [
        "GMAIL_FETCH_EMAILS",
        "GMAIL_SEND_EMAIL",
        "GMAIL_REPLY_TO_THREAD",
        "GMAIL_LIST_THREADS",
        "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        "GMAIL_CREATE_EMAIL_DRAFT",
    ],
    "outlook": [
        "OUTLOOK_LIST_MESSAGES",
        "OUTLOOK_SEND_EMAIL",
        "OUTLOOK_REPLY_EMAIL",
        "OUTLOOK_GET_MESSAGE",
        "OUTLOOK_CREATE_DRAFT",
    ],
    # ── Calendar ─────────────────────────────────────────────────────────
    # `EVENTS_LIST` is the canonical "list" slug on Composio's catalog
    # (NOT `LIST_EVENTS` — verified 2026-05-24). FIND_FREE_SLOTS is the
    # availability-check the realtor wants when booking a tour outside
    # the native book_tour flow.
    "googlecalendar": [
        "GOOGLECALENDAR_EVENTS_LIST",
        "GOOGLECALENDAR_CREATE_EVENT",
        "GOOGLECALENDAR_UPDATE_EVENT",
        "GOOGLECALENDAR_DELETE_EVENT",
        "GOOGLECALENDAR_FIND_FREE_SLOTS",
        "GOOGLECALENDAR_QUICK_ADD",
    ],
    # ── Messaging (team) ─────────────────────────────────────────────────
    # Slack is internal team comms — broker pings, deal updates, listing
    # alerts. `LIST_ALL_CHANNELS` and `LIST_ALL_USERS` are the canonical
    # slugs (not `LIST_CHANNELS`/`LIST_USERS` — verified). Thread reply
    # uses the FETCH_MESSAGE_THREAD action; Slack's outbound-thread-reply
    # is `SLACK_SEND_MESSAGE` with a `thread_ts` arg, so we surface both.
    "slack": [
        "SLACK_SEND_MESSAGE",
        "SLACK_LIST_ALL_CHANNELS",
        "SLACK_FETCH_CONVERSATION_HISTORY",
        "SLACK_LIST_ALL_USERS",
        "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
    ],
    # ── CRM ──────────────────────────────────────────────────────────────
    # HubSpot is the only CRM most realtors run alongside Chippi. The
    # CREATE_*/UPDATE_* writes here ARE approval-relevant (they touch the
    # realtor's external CRM), but Composio doesn't have a per-action
    # approval flag; trust comes from Chippi's instruction prompt + the
    # draft_message gate for outbound messaging.
    "hubspot": [
        "HUBSPOT_LIST_CONTACTS",
        "HUBSPOT_CREATE_CONTACT",
        "HUBSPOT_UPDATE_CONTACT",
        "HUBSPOT_LIST_DEALS",
        "HUBSPOT_CREATE_DEAL",
        "HUBSPOT_LIST_EMAILS",
    ],
    # ── Social ───────────────────────────────────────────────────────────
    # LinkedIn for realtors is mostly: read my profile, post a listing
    # update, comment on a referral source's post. CREATE_LINKED_IN_POST
    # is the verified slug (the "LINKED_IN" with underscore is Composio's
    # canonicalization — yes, even though it reads weird; don't normalize
    # this without checking the catalog).
    "linkedin": [
        "LINKEDIN_CREATE_LINKED_IN_POST",
        "LINKEDIN_GET_MY_INFO",
        "LINKEDIN_GET_COMPANY_INFO",
        "LINKEDIN_CREATE_COMMENT_ON_POST",
        "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE",
    ],
    # Instagram lead-gen for realtors: DMs from listing-post engagement,
    # comments on open-house teasers. INSTAGRAM_* are Business Account
    # actions — the user must have an IG Business connected, not a
    # personal account. Composio surfaces both paths under the same slug;
    # the personal-account caller just gets an empty result.
    "instagram": [
        "INSTAGRAM_GET_USER_INFO",
        "INSTAGRAM_GET_IG_USER_MEDIA",
        "INSTAGRAM_LIST_ALL_CONVERSATIONS",
        "INSTAGRAM_SEND_TEXT_MESSAGE",
        "INSTAGRAM_GET_IG_MEDIA_COMMENTS",
    ],
    "facebook": [
        "FACEBOOK_GET_CURRENT_USER",
        "FACEBOOK_CREATE_POST",
        "FACEBOOK_GET_PAGE_POSTS",
        "FACEBOOK_GET_PAGE_CONVERSATIONS",
        "FACEBOOK_SEND_MESSAGE",
    ],
    "twitter": [
        "TWITTER_CREATION_OF_A_POST",
        "TWITTER_USER_LOOKUP_ME",
        "TWITTER_USER_HOME_TIMELINE_BY_USER_ID",
        "TWITTER_RECENT_SEARCH",
        "TWITTER_SEND_A_NEW_MESSAGE_TO_A_USER",
    ],
    # ── Productivity ─────────────────────────────────────────────────────
    # Notion is where some realtors keep their per-deal note pages and
    # transaction checklists. Search + read + write the three actions
    # they'll hit; database row insert is for realtors who treat Notion
    # as a lightweight pipeline tracker alongside our CRM.
    "notion": [
        "NOTION_SEARCH_NOTION_PAGE",
        "NOTION_CREATE_NOTION_PAGE",
        "NOTION_UPDATE_PAGE",
        "NOTION_QUERY_DATABASE",
        "NOTION_INSERT_ROW_DATABASE",
    ],
    "googlesheets": [
        "GOOGLESHEETS_VALUES_GET",
        "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        "GOOGLESHEETS_GET_SPREADSHEET_INFO",
        "GOOGLESHEETS_BATCH_GET",
        "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
    ],
}


def curated_slugs_for(toolkit: str) -> list[str]:
    """Return the curated slug list for one toolkit, or [] if unsupported.

    Empty list means "fall back to dispatcher only for this toolkit" — not
    a bug; intentional for toolkits where we couldn't verify slugs against
    docs (twilio, outlook_calendar at the 2026-05-24 audit) or where the
    set isn't yet curated.
    """
    return CURATED_ACTIONS.get(toolkit, [])


def all_curated_toolkits() -> list[str]:
    """The set of toolkits with a curated allowlist. Useful for logging."""
    return list(CURATED_ACTIONS.keys())
