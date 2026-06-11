/**
 * Composio trigger subscriptions — the inbound half of the integrations
 * story. Triggers are how the platform tells us "something happened in
 * the realtor's connected app" so Chippi can react without being asked.
 *
 * This module owns four things:
 *
 *   1. CURATED_TRIGGERS — the slugs we auto-register per toolkit. Hard-
 *      coded, not realtor-configurable. The realtor's choice surface is
 *      the connect/disconnect button, not a trigger picker.
 *
 *   2. TRIGGER_DISPATCH — what to do when a delivery arrives. One of:
 *        DRAFT     — fire an autonomous run with a templated instruction
 *                    so the agent drafts a response for the realtor to
 *                    approve. Never auto-sends.
 *        NOTICE    — surface a card to the activity toast (Phase 4 —
 *                    NOT WIRED yet; falls through to a logged no-op).
 *        DATA_SYNC — mirror the event directly into our DB (Phase 4 —
 *                    NOT WIRED yet).
 *
 *   3. registerForConnection / deleteForConnection — lifecycle helpers
 *      called from the OAuth callback (after status becomes active) and
 *      from `connections.revoke` (before the connection is torn down).
 *
 *   4. DB helpers + dispatcher + templater the Inngest handler depends on.
 *
 * Scope discipline (Musk lens): v1 ships with one trigger (`gmail`) and
 * one dispatch kind (`DRAFT`). The other toolkits have empty arrays and
 * the dispatcher falls through to a logged no-op. Expanding coverage is
 * a matter of adding slugs here AFTER verifying them against
 * `composio.triggers.listTypes()` — never guess slugs into this map.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { createTrigger, deleteTrigger } from './composio';
import { fireRoutineRun } from '@/lib/routines';
import type { IntegrationConnectionRow } from './connections';

export type TriggerStatus = 'active' | 'paused' | 'failed';
export type TriggerKind = 'DRAFT' | 'NOTICE' | 'DATA_SYNC';

export interface IntegrationTriggerRow {
  id: string;
  connectionId: string;
  composioTriggerId: string | null;
  triggerSlug: string;
  status: TriggerStatus;
  lastFiredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-toolkit list of trigger slugs to auto-register at connect time.
 *
 * Slugs verified against Composio's published catalog
 * (composio.dev/toolkits/<slug>.md → "Supported Triggers" table). Do
 * NOT guess slugs into this map — registration would fail silently and
 * the realtor would never see Chippi "noticing" what the catalog implies.
 *
 * Empty array = we don't ingest triggers for that toolkit, either
 * because Composio doesn't ship any or because the available ones don't
 * map to actionable realtor moments. See the per-entry comments for the
 * thinking.
 */
