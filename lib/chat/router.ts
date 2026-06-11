/**
 * Dual-path router — Phase 4.
 *
 * Decides whether a chat turn goes through the fast direct LLM path
 * (`lib/chat/direct-llm.ts`) or the full Modal agent path (`/api/ai/task`'s
 * existing Modal proxy). Direct serves generic Q&A, multimodal summaries,
 * help; agent serves anything that needs to MUTATE state (create contact,
 * send email, schedule tour, etc.) or call a connected integration.
 *
 * Heuristic: regex on imperative action verbs. If the message looks like
 * "add Preston as a contact" or "send the follow-up", we route 'agent'
 * because direct can't run tools. Everything else — questions, summaries,
 * "what's a CMA?" — goes direct.
 *
 * Attachments + no action verb → direct. Multimodal Q&A ("summarize this
 * listing", "what's wrong with this MLS sheet?") is exactly what the direct
 * path is for; routing it through the full agent would add latency for no
 * benefit.
 *
 * Errors default to 'agent' so a router bug can never silently drop a real
 * action. Safer to over-route to the full agent than miss an action.
 */

/**
 * Imperative action verbs that signal the realtor wants Chippi to DO
 * something (mutation, send, schedule) — not just answer. Case insensitive,
 * matched as standalone words. Order doesn't matter; the alternation is
 * treated as a flat set.
 *
 * Curated from real chat traffic, not a thesaurus:
 *   - CRUD: add, create, set, update, change, edit, archive, mark, log, save
 *   - Comms: send, text, email, reply, forward, draft, write, ping, dm
 *   - Reach-out variants: reach, contact, follow, follow-up, nudge, call
 *   - Schedule: schedule, book, set up, set-up, cancel, reschedule, move
 *   - Workflow: assign, route, qualify, advance, close, win, lose
 *   - Other: remind (when imperative: "remind me", "remind her")
 *
 * Not on the list: review, look, find, search, get, show, tell, list, what,
 * how, why, who, when — those are READS. Reads go direct.
 */
const ACTION_VERBS_RE =
  /\b(add|create|set|update|change|edit|archive|mark|log|save|delete|remove|send|text|sms|email|reply|forward|draft|write|ping|dm|reach|contact|follow|followup|nudge|call|schedule|book|cancel|reschedule|move|assign|reassign|unassign|route|qualify|advance|close|win|lose|remind|notify|fire|ship|invite|approve|reject|connect|disconnect|link|integrate|sync)\b/i;

/**
 * Workspace-DATA queries that READ the realtor's book of business. These are
 * not mutations, but they still REQUIRE tools (find_person, find_property,
 * pipeline_summary, find_quiet_hot_persons, …) — the toolless direct path
 * cannot answer "show my pipeline" or "find my hottest leads", it can only
 * deflect. So any message that references the realtor's data (a read verb
 * paired with, or just a mention of, a workspace noun) routes to the agent.
 *
 * This is the fix for the "Chippi has no access to anything" failure: read
 * phrasings like "show today's pipeline", "find hot leads", "who's overdue",
 * "plan my day" must reach the tools, not the generic LLM.
 */
