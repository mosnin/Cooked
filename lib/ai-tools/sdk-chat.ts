/**
 * TypeScript in-process chat runtime — the PRIMARY chat backend.
 *
 * Runs the realtor-facing turn in-process on `@openai/agents` against the
 * app-wide LLM client (`getLLMClient()`, OpenRouter-first) via chat
 * completions — no Modal cold start. This is the default; Modal is reached
 * only for deep / swarm work spawned via `delegate_task`, or when
 * `CHIPPI_CHAT_RUNTIME=modal` proxies the whole turn to the sandbox. See
 * `runtime-flag.ts`.
 *
 * Two entry points:
 *
 *   - `runChatTurn` — fresh user message. Builds the agent with all 42
 *     tools converted via `toSdkTool`, calls `run(agent, input, { stream:
 *     true })`, returns the SDK's stream + the result handle so the route
 *     can persist after the stream closes.
 *   - `resumeChatTurn` — load a paused run, apply the realtor's approval
 *     decision, continue the run from where it paused.
 *
 * What we do NOT do here:
 *   - SSE encoding. The route owns the wire format; this module returns
 *     SDK events and the route maps + frames them.
 *   - Persistence of paused runs. The route writes to `AgentPausedRun`
 *     after a paused run lands. Keeping persistence in the route lets the
 *     bridge stay pure and testable.
 */

import { Agent, run, type RunState, type Tool as SdkTool, type AgentInputItem, type Model } from '@openai/agents';
import {
  toSdkTool,
  restoreRunState,
  applyApprovalDecision,
  type ApprovalDecision,
} from './sdk-bridge';
import { getAgentModel } from './agent-model';
import { resolveChatModel } from '@/lib/llm';
import { buildSdkUserContent, type MultimodalAttachment } from '@/lib/chat/multimodal';
import { buildDelegateTaskTool } from './tools/delegate-task';
import { buildPipelineAnalystAgent, buildContactResearcherAgent, buildPlannerAgent } from './sdk-skills';
import { buildSystemPrompt, buildPersonalizedSystemPrompt } from './system-prompt';
import { ALL_TOOLS } from './tools';
import type { ToolContext, ToolDefinition } from './types';
import { activeToolkits, markExpiredByToolkit } from '@/lib/integrations/connections';
import { composioConfigured } from '@/lib/integrations/composio';
import { buildToolkitAgentTools } from '@/lib/integrations/agent-tools';
import { logger } from '@/lib/logger';

// ── Config ─────────────────────────────────────────────────────────────────

/**
 * Cap on generated output tokens per turn.
 *
 * OpenRouter (and OpenAI direct) pre-charge against credit balance based
 * on MAX possible output, not actual usage. With maxTokens unset,
 * providers reserve the model's full ceiling (currently 65,536 for most
 * modern models). A realtor with modest credit can't make a single call
 * because the pre-charge alone exceeds it — exact symptom: HTTP 402
 * "requested up to 65536 tokens, but can only afford X."
 *
 * 4096 is ~4× the typical Chippi turn (~1k tokens) — headroom for
 * long-form drafts (offer letters, post-tour packets) while keeping the
 * pre-charge low enough that everyday usage stays under a cent per turn.
 */
const DEFAULT_MAX_TOKENS = 4_096;

/**
 * Hard ceiling on tool-call iterations per chat turn. The SDK has its
 * own internal default; we set ours explicitly so a model that decides
 * to spelunk the catalog can't run our token bill into the ground.
 *
 * Why 8, not 15: the SDK re-sends the FULL transcript (system prompt +
 * every tool schema + all accumulated tool outputs) on EVERY inner step
 * — token cost grows quadratically with the cap. 8 still covers the real
 * multi-step workflows (look up a person → read activity → find deal →
 * draft a follow-up is 4-5 steps); anything deeper belongs on
 * delegate_task, which runs in its own bounded Modal context instead of
 * re-billing this conversation's transcript.
 */
const MAX_TURNS_PER_TURN = 8;

// ── Agent construction ─────────────────────────────────────────────────────

/**
 * Build the chat agent. Public so the resume path can hand the same shape
 * to `restoreRunState` — the SDK requires the agent that originally
 * produced the state for deserialization.
 *
 * Optional `integrationTools` carry the Composio-loaded SDK tools for
 * whichever third-party apps the realtor has connected. Loaded dynamically
 * by `loadIntegrationTools` below; passed in here so this function stays
 * synchronous and pure for the resume path.
 */