export const CURATED_TRIGGERS: Record<string, string[]> = {
  // ── Comms: the realtor's inbox surfaces ───────────────────────────
  gmail: ['GMAIL_NEW_GMAIL_MESSAGE'],
  outlook: ['OUTLOOK_MESSAGE_TRIGGER'],
  // Slack's "RECEIVE_MESSAGE" fires on every channel post — too noisy.
  // DM and reaction are the high-signal ones.
  slack: ['SLACK_DIRECT_MESSAGE_RECEIVED', 'SLACK_REACTION_ADDED'],
  discord: ['DISCORD_NEW_MESSAGE_TRIGGER'],

  // ── Calendar: tours, accepts, cancellations ───────────────────────
  googlecalendar: [
    'GOOGLECALENDAR_ATTENDEE_RESPONSE_CHANGED_TRIGGER',
    'GOOGLECALENDAR_EVENT_CANCELED_DELETED_TRIGGER',
    'GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER',
  ],

  // ── CRM: deal stage + new contact mirrors ─────────────────────────
  hubspot: ['HUBSPOT_CONTACT_CREATED_TRIGGER', 'HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER'],
  salesforce: ['SALESFORCE_NEW_LEAD_TRIGGER', 'SALESFORCE_NEW_OR_UPDATED_OPPORTUNITY_TRIGGER'],
  pipedrive: ['PIPEDRIVE_NEW_DEAL_TRIGGER'],

  // ── Payments: earnest deposits, retainers ─────────────────────────
  stripe: [
    'STRIPE_CHECKOUT_SESSION_COMPLETED_TRIGGER',
    'STRIPE_PAYMENT_FAILED_TRIGGER',
    'STRIPE_INVOICE_PAYMENT_SUCCEEDED_TRIGGER',
  ],

  // ── Tasks + boards ────────────────────────────────────────────────
  // Asana's task triggers don't have the _TRIGGER suffix (verified in
  // their catalog markdown). Don't normalise names — Composio is the
  // source of truth and the slug strings are what we pass to create().
  asana: ['ASANA_TASK_CREATED', 'ASANA_TASK_COMMENT_ADDED'],
  trello: ['TRELLO_NEW_CARD_TRIGGER', 'TRELLO_UPDATED_CARD_TRIGGER'],

  // ── Toolkits we deliberately do NOT register triggers for ─────────
  // Justification per entry — every empty array earns its silence.
  outlook_calendar: [], // outlook ships event triggers under the OUTLOOK_ prefix; no separate outlook_calendar trigger surface
  calendly: [], // Calendly's webhooks are configured Calendly-side, not via Composio triggers
  cal: [], // same shape as Calendly
  twilio: [], // no triggers in catalog yet (inbound SMS via Twilio's own webhook, not Composio)
  whatsapp: [], // only `STATUS_UPDATED` ships — not "new inbound message", which is the one we'd want
  microsoft_teams: [], // no curated triggers shipped — Composio surfaces Teams as outbound-only today
  facebook: [], // page-DM trigger is gated behind Meta business verification; not worth registering blindly
  instagram: [], // same gating story as facebook
  linkedin: [], // no curated triggers; LinkedIn restricts webhook access heavily
  reddit: [], // monitoring/polling pattern not yet exposed as a Composio trigger
  youtube: [
    // Subscription / new-activity triggers exist but a realtor's YouTube
    // is a content channel, not a real-time signal source. Skip until
    // proven realtors want it.
  ],
  google_ads: [], // no trigger surface; the catalog ships read tools only
  notion: [], // page/database triggers exist, but Notion isn't load-bearing in the realtor workflow
  googledocs: [], // doc-content triggers ship but rarely actionable; skip until asked
  googlesheets: [], // metadata-changed triggers are noisy; the realtor wants outcomes, not cell edits
  googledrive: [], // file-created could be useful (new disclosure?) but the signal is too generic
  onedrive: [], // same shape as googledrive
  dropbox: [], // same shape
  zoho: [], // CRM mirror; left empty until a realtor asks
  docusign: [], // envelope-completed is real but Composio's trigger surface is unclear
  dropbox_sign: [], // same shape as docusign
  typeform: [], // form submissions arrive via Typeform's own webhook (configured Typeform-side)
  googleforms: [], // same shape
  zoom: [], // meeting events ship but calendar is the better signal source
  googlemeet: [], // shape of triggers similar to zoom; skip
  loom: [], // video views aren't actionable enough to justify a trigger
  airtable: [], // schema-changed triggers — noisy, not actionable
  mailchimp: ['MAILCHIMP_SUBSCRIBE_TRIGGER', 'MAILCHIMP_UNSUBSCRIBE_TRIGGER'],
};

/**
 * What to do when a given trigger fires. Every curated slug must have
 * an entry — a slug present in CURATED_TRIGGERS but missing here falls
 * through to a logged no-op in the dispatcher (registration succeeded
 * but the delivery does nothing). The test suite asserts coverage so a
 * curation-without-dispatch can't ship silently.
 *
 * In v2, every curated slug is DRAFT-kind: the templated instruction
 * gives the model the context, and the model decides whether to draft
 * a response, ask the realtor a question, or do nothing. The kind enum
 * stays for future cost-tiered routing (NOTICE = activity card with no
 * Modal cost; DATA_SYNC = direct DB write).
 */
const TRIGGER_DISPATCH: Record<string, TriggerKind> = {
  // Comms
  GMAIL_NEW_GMAIL_MESSAGE: 'DRAFT',
  OUTLOOK_MESSAGE_TRIGGER: 'DRAFT',
  SLACK_DIRECT_MESSAGE_RECEIVED: 'DRAFT',
  SLACK_REACTION_ADDED: 'DRAFT',
  DISCORD_NEW_MESSAGE_TRIGGER: 'DRAFT',
  // Calendar
  GOOGLECALENDAR_ATTENDEE_RESPONSE_CHANGED_TRIGGER: 'DRAFT',
  GOOGLECALENDAR_EVENT_CANCELED_DELETED_TRIGGER: 'DRAFT',
  GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER: 'DRAFT',
  // CRM
  HUBSPOT_CONTACT_CREATED_TRIGGER: 'DRAFT',
  HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER: 'DRAFT',
  SALESFORCE_NEW_LEAD_TRIGGER: 'DRAFT',
  SALESFORCE_NEW_OR_UPDATED_OPPORTUNITY_TRIGGER: 'DRAFT',
  PIPEDRIVE_NEW_DEAL_TRIGGER: 'DRAFT',
  // Payments
  STRIPE_CHECKOUT_SESSION_COMPLETED_TRIGGER: 'DRAFT',
  STRIPE_PAYMENT_FAILED_TRIGGER: 'DRAFT',
  STRIPE_INVOICE_PAYMENT_SUCCEEDED_TRIGGER: 'DRAFT',
  // Tasks
  ASANA_TASK_CREATED: 'DRAFT',
  ASANA_TASK_COMMENT_ADDED: 'DRAFT',
  TRELLO_NEW_CARD_TRIGGER: 'DRAFT',
  TRELLO_UPDATED_CARD_TRIGGER: 'DRAFT',
  // Marketing
  MAILCHIMP_SUBSCRIBE_TRIGGER: 'DRAFT',
  MAILCHIMP_UNSUBSCRIBE_TRIGGER: 'DRAFT',
};

