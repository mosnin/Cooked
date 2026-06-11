# SYSTEMS.md

The bug-hunting map: **symptom → owning system → files**. When something breaks, start here, jump to the system, open the cited files.

This is the hand-written judgment layer. For mechanical structure (every route, table, tool, cron) see the generated `docs/repo-map.generated.md`; for the visual, `docs/architecture-diagram.svg`. The bug fixes and findings from the 2026-06 ten-agent audit ship in the companion PR (`docs/AUDIT_2026-06.md`).

**The one fact that governs every system:** Supabase runs under the **service-role key — RLS is bypassed.** Tenant isolation is enforced *only* in application code, by scoping every workspace query to the caller's `spaceId`/`ownerId`/`brokerageId`. A single missing `.eq('spaceId', …)` is a cross-tenant leak with no database safety net. Most real bugs in this repo live on that seam.

---

## Symptom → system router

| If the symptom is… | Go to system |
|---|---|
| Can't sign in / wrong workspace / banned user still has access / offboarded user active | **1. Auth & Trust Core** |
| Public application form, AI chat intake, lead score wrong/missing | **2. Public Intake & Scoring** |
| Contacts/leads/deals/stages wrong, kanban order, a contact sees another's data | **3. CRM Substrate** |
| Tour booking, double-booking, availability, calendar sync | **4. Tours & Calendar** |
| Chippi chat in-app: replies, tool calls, approval prompts, streaming | **5. Chippi Chat Runtime (TS)** |
| Chippi acting on its own, didn't fire on an event, cron, swarm, runaway spend | **6. Autonomous Agent** |
| Broker dashboard, team roster, lead routing, commissions, reviews, invites, seats | **7. Brokerage Tier** |
| Applicant/client portal login, messaging a realtor, client documents | **8. Client Portal** |
| AI image/video, brand kit, file/document upload & download, e-sign, integrations | **9. Studio, Files & Integrations** |
| Stripe/billing, subscription status, admin panel, webhooks, email/SMS/push | **10. Billing, Admin & Webhooks** |

---

## 1. Auth & Trust Core

Identity, session validity, tenant access, and revocation for every protected surface.

- **Entry:** `middleware.ts` (Clerk gate, ban/offboarding fast-path, admin pre-check); `lib/api-auth.ts` (`requireAuth`, `requireSpaceOwner`, `requireContactAccess` — the canonical API choke-point); `lib/permissions.ts` (`requireBroker`/`requirePlatformAdmin`/`getBrokerContext`); `app/auth/redirect/page.tsx` (post-login routing).
- **Owns:** `User` (`clerkId`, `status`, `platformRole`), `BrokerageMembership`, `Space.ownerId`.
- **Fragile seams:** (1) **Ban propagation lag** — DB `platformRole='banned'` is truth, but GET `/api/*` paths rely on Clerk session metadata that propagates with undefined delay. (2) Service-role + app-layer scoping (the global invariant above). (3) Helpers must be the *only* auth path; raw `auth()` + ad-hoc role checks reintroduce gaps.

## 2. Public Intake & Lead Scoring

Unauthenticated lead capture (form + AI chat), dedup, contact persistence, and scoring. The biggest unauthenticated attack surface.

- **Entry:** `app/api/public/apply/route.ts`, `app/api/public/apply/brokerage/route.ts`, `app/api/public/intake-chat/route.ts`, `app/apply/[slug]/**`; scoring: `lib/lead-scoring.ts` → `lib/scoring/engine.ts` (deterministic) + `lib/scoring/enhance.ts` (optional LLM summary, `gpt-4.1-mini`).
- **Owns:** `Contact`, `ApplicationStatusUpdate`, `FormDraft`; reads `Space`, `SpaceSetting`, `Brokerage`.
- **Fragile seams:** (1) **The score is deterministic, not LLM** — only the *summary text* uses an LLM (correct this wherever docs claim gpt-4o-mini scoring). (2) `applicationRef` is a 64-hex bearer token; anything keyed on it alone is effectively public. (3) Rate-limit keys fall through to `'unknown'` without a forwarded IP, collapsing to a global counter.