export function buildChatAgent(
  ctx: ToolContext,
  opts: {
    model?: string | Model;
    modelSlug?: string | null;
    integrationTools?: SdkTool[];
    instructions?: string;
  } = {},
): Agent {
  const domainTools = ALL_TOOLS.map((t: ToolDefinition) => toSdkTool(t, ctx));

  // The model every agent in this turn runs on. Either an explicit override
  // (tests / A-B), or the realtor's workspace model resolved to the active
  // provider via getAgentModel(). One instance, shared by the top-level chat
  // agent AND the skill sub-agents below — so they all run on OpenRouter (or
  // the configured fallback), never the SDK's keyless default OpenAI client.
  const agentModel: string | Model = opts.model ?? getAgentModel(opts.modelSlug);

  // delegate_task — the orchestration tool. Lets the agent spawn a deeper
  // Modal sub-agent run (the swarm) for multi-step / in-depth work, and stream
  // its progress back inline. See tools/delegate-task.ts + the system prompt's
  // "when to delegate" guidance.
  const delegateTool = toSdkTool(buildDelegateTaskTool() as ToolDefinition, ctx);

  // Sub-agent skills attached as tools via the SDK's native `Agent.asTool()`.
  // They share the parent's Model instance so they hit the same provider/key.
  const pipelineAnalyst = buildPipelineAnalystAgent(ctx, { model: agentModel });
  const contactResearcher = buildContactResearcherAgent(ctx, { model: agentModel });
  const planner = buildPlannerAgent(ctx, { model: agentModel });

  // Each sub-agent gets an explicit, small per-run turn cap. Without this, the
  // SDK runs every `asTool` sub-agent with its DEFAULT_MAX_TURNS (10), and the
  // parent's own cap does NOT bound the children — so a single request that
  // fans out (e.g. "deep dive on my leads" -> research_person per lead) could
  // chain dozens of uncapped sub-runs, each re-sending its growing transcript,
  // into millions of tokens before failing. A tight cap collapses that blast
  // radius while still leaving room for each skill's legitimate tool sequence
  // (find_person -> find_deal -> recall_history -> answer).
  const SUBAGENT_MAX_TURNS = 5;
  const skillTools = [
    pipelineAnalyst.asTool({
      toolName: 'analyze_pipeline',
      toolDescription:
        'Analyze the pipeline for stuck deals, quiet hot persons, and overdue follow-ups.',
      runOptions: { maxTurns: SUBAGENT_MAX_TURNS },
    }),
    contactResearcher.asTool({
      toolName: 'research_person',
      toolDescription:
        'Research everything we know about a person and recommend the next action.',
      runOptions: { maxTurns: SUBAGENT_MAX_TURNS },
    }),
    planner.asTool({
      toolName: 'planner',
      toolDescription:
        'Break a complex multi-step task into a concrete execution plan before starting work. Call this first when the user asks for something that requires several distinct actions.',
      runOptions: { maxTurns: SUBAGENT_MAX_TURNS },
    }),
  ];

  // Personalized prompt is async — it loads a snapshot of the realtor's
  // pipeline + connected apps. Callers that already awaited it pass it
  // through `opts.instructions`. The fallback path uses the synchronous
  // static prompt so resume / tests / failure modes still work.
  return new Agent({
    name: 'Chippi',
    instructions: opts.instructions ?? buildSystemPrompt(ctx),
    tools: [delegateTool, ...domainTools, ...skillTools, ...(opts.integrationTools ?? [])],
    model: agentModel,
    // Chat completions across every OpenRouter provider. maxTokens caps the
    // pre-charge (see DEFAULT_MAX_TOKENS). No `reasoning` setting: that's a
    // Responses-API concept — on chat completions it's ignored at best and
    // 400s on non-reasoning models (Grok) at worst, which is what wedged the
    // old Responses-API path.
    modelSettings: { maxTokens: DEFAULT_MAX_TOKENS },
  });
}