/**
 * Pull a string from the payload by trying each key in order, supporting
 * both flat (`'subject'`) and dotted-nested (`'message.subject'`) paths.
 *
 * Why both: Composio's webhook V1/V2 toolkits often emit flat payloads
 * (`{ subject, sender, snippet }`), while V3 + the Gmail/Calendar/HubSpot
 * "Email Sent V2" generation nests fields under one of `payload`,
 * `data`, `message`, or `properties`. We try both flat and nested so
 * the template doesn't silently miss real data.
 *
 * Returns the first non-empty string found, or null.
 */
function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = key.includes('.') ? pickPath(obj, key.split('.')) : obj[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

function pickPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function pickNested(obj: Record<string, unknown>, path: string[]): unknown {
  return pickPath(obj, path);
}

/**
 * Find the "real" payload root inside an envelope. Composio sometimes
 * wraps the event data under one of `data`, `payload`, `message`,
 * `properties` — and the SDK's normalised IncomingTriggerPayload itself
 * carries the toolkit data under `.payload`. We give templates a flat
 * union view by merging the envelope and its first-level wrapper, so
 * `pickString(p, 'subject')` works whether the field arrived flat or
 * inside one of the common envelopes.
 *
 * Same-name fields prefer the nested copy — Composio's V3 normalisation
 * places the canonical field there.
 */
function flattenPayload(p: Record<string, unknown>): Record<string, unknown> {
  const wrappers = ['payload', 'data', 'message'] as const;
  let out: Record<string, unknown> = { ...p };
  for (const w of wrappers) {
    const inner = p[w];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      out = { ...out, ...(inner as Record<string, unknown>) };
    }
  }
  return out;
}

/**
 * Build a uniform instruction block. Every per-slug template has the
 * same shape:
 *
 *   <one-line frame describing what just happened>
 *
 *   <field>: <value>
 *   <field>: <value>
 *   ...
 *
 *   <one-line action rule>
 *
 * Centralising the shape ensures voice consistency across all 24
 * templates (was a Jobs-lens audit finding) and lets us evolve the
 * voice in one place. Fields with null values are dropped.
 *
 * Returns null when EVERY field is empty — the model would get a
 * frame + action rule with no anchoring data, which is worse than a
 * skipped run.
 */
function build(args: {
  frame: string;
  fields: Array<[label: string, value: string | null]>;
  action: string;
}): string | null {
  const present = args.fields.filter(([, v]) => v && v.trim().length > 0);
  if (present.length === 0) return null;
  const lines = [
    args.frame,
    '',
    ...present.map(([label, value]) => `${label}: ${value}`),
    '',
    args.action,
  ];
  return lines.join('\n');
}

/**
 * Per-slug templates. Each fn receives the flattened payload and
 * returns either a uniformly-shaped instruction (via `build()`) or
 * null when the payload is too thin to anchor on — in which case the
 * dispatcher skips the Modal run instead of burning compute on a
 * content-free prompt.
 *
 * Field-name fallbacks: Composio webhook V1/V2/V3 payloads use
 * different keys for the same logical field; the flattenPayload step
 * upstream collapses common envelopes, and pickString() tries each
 * key in order.
 *
 * Voice rule: action sentences describe a JUDGMENT to make, not a
 * rulebook to follow. The model knows the realtor's CRM and history;
 * we trust it to judge noise vs signal rather than enumerate cases.
 */
