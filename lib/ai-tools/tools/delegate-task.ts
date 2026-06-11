/**
 * `delegate_task` — the orchestration tool. Chippi calls this on its own when
 * a request needs DEPTH: a multi-step investigation, a parallelizable sweep, a
 * "go figure this out and report back" job that would otherwise burn the whole
 * chat turn. It is Chippi's version of Claude Code's Task tool.
 *
 * What it does:
 *   1. Creates a SwarmRun row (status 'queued') for the realtor's space.
 *   2. Fires the Modal swarm runner (MODAL_SWARM_URL) fire-and-forget — the
 *      SAME infra `/api/swarm` uses. The sub-agents run on Modal on gpt-5-mini.
 *   3. Returns the run handle (runId + goal) so the chat UI can render a LIVE
 *      task card that subscribes to /api/swarm/[runId]/stream and updates as
 *      the sub-agents plan → work → complete.
 *
 * Why this is read-only from the approval system's POV: delegating does not
 * itself mutate workspace state. The sub-agent run is a separate, observable
 * job the realtor watches inline. The orchestrator stays in the chat with the
 * realtor and continues to gate any DIRECT mutation it makes through the normal
 * approval flow. (Note: the Modal swarm runner today runs research-style
 * sub-agents without the workspace tool catalog — see swarm_orchestrator.py.
 * Wiring the full Chippi tool set + approvals into the Modal sub-agents is a
 * Python-side change tracked separately; this tool is the orchestration +
 * inline-progress wedge on the TypeScript side.)
 *
 * Scoped to ctx.space.id. The handler ignores any spaceId in args.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { assertSpaceEnabled } from '@/lib/agent/kill-switch';
import { defineTool, type ToolContext } from '../types';

const parameters = z.object({
  goal: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      'The full task for the sub-agent to carry out, written as a self-contained brief. ' +
        'Include everything it needs — the sub-agent does NOT see the chat history. ' +
        'Use for in-depth, multi-step work (deep research, pipeline sweeps, multi-contact ' +
        'analysis). For a simple question you can answer directly, do NOT delegate.',
    ),
});

type DelegateArgs = z.infer<typeof parameters>;

export interface DelegateTaskData {
  /** SwarmRun id — the chat UI opens /api/swarm/{runId}/stream to watch it. */
  runId: string;
  goal: string;
}

/** The tool name, exported so the stream pump + UI can recognize delegate
 *  results without a string literal scattered across files. */
export const DELEGATE_TASK_TOOL_NAME = 'delegate_task';

/**
 * Machine marker appended to the model-facing summary so the stream pump can
 * recover the SwarmRun id (which is minted server-side inside the handler and
 * is otherwise lost — the SDK only forwards the summary STRING to the model).
 * The pump parses + strips this before the realtor ever sees the summary.
 * Format: `⟦chippi:subagent runId=<id>⟧`
 */
const RUN_ID_MARKER = /⟦chippi:subagent runId=([A-Za-z0-9-]+)⟧/;

export function encodeSubagentRunId(runId: string): string {
  return `⟦chippi:subagent runId=${runId}⟧`;
}

/** Extract the SwarmRun id from a delegate_task summary, or null. */
export function parseSubagentRunId(summary: string): string | null {
  const m = RUN_ID_MARKER.exec(summary);
  return m ? m[1] : null;
}

/** Remove the machine marker so the realtor-facing summary stays clean. */
export function stripSubagentMarker(summary: string): string {
  return summary.replace(RUN_ID_MARKER, '').replace(/\s+$/, '');
}

/**
 * Built as a factory so it has no hidden module-level state and so tests can
 * construct it in isolation. Returns a read-only ToolDefinition.
 */
export function buildDelegateTaskTool() {
  return defineTool<typeof parameters, DelegateTaskData>({
    name: 'delegate_task',
    description:
      'Spawn a deeper sub-agent to work on an in-depth, multi-step task and report back. ' +
      'Its progress streams live in this chat. Use ONLY for tasks that need real depth or ' +
      'parallel work — answer simple questions yourself instead. After calling this, tell the ' +
      'realtor you have kicked it off; the live task card shows the rest.',
    parameters,
    riskLevel: 'safe',
    requiresApproval: false,
    handler: async (args: DelegateArgs, ctx: ToolContext): Promise<{
      summary: string;
      data?: DelegateTaskData;
      display?: 'plain' | 'error';
    }> => {
      const goal = args.goal.trim();
      if (!goal) {
        return { summary: 'Error: no task brief provided to delegate.', display: 'error' };
      }

      // Honor the kill-switch — a disabled space can't spawn background work.
      try {
        await assertSpaceEnabled(ctx.space.id);
      } catch {
        return {
          summary: 'Error: this workspace is paused, so I can’t start a delegated task right now.',
          display: 'error',
        };
      }

      const modalSwarmUrl = process.env.MODAL_SWARM_URL;
      if (!modalSwarmUrl) {
        logger.error('[delegate_task] MODAL_SWARM_URL not set — cannot spawn sub-agent', {
          spaceId: ctx.space.id,
        });
        return {
          summary:
            'Error: the deep-task backend isn’t configured, so I’ll handle this directly instead.',
          display: 'error',
        };
      }

      // Create the SwarmRun the UI will watch. Same shape /api/swarm uses.
      const { data: run, error: insertError } = await supabase
        .from('SwarmRun')
        .insert({ spaceId: ctx.space.id, goal, status: 'queued' })
        .select('id')
        .single();

      if (insertError || !run) {
        logger.error('[delegate_task] SwarmRun insert failed', { spaceId: ctx.space.id }, insertError);
        return {
          summary: 'Error: I couldn’t start the delegated task. I’ll try to handle it directly.',
          display: 'error',
        };
      }

      const runId = run.id as string;

      // Fire-and-forget to Modal. Do NOT await — the chat turn must not block
      // on the sub-agent. The UI's stream subscription carries progress.
      void fetch(modalSwarmUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: process.env.AGENT_INTERNAL_SECRET ?? '',
          swarmRunId: runId,
          goal,
          spaceId: ctx.space.id,
          // The orchestrator decomposes the goal itself; no preset custom agents.
          customAgents: [],
        }),
      }).catch((err) => {
        logger.error('[delegate_task] Modal swarm trigger failed', { spaceId: ctx.space.id, runId }, err);
      });

      const shortGoal = goal.length > 120 ? `${goal.slice(0, 117)}…` : goal;
      return {
        // The marker is parsed + stripped by the stream pump before display.
        summary: `Delegated to a sub-agent. Working on it now: ${shortGoal} ${encodeSubagentRunId(runId)}`,
        data: { runId, goal },
        display: 'plain',
      };
    },
  });
}