/**
 * Resolve the Composio tools the realtor's chat should see this turn.
 * Loaded fresh per request — connect/disconnect changes take effect on
 * the next message without any cache invalidation.
 *
 * The actual tool building lives in `lib/integrations/agent-tools.ts`:
 * each connected toolkit's Composio actions become approval-gated SDK
 * tools whose handlers delegate to `executeToolForEntity`. This function
 * owns the orchestration around it — the active-toolkit lookup and the
 * reconcile-on-error loop.
 *
 * Failure mode: if Composio is unconfigured, unreachable, or returns an
 * error, we log and proceed WITHOUT integration tools. The chat keeps
 * working on its native catalog. Hard-fail would mean a Composio outage
 * takes down all chat — wrong tradeoff.
 *
 * Reconcile-on-error: per-toolkit build so a single dead connection (the
 * realtor revoked our OAuth grant on the provider's side and our row is
 * still 'active') doesn't poison the entire batch. When the SDK throws a
 * `ComposioConnectedAccountNotFoundError` or an HTTP 401/403 on a
 * specific toolkit, we flip that row to 'expired' before continuing.
 * Next time the realtor opens /integrations, they see amber + Reconnect
 * — no toast, no surprise, just truth on the page.
 */
export async function loadIntegrationTools(ctx: ToolContext): Promise<SdkTool[]> {
  return (await loadIntegrationToolsDetailed(ctx)).tools;
}

/** What a turn's integration load actually produced — the prompt builder
 *  uses this so the model is told the LIVE truth instead of a cached or
 *  silently-degraded picture. */
export interface IntegrationLoadResult {
  tools: SdkTool[];
  /** Toolkits whose tools are attached THIS turn. */
  liveToolkits: string[];
  /** Toolkits the realtor has connected but whose tools could not be
   *  loaded this turn for a TRANSIENT reason (Composio down, server key
   *  missing). Auth-dead connections are excluded — those flip to
   *  'expired' and stop being "connected". The prompt tells the model to
   *  describe these as temporarily unavailable, NOT as disconnected —
   *  "I don't have your Gmail" to a realtor who connected Gmail is the
   *  single most-reported integration bug. */
  unavailableToolkits: string[];
}