const TEMPLATES: Record<string, (p: Record<string, unknown>) => string | null> = {
  GMAIL_NEW_GMAIL_MESSAGE: (p) =>
    build({
      frame: 'A new email just arrived in my Gmail.',
      fields: [
        ['Subject', pickString(p, 'subject', 'messageSubject', 'message.subject')],
        ['From', pickString(p, 'sender', 'from', 'fromEmail', 'message.from')],
        ['Snippet', pickString(p, 'snippet', 'preview', 'messageText', 'message.snippet')],
      ],
      action:
        'If this looks like it needs a response, read the thread and draft a reply for me to approve. Use your judgment on noise vs signal — I trust you.',
    }),

  OUTLOOK_MESSAGE_TRIGGER: (p) =>
    build({
      frame: 'A new email just arrived in my Outlook.',
      fields: [
        ['Subject', pickString(p, 'subject', 'messageSubject')],
        ['From', pickString(p, 'from', 'sender', 'fromEmail', 'senderEmail')],
        ['Snippet', pickString(p, 'bodyPreview', 'preview', 'snippet')],
      ],
      action:
        'Same as Gmail — draft a reply if it warrants one, otherwise let it pass.',
    }),

  SLACK_DIRECT_MESSAGE_RECEIVED: (p) => {
    const text = pickString(p, 'text', 'message', 'messageText');
    if (!text) return null;
    return build({
      frame: 'A direct message just arrived on Slack.',
      fields: [
        ['From', pickString(p, 'user', 'userId', 'userName', 'sender')],
        ['Message', text],
      ],
      action: 'Draft a response if it warrants one — automated alerts can pass.',
    });
  },

  SLACK_REACTION_ADDED: (p) => {
    const reaction = pickString(p, 'reaction', 'emoji');
    if (!reaction) return null;
    return build({
      frame: `Someone reacted on Slack with :${reaction}:.`,
      fields: [
        ['From', pickString(p, 'user', 'userName')],
      ],
      action:
        'Usually a quiet ack. Only surface if it reads as confirmation or rejection of something I asked.',
    });
  },

  DISCORD_NEW_MESSAGE_TRIGGER: (p) => {
    const text = pickString(p, 'content', 'text', 'message');
    if (!text) return null;
    return build({
      frame: 'A new Discord message just arrived.',
      fields: [
        ['From', pickString(p, 'author', 'userName', 'username')],
        ['Message', text],
      ],
      action: 'Draft a reply if it warrants one.',
    });
  },

  GOOGLECALENDAR_ATTENDEE_RESPONSE_CHANGED_TRIGGER: (p) =>
    build({
      frame: 'A calendar attendee changed their RSVP.',
      fields: [
        ['Event', pickString(p, 'summary', 'title')],
        ['Attendee', pickString(p, 'attendee', 'email', 'attendeeEmail')],
        ['New status', pickString(p, 'responseStatus', 'response', 'status')],
      ],
      action:
        'If this is a tour or client meeting, draft a warm confirm (if accepted) or a reschedule offer (if declined). Internal events can pass.',
    }),

  GOOGLECALENDAR_EVENT_CANCELED_DELETED_TRIGGER: (p) =>
    build({
      frame: 'A calendar event was canceled.',
      fields: [
        ['Event', pickString(p, 'summary', 'title')],
        ['Was', pickString(p, 'startTime', 'start', 'startDateTime')],
      ],
      action:
        'If this was a tour or client meeting, draft a follow-up acknowledging and offering to reschedule.',
    }),

  GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER: (p) => {
    const attendees = (() => {
      const a = pickNested(p, ['attendees']);
      return Array.isArray(a)
        ? a
            .map((x) =>
              typeof x === 'object' && x ? (x as Record<string, unknown>).email : null,
            )
            .filter(Boolean)
            .join(', ')
        : null;
    })();
    return build({
      frame: 'A calendar event is starting soon.',
      fields: [
        ['Event', pickString(p, 'summary', 'title')],
        ['With', attendees],
      ],
      action:
        "Refresh me on who this is with, what we know about them, and anything pending. Tight — I'm walking in.",
    });
  },

  HUBSPOT_CONTACT_CREATED_TRIGGER: (p) => {
    const props = (pickNested(p, ['properties']) as Record<string, unknown>) ?? p;
    const first = pickString(props, 'firstname', 'firstName', 'name');
    const last = pickString(props, 'lastname', 'lastName');
    const fullName = [first, last].filter(Boolean).join(' ') || null;
    return build({
      frame: 'A new contact was just created in HubSpot.',
      fields: [
        ['Name', fullName],
        ['Email', pickString(props, 'email')],
        ['Phone', pickString(props, 'phone', 'mobilephone')],
      ],
      action:
        'Tell me where this contact likely came from and draft an opener if I should reach out. System/import rows can pass.',
    });
  },

  HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER: (p) => {
    const props = (pickNested(p, ['properties']) as Record<string, unknown>) ?? p;
    return build({
      frame: 'A HubSpot deal moved stages.',
      fields: [
        ['Deal', pickString(props, 'dealname', 'name')],
        ['From', pickString(props, 'previousStage', 'priorStage')],
        ['To', pickString(props, 'dealstage', 'stage')],
      ],
      action:
        'If the move warrants client communication — congratulating an accepted offer, nudging a stalled negotiation — draft it.',
    });
  },

  SALESFORCE_NEW_LEAD_TRIGGER: (p) =>
    build({
      frame: 'A new lead just landed in Salesforce.',
      fields: [
        ['Name', pickString(p, 'name', 'leadName', 'firstName')],
        ['Company', pickString(p, 'company', 'companyName')],
        ['Source', pickString(p, 'leadSource', 'source')],
      ],
      action:
        'Tell me what we know and draft an opener if a first touch is warranted.',
    }),

  SALESFORCE_NEW_OR_UPDATED_OPPORTUNITY_TRIGGER: (p) =>
    build({
      frame: 'A Salesforce opportunity was created or updated.',
      fields: [
        ['Opportunity', pickString(p, 'name', 'opportunityName')],
        ['Stage', pickString(p, 'stageName', 'stage')],
        ['Amount', pickString(p, 'amount')],
      ],
      action:
        'If the change is meaningful — stage advance, amount delta, close-date move — tell me what changed and whether I should reach out.',
    }),

  PIPEDRIVE_NEW_DEAL_TRIGGER: (p) =>
    build({
      frame: 'A new deal was just created in Pipedrive.',
      fields: [
        ['Deal', pickString(p, 'title', 'dealTitle', 'name')],
        ['Contact', pickString(p, 'personName', 'contactName', 'person')],
        ['Value', pickString(p, 'value', 'amount')],
      ],
      action:
        'Draft an opener if the contact is fresh and a first touch is warranted.',
    }),

  STRIPE_CHECKOUT_SESSION_COMPLETED_TRIGGER: (p) =>
    build({
      frame: 'A Stripe payment just came through.',
      fields: [
        ['Amount', pickString(p, 'amount_total', 'amount', 'totalAmount')],
        ['From', pickString(p, 'customer_email', 'email', 'customerEmail')],
        ['For', pickString(p, 'description', 'metadata.description')],
      ],
      action:
        'Draft a short thank-you / confirmation matching the tone we already had with this person, and note in CRM whether this is an earnest deposit, retainer, or service fee.',
    }),

  STRIPE_PAYMENT_FAILED_TRIGGER: (p) =>
    build({
      frame: 'A Stripe payment just failed.',
      fields: [
        ['Customer', pickString(p, 'customer_email', 'email', 'customerEmail')],
        ['Reason', pickString(p, 'failure_message', 'reason', 'failureReason')],
      ],
      action:
        "Draft a low-friction follow-up — we'll retry, they can update their method. Don't sound alarming; most failures are bank-side.",
    }),

  STRIPE_INVOICE_PAYMENT_SUCCEEDED_TRIGGER: (p) =>
    build({
      frame: 'A Stripe invoice was paid.',
      fields: [
        ['Amount', pickString(p, 'amount_paid', 'amount', 'totalAmount')],
        ['Customer', pickString(p, 'customer_email', 'email', 'customerEmail')],
      ],
      action:
        'Recurring retainer → just stamp the CRM. One-off → send a brief confirmation.',
    }),

  ASANA_TASK_CREATED: (p) =>
    build({
      frame: 'A new task just landed in Asana.',
      fields: [
        ['Task', pickString(p, 'name', 'taskName')],
        ['Assigned to', pickString(p, 'assignee', 'assigneeName')],
      ],
      action:
        'If this is work I owe a client (callback, follow-up, doc send), surface it as a today-item.',
    }),

  ASANA_TASK_COMMENT_ADDED: (p) => {
    const comment = pickString(p, 'text', 'comment', 'commentText');
    if (!comment) return null;
    return build({
      frame: 'A new comment appeared on an Asana task.',
      fields: [
        ['Task', pickString(p, 'taskName', 'name')],
        ['From', pickString(p, 'author', 'commenter')],
        ['Comment', comment],
      ],
      action: "If it's a question or blocker, tell me what's needed.",
    });
  },

  TRELLO_NEW_CARD_TRIGGER: (p) =>
    build({
      frame: 'A new Trello card was created.',
      fields: [
        ['Card', pickString(p, 'name', 'cardName')],
        ['List', pickString(p, 'listName', 'list')],
      ],
      action: 'If this is work I owe a client, surface it.',
    }),

  TRELLO_UPDATED_CARD_TRIGGER: (p) =>
    build({
      frame: 'A Trello card was updated.',
      fields: [
        ['Card', pickString(p, 'name', 'cardName')],
        ['Change', pickString(p, 'change', 'updateType')],
      ],
      action:
        'If this is a status a client cares about — e.g., closing checklist item — tell me.',
    }),

  MAILCHIMP_SUBSCRIBE_TRIGGER: (p) =>
    build({
      frame: 'Someone just subscribed to a Mailchimp list.',
      fields: [
        ['Email', pickString(p, 'email', 'emailAddress')],
        ['List', pickString(p, 'listName', 'list')],
      ],
      action:
        "If we know them from CRM, surface what we know. If new, draft a low-key welcome and add them as a lead.",
    }),

  MAILCHIMP_UNSUBSCRIBE_TRIGGER: (p) =>
    build({
      frame: 'Someone unsubscribed from a Mailchimp list.',
      fields: [
        ['Email', pickString(p, 'email', 'emailAddress')],
      ],
      action:
        'Known CRM contact → flag the signal quietly, no outreach. They may want less from us.',
    }),
};

