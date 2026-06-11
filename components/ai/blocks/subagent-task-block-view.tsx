'use client';

/**
 * SubagentTaskBlockView — the live inline card for a delegated sub-agent task.
 *
 * When Chippi calls `delegate_task`, it spawns a Modal sub-agent run (a swarm)
 * and drops one of these into the chat thread. The card subscribes to the
 * existing swarm SSE stream (/api/swarm/{runId}/stream) and updates in place as
 * the sub-agents plan → work → finish — so the realtor watches the deep work
 * happen without leaving the conversation.
 *
 * It deliberately stays compact: one task line, one live status line, and the
 * final result when it lands. The full agent-by-agent view lives on the swarm
 * monitor page; here the realtor just needs to feel it working and see the
 * answer when it's ready.
 *
 * On a reloaded conversation, the block persists and the card re-subscribes:
 * if the run is still in flight, it keeps streaming; if it already finished,
 * the first poll delivers the terminal event and the result renders.
 */

import { useEffect, useReducer, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { CAPTION, BODY } from '@/lib/typography';
import { EASE_OUT, DURATION_BASE } from '@/lib/motion';
import type { SubagentTaskBlock } from '@/lib/ai-tools/blocks';
import type { SwarmEventType } from '@/lib/swarm-types';

interface CardState {
  status: 'queued' | 'planning' | 'running' | 'auditing' | 'completed' | 'failed' | 'cancelled';
  /** How many agents the plan spawned, once known. */
  agentCount: number | null;
  /** Agents that have reported completion. */
  completed: number;
  /** Latest live "thinking" line from any agent. */
  activity: string | null;
  result: string | null;
  error: string | null;
  connected: boolean;
}

type Action = { type: SwarmEventType; data: Record<string, unknown> } | { type: 'disconnect' };

function reducer(state: CardState, action: Action): CardState {
  if (action.type === 'disconnect') return { ...state, connected: false };
  const { type, data } = action;
  switch (type) {
    case 'connected': {
      const status = typeof data.status === 'string' ? (data.status as CardState['status']) : state.status;
      return { ...state, connected: true, status };
    }
    case 'swarm_planning':
      return { ...state, status: 'planning' };
    case 'plan_created': {
      const raw = data.taskCount ?? data.task_count;
      return {
        ...state,
        status: 'running',
        agentCount: typeof raw === 'number' ? raw : state.agentCount,
      };
    }
    case 'agent_started':
      return { ...state, status: 'running' };
    case 'agent_thinking':
      return {
        ...state,
        activity: typeof data.message === 'string' ? data.message : state.activity,
      };
    case 'agent_completed':
      return { ...state, completed: state.completed + 1 };
    case 'agent_failed':
      return { ...state, completed: state.completed + 1 };
    case 'audit_started':
      return { ...state, status: 'auditing', activity: 'Synthesizing results…' };
    case 'swarm_completed':
      return {
        ...state,
        status: 'completed',
        result: typeof data.result === 'string' ? data.result : state.result,
        activity: null,
        connected: false,
      };
    case 'swarm_failed':
      return {
        ...state,
        status: 'failed',
        error:
          typeof data.error === 'string'
            ? data.error
            : typeof data.message === 'string'
              ? data.message
              : 'The delegated task ran into a problem.',
        activity: null,
        connected: false,
      };
    case 'swarm_cancelled':
      return { ...state, status: 'cancelled', activity: null, connected: false };
    case 'stream_end':
      return { ...state, connected: false };
    default:
      return state;
  }
}

const SSE_TYPES: SwarmEventType[] = [
  'connected',
  'swarm_planning',
  'plan_created',
  'agent_started',
  'agent_thinking',
  'agent_completed',
  'agent_failed',
  'wave_2_starting',
  'audit_started',
  'swarm_completed',
  'swarm_failed',
  'swarm_cancelled',
  'stream_end',
];

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function statusLine(s: CardState): string {
  switch (s.status) {
    case 'queued':
      return 'Starting…';
    case 'planning':
      return 'Planning the work…';
    case 'running':
      if (s.agentCount != null) {
        return s.activity ?? `Working — ${s.completed}/${s.agentCount} done`;
      }
      return s.activity ?? 'Working…';
    case 'auditing':
      return s.activity ?? 'Pulling it together…';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

export interface SubagentTaskBlockViewProps {
  block: SubagentTaskBlock;
}

export function SubagentTaskBlockView({ block }: SubagentTaskBlockViewProps) {
  const [state, dispatch] = useReducer(reducer, {
    status: 'queued',
    agentCount: null,
    completed: 0,
    activity: null,
    result: null,
    error: null,
    connected: false,
  });

  const esRef = useRef<EventSource | null>(null);
  const isTerminal = TERMINAL.has(state.status);

  useEffect(() => {
    if (TERMINAL.has(state.status)) return;
    const es = new EventSource(`/api/swarm/${block.runId}/stream`);
    esRef.current = es;
    SSE_TYPES.forEach((evType) => {
      es.addEventListener(evType, (e: MessageEvent) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(e.data);
        } catch {
          /* non-JSON — ignore */
        }
        dispatch({ type: evType, data });
      });
    });
    es.onerror = () => dispatch({ type: 'disconnect' });
    return () => {
      es.close();
      esRef.current = null;
    };
    // Subscribe once per run. The reducer flips to terminal and the cleanup
    // closes the socket; we intentionally don't re-open on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.runId]);

  // Close the socket the moment we reach a terminal state.
  useEffect(() => {
    if (TERMINAL.has(state.status) && esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, [state.status]);

  const live = !isTerminal;
  const failed = state.status === 'failed' || state.status === 'cancelled';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } }}
      className={cn(
        'rounded-xl border bg-muted/20 px-4 py-3',
        failed ? 'border-destructive/30' : 'border-border/70',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex-shrink-0 w-1.5 h-1.5 rounded-full',
            failed
              ? 'bg-destructive'
              : state.status === 'completed'
                ? 'bg-emerald-500'
                : 'bg-blue-500',
            live && 'animate-pulse',
          )}
          aria-hidden
        />
        <p className={cn(CAPTION, 'uppercase tracking-wide')}>Delegated task</p>
      </div>

      <p className={cn(BODY, 'mt-1.5 leading-snug')}>{block.goal}</p>

      {!state.result && !failed && (
        <p className={cn(CAPTION, 'mt-1.5')}>{statusLine(state)}</p>
      )}

      {state.result && (
        <p className={cn(BODY, 'mt-2 whitespace-pre-wrap text-foreground/90')}>
          {state.result}
        </p>
      )}

      {failed && (
        <p className={cn(CAPTION, 'mt-1.5 text-destructive')}>
          {state.error ?? 'The delegated task didn’t finish.'}
        </p>
      )}
    </motion.div>
  );
}