export async function loadIntegrationToolsDetailed(
  ctx: ToolContext,
): Promise<IntegrationLoadResult> {
  let toolkits: string[];
  try {
    toolkits = (await activeToolkits({ spaceId: ctx.space.id, userId: ctx.userId })) ?? [];
  } catch (err) {
    logger.warn('[sdk-chat] activeToolkits lookup failed — proceeding without integration tools', {
      spaceId: ctx.space.id,
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { tools: [], liveToolkits: [], unavailableToolkits: [] };
  }
  if (toolkits.length === 0) return { tools: [], liveToolkits: [], unavailableToolkits: [] };

  // The realtor HAS connections but the server can't reach Composio at
  // all (key unset). Silent-empty here is what made a misconfigured
  // deploy read as "Chippi lost my integrations" — degrade loudly instead.
  if (!composioConfigured()) {
    logger.error(
      '[sdk-chat] COMPOSIO_API_KEY is not configured but this workspace has connected toolkits — integration tools are unavailable for every turn until it is set',
      { spaceId: ctx.space.id, toolkits },
    );
    return { tools: [], liveToolkits: [], unavailableToolkits: toolkits };
  }

  // Per-toolkit build lets us attribute auth failures to the right row.
  // Builds run in PARALLEL — they're independent Composio fetches (cached
  // after the first turn), and running them sequentially put N round-trips
  // on the critical path before the first token.
  const collected: SdkTool[] = [];
  const liveToolkits: string[] = [];
  const unavailableToolkits: string[] = [];
  const settled = await Promise.allSettled(
    toolkits.map((toolkit) => buildToolkitAgentTools({ toolkit, userId: ctx.userId })),
  );
  for (let i = 0; i < toolkits.length; i++) {
    const toolkit = toolkits[i];
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      collected.push(...outcome.value);
      liveToolkits.push(toolkit);
    } else {
      const err = outcome.reason;
      if (isAuthLikeError(err)) {
        // Don't await — keep the chat hot. The DB write is fire-and-
        // forget; worst case is the row stays 'active' for one more
        // turn and we do this dance again. Catch internal failures so
        // a Supabase blip doesn't bubble up here.
        void markExpiredByToolkit({
          spaceId: ctx.space.id,
          userId: ctx.userId,
          toolkit,
          error: err,
        }).catch((dbErr) => {
          logger.warn('[sdk-chat] markExpired failed', {
            toolkit,
            err: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        });
        logger.warn('[sdk-chat] integration auth failed — row flipped to expired', {
          spaceId: ctx.space.id,
          userId: ctx.userId,
          toolkit,
          err: err instanceof Error ? err.message : String(err),
        });
      } else {
        unavailableToolkits.push(toolkit);
        logger.warn('[sdk-chat] integration tools load failed for toolkit — skipping', {
          spaceId: ctx.space.id,
          userId: ctx.userId,
          toolkit,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // In all error cases, drop this toolkit's tools and keep going.
    }
  }
  return { tools: collected, liveToolkits, unavailableToolkits };
}

/**
 * Heuristic: is this error from Composio one we should treat as
 * "connection is dead, flip the row to expired"?
 *
 * We don't import the SDK error class to compare with `instanceof` —
 * the bridge keeps the SDK behind a thin wrapper, and a class compare
 * couples this file to a specific Composio version. Match by name and
 * by HTTP status code instead. Both are stable across SDK versions.
 *
 * Matched conditions:
 *   - `ComposioConnectedAccountNotFoundError` (the canonical "user
 *     revoked or never had this account")
 *   - HTTP 401 / 403 from Composio (auth refused at the provider)
 *   - error code starting with `CONNECTED_ACCOUNT_` (Composio's own
 *     code namespace for connected-account problems)
 *
 * Anything else (network errors, 5xx, validation errors) is treated
 * as transient and the row is left alone.
 */
export function isAuthLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    name?: string;
    statusCode?: number;
    code?: string;
    cause?: { statusCode?: number };
  };
  if (e.name === 'ComposioConnectedAccountNotFoundError') return true;
  if (e.statusCode === 401 || e.statusCode === 403) return true;
  if (e.cause && (e.cause.statusCode === 401 || e.cause.statusCode === 403)) return true;
  if (typeof e.code === 'string' && e.code.startsWith('CONNECTED_ACCOUNT_')) return true;
  return false;
}

// ── Fresh-turn entry point ─────────────────────────────────────────────────

export interface ChatHistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunChatTurnInput {
  ctx: ToolContext;
  /**
   * The user's new message. Becomes the trailing item in the input array
   * we hand the SDK.
   */
  userMessage: string;
  /**
   * Prior turns from the same conversation, oldest first. Caller is
   * responsible for capping (the route uses HISTORY_LIMIT=20) and for
   * de-duping the just-saved user message before passing it in.
   *
   * The agent without history is the agent without memory of what the
   * realtor just said — every turn becomes a fresh start. Passing history
   * here is the difference between "Sam who?" and "right, Sam who you
   * mentioned two messages ago."
   */
  history?: ChatHistoryRow[];
  /**
   * The realtor's workspace chat model slug (e.g. `x-ai/grok-4.3`). Resolved
   * to the active provider via `getAgentModel()`. When omitted, the default
   * chat model is used.
   */
  model?: string;
  /**
   * Attachments for this turn (images / PDFs), already hydrated to signed
   * URLs by the route. Encoded into SDK-native multimodal content so the
   * agent can SEE them — an attachment+action turn ("add this person from
   * the card") no longer has to detour through Modal.
   */
  attachments?: MultimodalAttachment[];
}

/**
 * Start a fresh agent turn. Returns the SDK's streamed result so the
 * caller can iterate `result.toStream()` for events and await
 * `result.completed` to know when persistence is safe.
 */
export async function runChatTurn(input: RunChatTurnInput) {
  // Integration tools load first (live truth: which toolkits actually have
  // tools attached this turn), then the personalized prompt embeds that
  // truth — previously the prompt's "Connected: …" line came from a 5-minute
  // cache, so right after connecting Gmail the model HELD the Gmail tools
  // while its own prompt said Gmail wasn't connected.
  const integrations = await loadIntegrationToolsDetailed(input.ctx);
  const instructions = await buildPersonalizedSystemPrompt(input.ctx, {
    integrations: {
      liveToolkits: integrations.liveToolkits,
      unavailableToolkits: integrations.unavailableToolkits,
    },
  });
  const agent = buildChatAgent(input.ctx, {
    modelSlug: input.model,
    integrationTools: integrations.tools,
    instructions,
  });

  // The trailing user turn. With attachments, encode SDK-native multimodal
  // content (gated by what the resolved model's provider can actually see);
  // otherwise a plain string. The builder splices a calm note onto the text
  // when an attachment can't be shown, so the model never pretends it saw
  // something it didn't.
  let userContent: unknown = input.userMessage;
  if (input.attachments && input.attachments.length > 0) {
    const resolved = resolveChatModel(input.model);
    userContent = buildSdkUserContent(resolved, input.userMessage, input.attachments).content;
  }

  // Build the SDK input as history + new user message. The SDK accepts
  // either a string OR an `AgentInputItem[]`; we use the array form so
  // the agent sees the conversation, not just the trailing turn.
  const items: AgentInputItem[] = [
    ...(input.history ?? []).map((row) => ({
      role: row.role,
      content: row.content,
    })),
    { role: 'user', content: userContent },
  ] as unknown as AgentInputItem[];

  const result = await run(agent, items, {
    stream: true,
    signal: input.ctx.signal,
    maxTurns: MAX_TURNS_PER_TURN,
  });
  return { result, agent };
}

// ── Resume entry point ─────────────────────────────────────────────────────

export interface ResumeChatTurnInput {
  ctx: ToolContext;
  /** Serialized RunState from `AgentPausedRun.runState`. */
  serializedState: string;
  /** The realtor's decision for the pending approval. */
  decision: ApprovalDecision;
  /**
   * The SDK approval-item identifier we apply the decision to. The chat
   * route reads this from `AgentPausedRun.approvals[].callId` (or accepts
   * it on the resume request body for a multi-pending scenario).
   */
  callId: string;
  model?: string | Model;
}

/**
 * Restore a paused run, apply the approval decision, and resume streaming.
 * Mirrors the fresh-turn return shape so the route can pump events the
 * same way regardless of which path produced them.
 */
export async function resumeChatTurn(input: ResumeChatTurnInput) {
  const integrations = await loadIntegrationToolsDetailed(input.ctx);
  const instructions = await buildPersonalizedSystemPrompt(input.ctx, {
    integrations: {
      liveToolkits: integrations.liveToolkits,
      unavailableToolkits: integrations.unavailableToolkits,
    },
  });
  const agent = buildChatAgent(input.ctx, {
    model: input.model,
    integrationTools: integrations.tools,
    instructions,
  });
  const state = await restoreRunState(agent, input.serializedState);

  // Find the matching approval item on the rehydrated state. The SDK
  // exposes pending approvals via `state.getInterruptions()` in newer
  // versions, but to stay compatible we extract from a typed run helper
  // — which the bridge handles via `applyApprovalDecision`.
  const item = findInterruption(state, input.callId);
  if (!item) {
    throw new Error(`No pending approval matching callId=${input.callId}`);
  }
  applyApprovalDecision(state, item, input.decision);

  const result = await run(agent, state, {
    stream: true,
    signal: input.ctx.signal,
    maxTurns: MAX_TURNS_PER_TURN,
  });
  return { result, agent };
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Fish the matching approval item out of a rehydrated RunState. The SDK's
 * RunState exposes a `_currentStep` / interruptions accessor that varies
 * subtly across versions; we try the documented public surface first
 * (`getInterruptions()`), then fall back to scanning known internal arrays.
 *
 * If neither path finds anything, we return undefined and the caller
 * surfaces a clear error — this is the only failure mode a stale
 * approval ID can produce, and we'd rather fail loud than silently
 * resume without applying the decision.
 */
function findInterruption(
  state: RunState<unknown, Agent<unknown, 'text'>>,
  callId: string,
): Parameters<RunState<unknown, Agent<unknown, 'text'>>['approve']>[0] | undefined {
  const anyState = state as unknown as {
    getInterruptions?: () => Array<{ rawItem?: { callId?: string; id?: string } }>;
    _currentStep?: { interruptions?: Array<{ rawItem?: { callId?: string; id?: string } }> };
  };

  let pool: Array<{ rawItem?: { callId?: string; id?: string } }> = [];
  if (typeof anyState.getInterruptions === 'function') {
    pool = anyState.getInterruptions() ?? [];
  } else if (anyState._currentStep?.interruptions) {
    pool = anyState._currentStep.interruptions ?? [];
  }
  const found = pool.find((it) => {
    const id = it.rawItem?.callId ?? it.rawItem?.id;
    return id === callId;
  });
  return found as
    | Parameters<RunState<unknown, Agent<unknown, 'text'>>['approve']>[0]
    | undefined;
}