/**
 * Per-slug instruction templater. Given the trigger's payload, returns
 * the natural-language instruction the autonomous Modal run will see —
 * or null when the payload is too thin to act on (the dispatcher then
 * skips the run rather than burn Modal time on a content-free prompt).
 *
 * A slug missing from TEMPLATES returns null — dispatch then logs a gap
 * and no-ops. Adding a slug to CURATED_TRIGGERS without a template is
 * caught by the test suite.
 */
function templateInstruction(
  triggerSlug: string,
  payload: Record<string, unknown> | undefined,
): string | null {
  const fn = TEMPLATES[triggerSlug];
  if (!fn) return null;
  // Flatten envelope wrappers so templates can use flat keys regardless
  // of whether Composio V1/V2 sent flat fields or V3 wrapped them under
  // `payload`/`data`/`message`. Without this, the Gmail launch slug
  // silently no-ops on real V3 deliveries — V3 puts `snippet` and
  // `subject` inside `payload.*` while our flat-key picks miss them.
  return fn(flattenPayload(payload ?? {}));
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Register every curated trigger for a freshly-active connection.
 *
 * Called from the OAuth callback AFTER `upsertByComposioId` confirms the
 * row is active. Each (connection, slug) pair becomes one IntegrationTrigger
 * row. A registration failure for one slug is logged + recorded with
 * status='failed' and does NOT block the rest — a realtor with three
 * triggers should get the two that work even if one slug is wrong.
 *
 * Best-effort overall: a Composio outage here doesn't reject the OAuth
 * completion. The realtor sees the connection succeed; missing triggers
 * surface later via the health endpoint and can be re-registered on
 * reconnect.
 */
export async function registerForConnection(args: {
  connection: IntegrationConnectionRow;
}): Promise<{ registered: number; failed: number }> {
  const slugs = CURATED_TRIGGERS[args.connection.toolkit] ?? [];
  if (slugs.length === 0) {
    return { registered: 0, failed: 0 };
  }

  let registered = 0;
  let failed = 0;

  for (const slug of slugs) {
    try {
      const { triggerId } = await createTrigger({
        entityId: args.connection.userId,
        slug,
        connectedAccountId: args.connection.composioConnectionId,
      });
      const ok = await upsertTriggerRow({
        connectionId: args.connection.id,
        triggerSlug: slug,
        composioTriggerId: triggerId,
        status: 'active',
      });
      if (ok) registered++;
      else failed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[integrations.triggers] registration failed', {
        toolkit: args.connection.toolkit,
        slug,
        connectionId: args.connection.id,
        err: message,
      });
      // Record the failure so a later reconcile can see we tried.
      await upsertTriggerRow({
        connectionId: args.connection.id,
        triggerSlug: slug,
        composioTriggerId: null,
        status: 'failed',
        lastError: message,
      });
      failed++;
    }
  }

  if (registered > 0 || failed > 0) {
    logger.info('[integrations.triggers] registered for connection', {
      toolkit: args.connection.toolkit,
      connectionId: args.connection.id,
      registered,
      failed,
    });
  }
  return { registered, failed };
}