## 3. CRM Substrate

Contacts (leads), deals (transactions), stages/pipelines, notes, checklists, commission splits, activity logs.

- **Entry:** `app/api/contacts/**`, `app/api/deals/**`, `app/api/stages/**`, `app/api/pipelines/**`, `app/api/notes/**`; auth via `lib/api-auth.ts`.
- **Owns:** `Contact`, `Deal`, `DealStage`, `DealContact`, `Pipeline`, `DealActivity`, `ContactActivity`, `DealChecklistItem`, `CommissionSplit`, `Note`.
- **Fragile seams:** (1) Parent rows enforce the space boundary, but several **child-table queries** (`DealActivity`, `Tour` in timeline, rescore updates) rely on FK correctness instead of their own `.eq('spaceId')`. (2) Reorder is atomic via the `reorder_deal` RPC; the checklist-shift loop is not. (3) Pipeline bootstrap is read-then-multi-write with no transaction (concurrent first-load can duplicate).

## 4. Tours & Calendar

Public tour booking, guest self-management by token, agent tour CRUD, Google Calendar sync.

- **Entry:** `app/api/tours/book/route.ts`, `app/api/tours/available/route.ts`, `app/api/tours/[id]/route.ts`, `app/api/tours/gcal/route.ts`, `app/api/calendar/events/route.ts`, `app/tour/[token]/page.tsx`, `app/book/[slug]/**`; `lib/gcal-helpers.ts`, `lib/tour-emails.ts`.
- **Owns:** `Tour`, `TourFeedback`, `TourWaitlist`, `TourAvailabilityOverride`, `TourPropertyProfile`, `GoogleCalendarToken`, `CalendarEventMirror`.
- **External:** Google Calendar OAuth2 + freeBusy, Composio (agent calendar path), Resend/SMS.
- **Fragile seams:** (1) The `book_tour_atomic` RPC is the *sole* double-booking guard — any path bypassing it reintroduces the race. (2) `GoogleCalendarToken.accessToken` encryption is inconsistent across three refresh paths (one reads/writes plaintext). (3) Availability conflict can scope to one property, missing same-realtor cross-property overlaps.

## 5. Chippi Chat Runtime (TS, on-demand)

The default in-app chat backend: `@openai/agents` loop, 55 domain tools, SSE streaming, approval-gated mutations. `CHIPPI_CHAT_RUNTIME=ts` (default); `=modal` proxies to the sandbox.

- **Entry:** `app/api/ai/task/route.ts`, `app/api/ai/task/resume/[pausedRunId]/route.ts`; `lib/ai-tools/sdk-chat.ts` (build/run/resume), `sdk-chat-stream.ts` (SSE+persist), `sdk-bridge.ts` (tool adapter + approval), `registry.ts`, `execute.ts`, `tools/**`, `skills/**`.
- **Owns:** `Conversation`, `Message` (content + `blocks`), `AgentPausedRun` (serialized RunState + approval gate).
- **Fragile seams:** (1) **Approval-gate integrity** — every mutating tool must require approval; the `requiresApproval ↔ summariseCall+rateLimit` contract and the SDK `needsApproval` bridge are the guard. (2) The **resume path** rebuilds `ToolContext` from the stored `spaceId` — ownership must be re-verified, not assumed. (3) `strictifySchema` strips zod `.url()/.email()/.min()` before the model sees it, so handler bodies are the only validation.

## 6. Autonomous Agent (Modal / triggers / crons / swarm)

Scheduled + event-driven Chippi runs per workspace, plus multi-agent swarms, in a Python/Modal sandbox.

