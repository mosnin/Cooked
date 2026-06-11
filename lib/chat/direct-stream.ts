/**
 * Direct-path SSE stream wrapper — Phase 4.
 *
 * Bridges `runDirectChat()` (non-streaming chat completion) to the same
 * Server-Sent Events protocol the Modal proxy speaks in `app/api/ai/task`.
 * That way the browser doesn't have to know which path served the turn —
 * the event shapes (`text_delta`, `turn_complete`, `error`, `route_picked`)
 * are identical.
 *
 * Why not stream the underlying completion? For v1 we run the model in
 * non-streaming mode so we can scan the FULL text for an escalation
 * trigger before deciding whether to commit the direct answer or re-route
 * to the agent path. Streaming-with-escalation requires either a redo
 * (waste tokens) or a clever buffer that holds output back from the wire
 * until a watermark; not the right complexity for the first cut.
 *
 * The endpoint persists the assistant message and writes ChatUsage here
 * — the direct path has no Modal hop to delegate to.
 */

import { logger } from '@/lib/logger';
import { saveAssistantMessage } from '@/lib/ai-tools/persistence';
import { chippiErrorMessage } from '@/lib/ai-tools/chippi-voice';
import { recordChatUsage, type ChatRoute } from '@/lib/usage/record-chat-usage';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import {
  runDirectChat,
  CHIPPI_INSTRUCTIONS_LITE,
  type DirectHistoryRow,
} from './direct-llm';
import { retrieveContext } from './vector-context';
import { shouldEscalate } from './router';
import type { MultimodalAttachment } from './multimodal';

export interface DirectStreamInput {
  spaceId: string;
  userId: string | null;
  conversationId: string;
  model: string;
  userMessage: string;
  history: DirectHistoryRow[];
  attachments: MultimodalAttachment[];
  /** AbortController shared with the rest of the request. */
  abortController: AbortController;
  /**
   * Called when the direct response signals it needs the agent path. The
   * handler builds the AGENT path's SSE Response for the same message (e.g.
   * streamTsChatTurn) and returns it; this stream then pipes the agent
   * response's bytes through verbatim — same SSE protocol, so the browser
   * just sees the turn continue on the agent route. Return `null` (or throw)
   * to skip escalation and commit the direct answer as-is.
   */
  onEscalate?: () => Promise<Response | null>;
}

interface SseEvent {
  type:
    | 'text_delta'
    | 'turn_complete'
    | 'error'
    | 'route_picked'
    | 'fallback_note';
  [k: string]: unknown;
}

/**
 * Build a Response streaming the direct-path turn.
 *
 * Stream sequence (happy path):
 *   1. route_picked  { route: 'direct' }
 *   2. (optional) fallback_note { message: '...' }  — if multimodal builder
 *      dropped attachments for the active provider
 *   3. text_delta    { delta: '...' }               — whole reply in one shot
 *   4. turn_complete { reason: 'complete' }
 *
 * On escalation we emit a second route_picked ({route:'agent',
 * escalated:true}) and pipe the agent path's SSE bytes through this same
 * Response — the browser sees one continuous stream.
 */
export function streamDirectTurn(input: DirectStreamInput): Response {
  const encoder = new TextEncoder();
  let seq = 0;

  function frameEvent(event: SseEvent): string {
    return `data: ${JSON.stringify({ seq: seq++, ts: new Date().toISOString(), ...event })}\n\n`;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(frameEvent(event)));
        } catch {
          /* controller closed */
        }
      };

      // Tell the browser which path served this turn — useful for the
      // existing chat telemetry rail and for any future "this was a
      // fast Q&A turn" indicator.
      push({ type: 'route_picked', route: 'direct' });

      try {
        // Retrieve workspace context FIRST so the system message carries
        // it on the first wire — quality lift independent of which path
        // serves the turn.
        const ctx = await retrieveContext({
          spaceId: input.spaceId,
          userMessage: input.userMessage,
        });

        const systemMessage = [
          CHIPPI_INSTRUCTIONS_LITE,
          ctx.block, // empty string when no context — splice is harmless
        ]
          .filter((s) => s && s.trim().length > 0)
          .join('\n\n');

        const result = await runDirectChat({
          model: input.model,
          systemMessage,
          history: input.history,
          userMessage: input.userMessage,
          attachments: input.attachments,
          signal: input.abortController.signal,
        });

        // Escalation check — if the model said something that smells like
        // "I'd need to actually...", hand off to the agent path with the
        // same user message. We've burnt one cheap completion either way.
        if (input.onEscalate && shouldEscalate(result.text)) {
          // Tag this attempt with the escalation route. The agent path
          // will write its OWN ChatUsage row tagged 'agent' so the
          // breakdown shows both: a 'direct→agent' direct attempt that
          // led to an 'agent' fulfilment.
          await recordChatUsage({
            spaceId: input.spaceId,
            userId: input.userId,
            conversationId: input.conversationId,
            model: input.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            cachedTokens: result.usage.cachedTokens,
            route: 'direct→agent' as ChatRoute,
            runtime: 'ts',
          });
          const agentResponse = await input.onEscalate().catch((err) => {
            logger.warn('[direct-stream] escalation handler threw', { spaceId: input.spaceId }, err);
            return null;
          });
          if (agentResponse?.body) {
            // Tell the browser the turn moved to the agent route, then pipe
            // the agent stream's bytes through verbatim. The agent path
            // persists its own assistant message and ChatUsage row, so
            // nothing below this block should run.
            push({ type: 'route_picked', route: 'agent', escalated: true });
            const reader = agentResponse.body.getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              reader.releaseLock();
            }
            return;
          }
          // Couldn't hand off — fall through and commit the direct answer
          // so the realtor at least sees the model's reasoning.
        }

        if (result.fallbackNote) {
          push({ type: 'fallback_note', message: result.fallbackNote });
        }

        // Emit the entire reply as one text_delta. Streaming token-by-token
        // is a v1 deferred — the wire frames are identical, the UX is just
        // less progressive. Realtor sees the answer the moment we get it.
        if (result.text) {
          push({ type: 'text_delta', delta: result.text });
        }
        push({ type: 'turn_complete', reason: 'complete' });

        // Persist the assistant message + telemetry.
        if (result.text.trim()) {
          const blocks: MessageBlock[] = [{ type: 'text', content: result.text }];
          try {
            await saveAssistantMessage({
              spaceId: input.spaceId,
              conversationId: input.conversationId,
              blocks,
            });
          } catch (err) {
            logger.warn(
              '[direct-stream] save assistant message failed',
              { spaceId: input.spaceId, conversationId: input.conversationId },
              err,
            );
          }
        }
        await recordChatUsage({
          spaceId: input.spaceId,
          userId: input.userId,
          conversationId: input.conversationId,
          model: input.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          cachedTokens: result.usage.cachedTokens,
          route: 'direct',
          runtime: 'ts',
        });
      } catch (err) {
        const aborted = (err as { name?: string })?.name === 'AbortError';
        if (!aborted) {
          logger.error('[direct-stream] crashed', { spaceId: input.spaceId }, err);
          push({ type: 'error', message: chippiErrorMessage('internal') });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      input.abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