/**
 * Delete every trigger subscription for a connection — at Composio AND
 * locally. Called from `connections.revoke` BEFORE the connection itself
 * is torn down, so a disconnected realtor doesn't keep paying for
 * webhook deliveries that go nowhere.
 *
 * If the connection row is hard-deleted (ON DELETE CASCADE removes our
 * IntegrationTrigger rows), the Composio side still needs explicit
 * cleanup — this function is the one path that guarantees both.
 */
export async function deleteForConnection(connectionId: string): Promise<void> {
  const rows = await listTriggersForConnection(connectionId);
  for (const row of rows) {
    if (row.composioTriggerId) {
      await deleteTrigger(row.composioTriggerId);
    }
  }
  // DB-side cleanup. CASCADE on connection delete handles the case where
  // the connection row is removed; this covers the live revoke path where
  // the connection row sticks around as status='revoked'.
  const { error } = await supabase
    .from('IntegrationTrigger')
    .delete()
    .eq('connectionId', connectionId);
  if (error) {
    logger.warn('[integrations.triggers] db delete failed', {
      connectionId,
      err: error.message,
    });
  }
}

/**
 * Flip every IntegrationTrigger row for a connection between 'active'
 * and 'paused'. Realtor-facing — the integrations panel offers ONE
 * toggle per connected app, not one per trigger. Per-trigger granularity
 * is a settings rabbit hole the realtor does not need.
 *
 * Idempotent: pausing an already-paused connection is a no-op.
 * Failed rows (status='failed') are left alone — those are a separate
 * recovery path (re-register on reconnect).
 */