const WORKSPACE_QUERY_RE =
  /\b(show|find|search|look\s?up|lookup|list|see|view|pull|display|surface|who(?:'?s| is| are)?|which|whose|overdue|hottest|hot|warm|cold|stuck|stalled|quiet|pipeline|deals?|leads?|contacts?|people|person|clients?|prospects?|buyers?|sellers?|listings?|propert(?:y|ies)|tours?|showings?|follow[\s-]?ups?|calendar|agenda|schedule|today|tomorrow|this week|inbox|drafts?|offers?|commissions?|stages?|scores?|plan my|my day|my week|my pipeline|my leads|my deals|my contacts|my schedule|my calendar)\b/i;

/**
 * Integration-shaped messages. Reading email / checking a connected app needs
 * the agent's integration tools — there is no native read-email tool, so the
 * toolless direct path can only deflect ("I don't have access to your email"),
 * which realtors with Gmail connected experience as Chippi losing their
 * integrations. Nouns cover the connected-app surface (gmail, outlook, slack,
 * hubspot, calendar/email/messages) and meta-questions about connections
 * ("is my gmail connected?", "what integrations do I have?").
 */
const INTEGRATION_QUERY_RE =
  /\b(e-?mails?|gmail|outlook|mail(?:box)?|inbox|messages?|texts?|slack|hubspot|whatsapp|integrations?|connected|composio)\b/i;

export type RouteDecision = 'direct' | 'agent';

/**
 * Broker-domain reads. The shared WORKSPACE_QUERY_RE was curated from realtor
 * traffic; broker questions ("team health", "at-risk agents", "audit response
 * times", "who's unassigned") matched nothing and fell through to the broker
 * direct path — whose snapshot prompt is INSTRUCTED to say it doesn't have
 * the answer. The "Chippi says it has no tools" complaint on the broker
 * surface was manufactured by that fallthrough. These nouns cover the broker
 * tool catalog's natural-language surface (team/roster/performance/revenue/
 * routing/reviews/briefing).
 */
const BROKER_QUERY_RE =
  /\b(team|roster|members?|realtors?|agents?|brokerage|floor|unassigned|reassignments?|routing|response times?|at[\s-]?risk|flight[\s-]?risk|performance|production|leaderboard|rankings?|revenue|volume|gci|splits?|review queue|reviews?|briefing|brief|health|coverage|sla)\b/i;

export interface RouteAttachment {
  id?: string;
  mimeType?: string;
}

/**
 * Decide which path this turn takes.
 *
 *   - Empty/whitespace-only message → 'direct' (nothing to act on).
 *   - Contains an action verb → 'agent'.
 *   - Has attachments AND no action verb → 'direct' (multimodal Q&A).
 *   - Default → 'direct' (Q&A, summaries, "what does X mean").
 *
 * Errors → 'agent' (safe default).
 */
export function decideRoute(
  userMessage: string,
  attachments: RouteAttachment[] = [],
): RouteDecision {
  try {
    const text = (userMessage ?? '').trim();
    if (!text) {
      // Empty message with attachments only — direct can still summarize.
      return 'direct';
    }
    if (ACTION_VERBS_RE.test(text)) {
      return 'agent';
    }
    // Attachments without an action verb are the direct path's sweet spot
    // (multimodal vision summary) — keep them fast even if the caption
    // mentions a workspace noun like "listing".
    if (attachments.length > 0) {
      return 'direct';
    }
    // Text reads of the realtor's own data still need tools — route them to
    // the agent so "show my pipeline" / "find hot leads" / "who's overdue"
    // reach the read tools instead of the toolless direct path (which can
    // only deflect). The file's own philosophy: better to over-route to the
    // tool-capable agent than answer a data question with a toolless LLM that
    // has no access to the workspace.
    if (WORKSPACE_QUERY_RE.test(text)) {
      return 'agent';
    }
    // Integration reads ("do I have any new emails?", "is my gmail
    // connected?") need the agent's integration tools for the same reason.
    if (INTEGRATION_QUERY_RE.test(text)) {
      return 'agent';
    }
    return 'direct';
  } catch {
    // Bug in the regex / inputs → fall back to the full agent. Direct
    // can't run tools, so over-routing to agent is the conservative choice.
    return 'agent';
  }
}

/**
 * Broker-surface routing: everything decideRoute knows, plus the broker
 * noun set. The broker direct path serves only a 5-field aggregate snapshot
 * — any question about specific realtors, routing, performance, or reviews
 * needs the broker tool catalog on the agent path.
 */
export function decideBrokerRoute(
  userMessage: string,
  attachments: RouteAttachment[] = [],
): RouteDecision {
  try {
    const base = decideRoute(userMessage, attachments);
    if (base === 'agent') return 'agent';
    const text = (userMessage ?? '').trim();
    if (text && attachments.length === 0 && BROKER_QUERY_RE.test(text)) {
      return 'agent';
    }
    return base;
  } catch {
    return 'agent';
  }
}

// ── Escalation detection ────────────────────────────────────────────────────
//
// After the direct path produces a reply, we scan it for tells that the
// model wanted to take action but had no tools. Heuristic — not a classifier
// — and that's the point: shipping a fast escape valve beats designing a
// perfect escalation pipeline. Iterate later.

const ESCALATION_PHRASES = [
  // Direct admissions
  /\bi (?:can'?t|cannot|won'?t be able to) (?:do that|do this|run|send|schedule|create|add|update|book)\b/i,
  /\bi'd need to actually\b/i,
  /\bi would need to actually\b/i,
  /\bi'll need to (?:actually )?(?:create|add|send|run|schedule|book|update|reach|contact|email|text|call|draft)\b/i,
  /\blet me (?:actually )?(?:create|add|send|run|schedule|book|update|reach|contact|email|text|draft) (?:that|this|it|him|her|them)\b/i,
  // Hand-off language
  /\blet me (?:hand|pass) (?:this|that) (?:to|over to) (?:chippi'?s? tools|the agent|chippi)\b/i,
  /\bi(?:'ll| will) hand (?:this|that) (?:to|over to)\b/i,
  // Plain refusals tied to action
  /\bi can'?t (?:actually )?(?:run|send|fire|execute|trigger|invoke)\b/i,
  /\bi don'?t have (?:access to|the ability to|tools to) (?:run|send|create|do)\b/i,
];

/**
 * Should this direct-path reply trigger an automatic escalation to the
 * agent path? Pure function — no I/O. Caller decides what to do with the
 * answer (re-route, toast, log).
 *
 * Returns false on empty/whitespace input. The agent path itself has the
 * tools to actually do the action, so a re-run there will either succeed
 * or surface a meaningful "I can't" reply with the real reason.
 */
export function shouldEscalate(directResponse: string): boolean {
  const text = (directResponse ?? '').trim();
  if (!text) return false;
  for (const re of ESCALATION_PHRASES) {
    if (re.test(text)) return true;
  }
  return false;
}

// Exported for tests + documentation. Keeping the regex visible so a reader
// of router.ts knows EXACTLY what triggers an agent route without having to
// step through the function.
export const ACTION_VERBS_REGEX = ACTION_VERBS_RE;
export const ESCALATION_REGEXES = ESCALATION_PHRASES;
