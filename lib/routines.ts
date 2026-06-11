/**
 * Routine dispatch — fires the Modal autonomous run for one routine.
 *
 * The Modal endpoint only returns once the whole run finishes, so a dispatch
 * timeout is the normal case here, not a failure: the request landed and the
 * run is in flight. Like every autonomous path, the run DRAFTS — it never
 * sends a message unattended.
 *
 * Shared by the hourly cron (/api/cron/routines) and the "Run now" button.
 */

const DISPATCH_TIMEOUT_MS = 12_000;

export type RoutineRunStatus = 'ok' | 'error';

export const ROUTINE_CADENCES = [
  'hourly',
  'daily',
  'weekdays',
  'monthly',
  'custom',
] as const;
export type RoutineCadence = (typeof ROUTINE_CADENCES)[number];

/**
 * Lowercase day codes used by the 'custom' cadence — stored as a text[] in the
 * DB and as a string[] over the wire. ISO weekday convention (Mon=1) is too
 * cute when the API also handles a Sunday-based JS dow elsewhere; codes are
 * unambiguous and survive a serializer round-trip.
 */
export const ROUTINE_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type RoutineWeekday = (typeof ROUTINE_WEEKDAYS)[number];

/** Cap day-of-month at 28 — Feb has 28 every year, so the routine never skips a month. */
export const ROUTINE_MAX_DAY_OF_MONTH = 28;

/**
 * Structured provenance for runs the realtor did not initiate by chat.
 * Currently only `composio_trigger` exists; the kind discriminator is
 * here so future inbound paths (calendar webhook, MLS push, etc.) can
 * layer on the same column without a schema change.
 *
 * The orchestrator stashes this on AgentContext; the drafts tool writes
 * it to AgentDraft.triggerSource. The inbox UI then renders a small
 * "Chippi noticed because..." breadcrumb under each draft.
 */
export interface TriggerSource {
  kind: 'composio_trigger';
  slug: string;
  toolkit: string;
  deliveryId: string;
}

export async function fireRoutineRun(
  spaceId: string,
  instruction: string,
  userId?: string,
  triggerSource?: TriggerSource,
): Promise<RoutineRunStatus> {
  // Read env at call time, not module load — see /api/cron/agent-sweep for why.
  const url = process.env.MODAL_WEBHOOK_URL ?? '';
  const secret = process.env.AGENT_INTERNAL_SECRET ?? '';
  if (!url || !secret) {
    console.error('[routines] MODAL_WEBHOOK_URL or AGENT_INTERNAL_SECRET missing');
    return 'error';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    // user_id is the workspace owner's Clerk userId — the entity whose
    // Composio connections (Gmail, Slack, Sheets, Calendar) the autonomous
    // run uses. The Modal orchestrator can resolve it server-side too, but
    // passing it explicitly from the cron is cheaper and removes the silent-
    // failure path where the server-side lookup returns null and the routine
    // runs with no integration tools.
    //
    // trigger_source flows through the Python AgentContext so the draft
    // tool can persist it on AgentDraft.triggerSource. Absent for chat /
    // routine / sweep runs — the orchestrator treats null as "realtor-
    // initiated" and renders nothing in the inbox breadcrumb.
    const body: Record<string, unknown> = { space_id: spaceId, secret, instruction };
    if (userId) body.user_id = userId;
    if (triggerSource) body.trigger_source = triggerSource;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok ? 'ok' : 'error';
  } catch (err) {
    // AbortError: the request was sent and accepted; the Modal endpoint just
    // hasn't returned because the run is still going. That's a success.
    if (err instanceof Error && err.name === 'AbortError') return 'ok';
    console.error('[routines] dispatch failed', err);
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}