export async function setPausedForConnection(args: {
  connectionId: string;
  paused: boolean;
}): Promise<{ updated: number }> {
  const targetStatus: TriggerStatus = args.paused ? 'paused' : 'active';
  const oppositeStatus: TriggerStatus = args.paused ? 'active' : 'paused';
  const { data, error } = await supabase
    .from('IntegrationTrigger')
    .update({ status: targetStatus, updatedAt: new Date().toISOString() })
    .eq('connectionId', args.connectionId)
    .eq('status', oppositeStatus)
    .select('id');
  if (error) {
    logger.warn('[integrations.triggers] setPausedForConnection failed', {
      connectionId: args.connectionId,
      paused: args.paused,
      err: error.message,
    });
    return { updated: 0 };
  }
  return { updated: (data ?? []).length };
}

/**
 * Did this connection have ANY active trigger at the time of the check?
 * Used by the integrations list endpoint to render the per-connection
 * "Chippi is watching" / "Paused" affordance. Returns false when the
 * connection has no rows at all (nothing curated for that toolkit).
 */
export async function hasActiveTriggers(connectionId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('IntegrationTrigger')
    .select('id', { count: 'exact', head: true })
    .eq('connectionId', connectionId)
    .eq('status', 'active');
  if (error) return false;
  return (count ?? 0) > 0;
}

export type TriggerSummary = 'off' | 'active' | 'paused' | 'failed';

/**
 * Per-connection trigger summary for the integrations list endpoint.
 * Four states:
 *   - "off"     → no triggers registered (toolkit has empty CURATED_TRIGGERS)
 *   - "active"  → at least one trigger active
 *   - "paused"  → triggers registered but realtor paused them
 *   - "failed"  → registration attempted but Composio rejected; realtor
 *                 sees Chippi promised to watch and silently doesn't
 *                 unless we expose this state.
 *
 * Precedence: active > paused > failed > off. If a connection has both
 * a working trigger and a broken one, we show active (the realtor's
 * coverage isn't zero) — the broken slug surfaces in /api/integrations/health.
 */
export async function summariesForConnections(connectionIds: string[]): Promise<
  Record<string, TriggerSummary>