- **Entry:** `agent/modal_app.py` (`run_now_webhook`/`run_swarm_endpoint`/`chat_turn`), `agent/orchestrator.py`, `agent/swarm_orchestrator.py`; `lib/agent/fire-trigger.ts` (queue write + immediate Modal dispatch); `app/api/cron/**` (10 crons), `app/api/swarm/**`.
- **Owns:** `AgentDraft`, `AgentSettings`, `AgentPausedRun`, `AgentActivityLog`, `Routine`, `SwarmRun/Member/Event`, `AgentMemory`. **Redis:** `agent:triggers:{space}`, `agent:runlock:{space}`, `agent:budget:{space}:{date}`, `agent:sweep:last:{space}`, dedupe/rate keys.
- **External:** Modal, OpenRouter/OpenAI, Composio, Upstash Redis, Inngest.
- **Fragile seams:** (1) **Cron auth** — every `/api/cron/*` must hard-check `CRON_SECRET` (and fail closed when unset). (2) Modal endpoint auth + the run-lock (atomicity matters). (3) Trigger dedupe/rate-limit races and budget enforcement.

## 7. Brokerage Tier

Multi-agent org oversight: membership, lead routing, commissions, deal reviews, templates, invitations, seats. Broker↔realtor isolation is the recurring bug class (PRs #294–#296).

- **Entry:** `lib/permissions.ts` (`requireBroker`/`getBrokerContext`/`getBrokerMemberContext`), `lib/brokerage-routing.ts`, `lib/brokerage-seats.ts`, `app/api/broker/**`, `app/api/invitations/[token]/route.ts`.
- **Owns:** `Brokerage`, `BrokerageMembership`, `Invitation`, `BrokerageRemoval`, `CommissionLedger`, `DealRoutingRule`, `BrokerageTemplate`, `DealReviewRequest/Comment`, `BrokerNotification`.
- **Fragile seams:** (1) A broker route must verify the caller belongs to the **specific** brokerage that owns the resource, not just "is a broker." (2) `getBrokerContext` multi-membership tie-break is order-dependent. (3) Seat-cap + pending-invite count has no DB-level serialization (double-spend race); invitation accept re-activates offboarded users by design.

## 8. Client / Applicant Portal

Applicant-facing surface with its **own auth (not Clerk)**: token portal (`applicationRef`+`statusPortalToken`) and account portal (email+password, OTP, HS256 JWT signed by `CLIENT_AUTH_SECRET`).

- **Entry:** `lib/client-auth.ts` (sessions/OTP/password), `lib/client-portal-data.ts` (`clientOwnsContact` — the isolation guard), `app/api/clients/**`, `app/api/applications/portal/**`.
- **Owns:** `ClientUser`, `ClientAuthCode`, `ClientMessage`, `ClientDocument`, `ClientInfoRequest`, `ApplicationMessage`.
- **Fragile seams:** (1) `CLIENT_AUTH_SECRET` is optional and falls back to the Clerk key / a hardcoded string — forge-the-session risk if misconfigured. (2) `clientOwnsContact` uses `ilike` (wildcard) not `eq` — the sole cross-client guard. (3) OTP codes aren't invalidated on reissue (multiple live codes).

## 9. Studio, Files & Integrations

AI content generation, file/document storage, property packets, e-sign, third-party toolkits.

- **Entry:** `app/api/studio/**` + `lib/studio/**`, `app/api/files/**`, `app/api/documents/**`, `app/api/upload/**`, `app/api/esign/**`, `app/api/integrations/**` + `lib/integrations/**`, `app/api/internal/**` (privileged), `app/api/packet/[token]/**`, `app/api/cron/storage-gc`.
- **Owns:** `File`, `StudioGeneration/Brand/Post`, `ContactDocument`, `DealDocument`, `PropertyPacket`, `SignatureRequest`, `IntegrationConnection`.
- **External:** fal.ai, Wasabi/S3, Composio, Follow Up Boss.
- **Fragile seams:** (1) **File/packet access authz** — downloads gated by id/token ownership + short-TTL signed URLs; a null packet `expiresAt` is a permanent share. (2) `AGENT_INTERNAL_SECRET` is one shared bearer token for cross-space internal ops — no per-space blast-radius limit. (3) `lib/crypto.ts` integration-secret key falls back to the Clerk key; storage-gc misses `files/` + `studio/` prefixes (orphan cost).

## 10. Billing, Admin & Webhooks

Money, platform admin, inbound webhooks, outbound notifications.

- **Entry:** `app/api/billing/**`, `app/api/webhooks/**` (stripe/clerk/composio/telnyx-voice), `app/api/admin/**` + `app/admin/**`, `app/api/account/**`, `lib/notify.ts`/`email.ts`/`sms.ts`, `app/api/push/**`.
- **Owns:** `Space.stripe*`/`trialUsedAt`, `Brokerage.stripe*`/`plan`/`seatLimit`, `AuditLog`, `DeadLetterEvent`, `PushSubscription`, `CallLog`.
- **External:** Stripe, Clerk/Svix, Composio (HMAC), Telnyx (voice+SMS), Resend, Redis, Inngest.
- **Fragile seams:** (1) **Every webhook must verify its signature and be idempotent** before mutating — an unset secret must fail closed (Telnyx Ed25519 + idempotency is in flight in PR #278). (2) Stripe dedup TTL (24h) is shorter than Stripe's retry window (72h). (3) Admin authz must be `requirePlatformAdmin()` on *every* `/api/admin/*` route — two trigger routes diverge to `CRON_SECRET`.

---

## Recurring hazards (the bugs we keep re-introducing)

These are bug *classes* that have recurred. Recognize the shape before you write code near it — most regressions here are someone re-stepping on one of these.

1. **Isolation-by-title-prefix is not isolation.** Broker-Chippi / team-chat conversations once lived in the realtor `Conversation`/`Message` tables distinguished only by a `[BROKER_CHIPPI]`/`[BROKERAGE_CHAT]` title prefix. Because a broker_owner also owns their personal realtor space, *space ownership alone is not a boundary*. Any realtor read of `Conversation`/`Message` MUST route through `lib/chat/conversation-access` (`isRealtorConversation` / reserved-prefix exclusion) — list, single-conversation, messages, **and the write path** (`resolveConversation`). Broker chat now has its own `BrokerConversation`/`BrokerMessage` tables (keyed by `brokerageId`); prefer structural separation over string matches.
2. **`Space.brokerageId` is NOT "which brokerage the user belongs to."** Membership lives in `BrokerageMembership` (a user can be in several). `Space.brokerageId` is only the intake-config owner and must never be overwritten on a second join. Don't read it as a membership signal.
3. **Parallel realtor↔broker routes drift.** `task`/`broker-task`, `conversations`/`broker-conversations`, `messages`/`broker-messages` are near-duplicates; a fix applied to one is easily missed on the other (the isolation guard gap lived in exactly this seam). When you touch one, check its twin.
4. **One chat runtime default.** TS is the default (`lib/ai-tools/runtime-flag.ts`); Modal is opt-in. Don't assume Modal is running for chat (Composio env, etc. must work on the TS path).
5. **Service-role bypasses RLS.** All server queries use the service-role key, so RLS is *not* the tenant boundary — app-layer `.eq('spaceId'/'brokerageId')` scoping is. Add the scope filter; don't rely on a policy.
6. **Webhooks must verify signature + be idempotent, and fail closed** when the secret is unset (see §10 seams).

If a doc disagrees with the code, the code wins — and fix the doc. Docs that merely restate structure belong in the generated map, not prose (prose rots; the map is gated).

## How to keep this honest

This file is judgment, not generated — it can drift. When you add a system or move a boundary, update the relevant section. The mechanical companion (`docs/repo-map.generated.md`) is CI-gated and can't drift; lean on it for "does this route/table/tool still exist," and use this file for "what does it mean and where does it break."