> {
  if (connectionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('IntegrationTrigger')
    .select('connectionId, status')
    .in('connectionId', connectionIds);
  if (error) {
    logger.warn('[integrations.triggers] summariesForConnections failed', { err: error.message });
    return {};
  }
  const rows = (data ?? []) as Array<{ connectionId: string; status: TriggerStatus }>;
  const map: Record<string, TriggerSummary> = {};
  for (const id of connectionIds) map[id] = 'off';
  const rank: Record<TriggerSummary, number> = { off: 0, failed: 1, paused: 2, active: 3 };
  for (const r of rows) {
    const incoming: TriggerSummary = r.status;
    if (rank[incoming] > rank[map[r.connectionId]]) {
      map[r.connectionId] = incoming;
    }
  }
  return map;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Dispatch one delivery to the right downstream path. Called by the
 * Inngest handler — keeps the inngest function thin and the dispatch
 * logic testable in isolation.
 *
 * Idempotency lives upstream of this (the receiver dedupes on the
 * webhook delivery id). This function may be called more than once for
 * the same logical event if Inngest retries; the downstream paths must
 * be idempotent on their own terms.
 */
export async function dispatchTrigger(args: {
  triggerSlug: string;
  connection: IntegrationConnectionRow;
  payload: Record<string, unknown> | undefined;
  deliveryId?: string;
}): Promise<{ dispatched: 'DRAFT' | 'NOTICE' | 'DATA_SYNC' | 'noop'; reason?: string }> {
  const kind: TriggerKind | undefined = TRIGGER_DISPATCH[args.triggerSlug];
  if (!kind) {
    logger.info('[integrations.triggers] no dispatch handler — dropping', {
      slug: args.triggerSlug,
      connectionId: args.connection.id,
    });
    return { dispatched: 'noop', reason: 'no_dispatch' };
  }

  if (kind === 'DRAFT') {
    const instruction = templateInstruction(args.triggerSlug, args.payload);
    if (!instruction) {
      logger.info('[integrations.triggers] payload too thin — skipping draft', {
        slug: args.triggerSlug,
        connectionId: args.connection.id,
      });
      return { dispatched: 'noop', reason: 'thin_payload' };
    }
    // Prepend a structured trigger tag so the Modal autonomous-mode
    // detector can tell this run from a chat turn. Without it, the
    // model may read the first-person instruction as a chat message
    // and reply "Got it." instead of doing the work.
    const tagged = `[Autonomous run — Composio trigger: ${args.triggerSlug}]\n\n${instruction}`;
    // Also pass the structured triggerSource through so the drafts
    // tool can persist it on AgentDraft.triggerSource. The inbox UI
    // reads from that column to render the "Chippi noticed because
    // [event]" breadcrumb — the trust moment Phase 4 surfaces.
    const triggerSource = {
      kind: 'composio_trigger' as const,
      slug: args.triggerSlug,
      toolkit: args.connection.toolkit,
      deliveryId: args.deliveryId ?? '',
    };
    await fireRoutineRun(
      args.connection.spaceId,
      tagged,
      args.connection.userId,
      triggerSource,
    );
    return { dispatched: 'DRAFT' };
  }

  // NOTICE and DATA_SYNC paths are wired to no-ops for v1 — the dispatch
  // table never routes to them today (no slugs use them), but if a future
  // slug gets added with kind='NOTICE' it should not silently break. Log
  // loudly so the gap is obvious in production.
  logger.warn('[integrations.triggers] dispatch kind not yet wired', {
    slug: args.triggerSlug,
    kind,
    connectionId: args.connection.id,
  });
  return { dispatched: 'noop', reason: 'unwired_kind' };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

interface UpsertTriggerArgs {
  connectionId: string;
  triggerSlug: string;
  composioTriggerId: string | null;
  status: TriggerStatus;
  lastError?: string;
}

async function upsertTriggerRow(args: UpsertTriggerArgs): Promise<boolean> {
  // Unique (connectionId, triggerSlug) — onConflict makes this an upsert.
  const { error } = await supabase
    .from('IntegrationTrigger')
    .upsert(
      {
        connectionId: args.connectionId,
        triggerSlug: args.triggerSlug,
        composioTriggerId: args.composioTriggerId,
        status: args.status,
        lastError: args.lastError ?? null,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'connectionId,triggerSlug' },
    );
  if (error) {
    logger.error('[integrations.triggers] upsert failed', {
      connectionId: args.connectionId,
      slug: args.triggerSlug,
      err: error.message,
    });
    return false;
  }
  return true;
}

export async function listTriggersForConnection(
  connectionId: string,
): Promise<IntegrationTriggerRow[]> {
  const { data, error } = await supabase
    .from('IntegrationTrigger')
    .select('*')
    .eq('connectionId', connectionId);
  if (error) {
    logger.warn('[integrations.triggers] list failed', { connectionId, err: error.message });
    return [];
  }
  return (data ?? []) as IntegrationTriggerRow[];
}

/**
 * Look up an IntegrationTrigger by Composio's trigger id — the join key
 * the webhook receiver has on hand. Returns null when the delivery
 * arrives for a trigger we don't track (stale registration, mid-disconnect).
 */
export async function findByComposioTriggerId(
  composioTriggerId: string,
): Promise<IntegrationTriggerRow | null> {
  const { data } = await supabase
    .from('IntegrationTrigger')
    .select('*')
    .eq('composioTriggerId', composioTriggerId)
    .maybeSingle();
  return (data ?? null) as IntegrationTriggerRow | null;
}

/** Stamp `lastFiredAt`. Non-blocking: a failure here doesn't fail dispatch. */
export async function stampFired(triggerRowId: string): Promise<void> {
  const { error } = await supabase
    .from('IntegrationTrigger')
    .update({ lastFiredAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq('id', triggerRowId);
  if (error) {
    logger.warn('[integrations.triggers] stampFired failed', { triggerRowId, err: error.message });
  }
}
