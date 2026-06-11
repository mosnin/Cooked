# PRICING_V2_PLAN.md

Implementation plan for the **Chippi V2 three-layer pricing model** (see the
product spec: Free / Solo / Pro Performer / Team / Team Plus + brokerage
expansion + performance pricing, built on a per-workflow **credit** currency).

> Status: **PLAN — not yet built.** This is the grounded blueprint. Every
> "today" claim below is cited to a file so it's checkable. Nothing here ships
> products are created (the design decisions, incl. unit economics, are locked
> in §3). Migrations carry the same gate as the rest of the repo:
> validate a from-empty `supabase db reset` before merge.

---

## 1. Where we are today (grounded)

| Area | Today | File |
|---|---|---|
| Stripe client | Optional, gated on `STRIPE_SECRET_KEY` | `lib/stripe.ts` |
| Billing columns (Space) | `stripeCustomerId/SubscriptionId/Status/PeriodEnd`, `trialUsedAt` | `supabase/migrations/20260324300000_stripe_billing.sql`, `…_trial_tracking.sql` |
| Billing columns (Brokerage) | same + `plan (starter\|team\|enterprise)`, `seatLimit (5\|15\|null)` | `supabase/migrations/20260509000000_brokerage_billing.sql` |
| Checkout | One flat price per context; **`quantity: 1` hardcoded** | `app/api/billing/checkout/route.ts:151,312` |
| Webhook | Updates status/plan/seatLimit; Redis idempotency; anti-poisoning guards | `app/api/webhooks/stripe/route.ts` |
| Access gating | `status IN (active,trialing)` in both layouts | `app/s/[slug]/layout.tsx`, `app/broker/layout.tsx` |
| Seat counting | members + non-expired pending invites; `checkSeatCapacity()` | `lib/brokerage-seats.ts` |
| Usage metering | **Daily TOKEN budget for autonomous runs only** (Redis `agent:budget:{space}:{date}`) + `ChatUsage` token log | `agent/security/budget.py`, `lib/usage/today-token-usage.ts` |
| Close → commission | Auto `CommissionLedger` row on `Deal.status='won'` (DB trigger) | `supabase/migrations/20260507000000_commission_ledger.sql` |

**Verified gaps (the work):**
- ❌ No **credit** currency, balance, ledger, allocation, rollover, or top-ups.
- ❌ No per-account **plan tier** on `Space` (only `Brokerage.plan`). No Free tier.
- ❌ No **seat/usage-based Stripe billing** — `quantity` is always 1, so Layer 2 auto-expand and Layer 3 metered closes are unbuilt.
- ❌ No **attribution chain** (score → sequence → close). Only a weak `deal_advanced` correlation signal (`app/api/cron/draft-outcomes/route.ts`).
- ❌ Three sold workflows **don't exist in code**: full pipeline audit (rescore-all), call prep, and *multi-touch sequences* (today `set_followup` schedules a single follow-up).

---

## 2. The model (from the spec)

- **Layer 1 — Platform tiers:** Free $0 (1 user, **100 one-time** credits, no expiry), Solo $97 (1, 1,500/mo), Pro Performer $197 (1, 4,000/mo), Team $497 (5, 12,000/mo, +$79/user +1,500cr), Team Plus $897 (10, 25,000/mo, +$69/user +2,000cr).
- **Layer 2 — Brokerage expansion:** auto-expanding per-agent price bands (10–24 → $69/mo, 25–49 → $59, 50–99 → $49, 100–199 → $39, 200+ custom; annual ≈ 18–20% less).
- **Layer 3 — Performance pricing (100+ agents, on request):** base from $3,497/mo + **$49 per attributed close** (a lead Chip scored, sequenced, and the agent closed).
- **Credits** are spent per premium workflow: audit 50, follow-up sequence 40, qualification 25, tour 15, briefing 10, call prep 3, score update 1. Paid-plan credits **roll over 30 days**; top-ups (1k/$29, 3k/$69, 8k/$149) are one-time, also 30-day rollover.

---

## 3. Decisions (locked)

These were left to engineering judgment. They're now decided so nothing is
blocked; each can be revisited with real production data, but the build proceeds
on these defaults.

1. **Pooling boundary — DECIDED.** Solo/Pro = per-`Space` balance. Team/Team Plus = pooled per-`Brokerage`. One resolver `resolveBillingAccount(spaceId)` owns the space-vs-brokerage choice; a broker_owner's personal solo space keeps its own balance unless that space is on a Team plan.
2. **Rollover — DECIDED.** Per-lot `expiresAt = issuedAt + 30d`; balance = Σ `remaining` over non-expired lots; debit FIFO, oldest-expiring first (so granted credits are consumed before they lapse). Free-tier's 100 credits have `expiresAt = NULL` (never expire, per spec).
3. **Refund-on-failure — DECIDED.** Debit happens just before execution; if the workflow throws, a compensating positive `CreditTxn` restores the lot. Net effect: you're only charged for work that completed.
4. **Free-tier abuse — DECIDED (accept + monitor).** 100 non-expiring credits, bounded by Clerk account + the existing one-space-per-user rule. No card wall. Add an alert if a single IP/device spins up many free accounts; revisit only if abuse shows up.
5. **Annual billing — DECIDED.** Annual Stripe price billed upfront; credits granted **monthly** by a cron (`app/api/cron/credit-grants`) keyed off the plan's anniversary day, not the (yearly) invoice event.
6. **Migration of current subscribers — DECIDED.** `STRIPE_PRICE_ID` (current Solo, already **$97**) → new **Solo** (clean 1:1, just start the 1,500/mo grant). Brokerage `starter`→**Team**, `team`→**Team Plus**, `enterprise`→Layer-2 custom. Grandfather any price delta for one billing cycle; backfill `plan` + an initial credit lot on deploy.

### Unit economics (first pass — the number that governs the model)

A credit must retail above its marginal cost. Retail value per credit, by how
it's acquired: Solo $97/1,500 ≈ **$0.065**, Pro $197/4,000 ≈ **$0.049**, Team
$497/12,000 ≈ **$0.041**, top-ups **$0.029 / $0.023 / $0.0186**. So a credit is
worth roughly **$0.02–0.065** depending on plan/top-up.

Estimated COGS per workflow (rough, blended OpenRouter/OpenAI rates; routine
actions already run on cheap models — scoring on `gpt-4.1-mini`):

| Workflow | Credits | Retail (Solo→top-up) | Est. token COGS | Margin |
|---|---|---|---|---|
| Lead score update | 1 | $0.02–0.065 | ~$0.005–0.01 | healthy |
| Call prep | 3 | $0.06–0.20 | ~$0.02–0.05 | healthy |
| Daily briefing | 10 | $0.19–0.65 | ~$0.05–0.15 | healthy |
| Tour booking | 15 | $0.28–0.98 | ~$0.05–0.15 | healthy |
| Lead qualification | 25 | $0.47–1.63 | ~$0.10–0.30 | healthy |
| Follow-up sequence | 40 | $0.74–2.60 | ~$0.15–0.40 | healthy |
| **Full pipeline audit** | 50 | $0.93–3.25 | **scales with pipeline size** | ⚠️ unbounded |

**Decision:** the spec's credit costs and monthly grants are **kept as-is** —
they're margin-positive at every retail tier **except the pipeline audit**,
whose token cost scales with the number of active leads while its credit price
is flat at 50. **The audit is therefore scope-bounded:** it rescores up to a
capped batch (default **100 active leads**) per 50-credit run; larger pipelines
run it in additional 50-credit batches. This keeps gross margin ≥ ~60% on every
workflow. Target to hold as models/prices move: **COGS ≤ 40% of the credit's
retail value**; if a model price rises, raise that workflow's credit cost, not
the plan price.

> Caveat: COGS figures are estimates from public model pricing + reasonable
> token counts, not measured traffic. Instrument actual per-workflow token spend
> (the `ChatUsage` log already captures tokens) and re-check after Phase 1 ships.

---

## 4. Architecture

### 4.1 Billing account abstraction
Introduce a single concept: a **billing account** = the entity that owns a plan + credit balance. It is either a `Space` (Free/Solo/Pro) or a `Brokerage` (Team/Team Plus). One helper `lib/billing/account.ts → resolveBillingAccount(spaceId) → { type, id, plan }` so every debit/grant/gate goes through one resolver. This avoids scattering `space vs brokerage` branching across the metering call sites.

### 4.2 Plan tiers — `lib/plans.ts` (single source of truth)
```ts
// One table the whole app reads. Mirrors STRIPE_PRICE_* env + DB plan enum.
export const PLANS = {
  free:      { stripePrice: null,                 includedUsers: 1,  monthlyCredits: 0,     oneTimeCredits: 100 },
  solo:      { stripePrice: env.STRIPE_PRICE_SOLO,        includedUsers: 1,  monthlyCredits: 1500 },
  pro:       { stripePrice: env.STRIPE_PRICE_PRO,         includedUsers: 1,  monthlyCredits: 4000 },
  team:      { stripePrice: env.STRIPE_PRICE_TEAM,        includedUsers: 5,  monthlyCredits: 12000, addUser: { price: 79, credits: 1500 } },
  team_plus: { stripePrice: env.STRIPE_PRICE_TEAM_PLUS,   includedUsers: 10, monthlyCredits: 25000, addUser: { price: 69, credits: 2000 } },
} as const;
```
- DB: add `plan text NOT NULL DEFAULT 'free'` to `Space` (CHECK `free|solo|pro`); extend `Brokerage.plan` CHECK to add `team|team_plus` (+ the expansion is Layer 2). Replace `seatLimit` semantics with `includedUsers` from `PLANS`.
- `lib/env.ts`: add `STRIPE_PRICE_{SOLO,PRO,TEAM,TEAM_PLUS}` + the top-up + annual price IDs, with boot validation (today even the brokerage IDs are read raw from `process.env`).
- Checkout: pick price by requested tier; portal/cancel unchanged; webhook writes `plan` and fires the monthly credit grant.
- Free tier: no Stripe sub. Gate features by `plan` + grant the one-time 100 credits on space creation.

### 4.3 The credit ledger (the core primitive — Phase 1)
**Append-only ledger + cached balance.** Append-only is the audit trail; the cached integer is for fast reads/gating.
```sql
CREATE TABLE "CreditLot" (              -- a grant or top-up that can expire
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountType" text NOT NULL CHECK ("accountType" IN ('space','brokerage')),
  "accountId"   text NOT NULL,
  amount        integer NOT NULL,       -- credits granted in this lot
  remaining     integer NOT NULL,       -- decremented as spent (FIFO)
  reason        text NOT NULL,          -- 'monthly_grant'|'topup'|'free_signup'|'addon_user'
  "expiresAt"   timestamptz,            -- null = never (Free tier 100)
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "CreditTxn" (              -- every debit (and refund), for audit
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountType" text NOT NULL,
  "accountId"   text NOT NULL,
  delta         integer NOT NULL,       -- negative = spend, positive = refund
  workflow      text NOT NULL,          -- 'pipeline_audit'|'followup_sequence'|…
  "spaceId"     text,                   -- who actually spent (for team breakdown)
  "userId"      text,
  metadata      jsonb,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
-- Indexes: (accountType, accountId, expiresAt) on CreditLot; (accountType, accountId, createdAt) on CreditTxn.
```
- **Grant:** on `invoice.payment_succeeded` (webhook), insert a `CreditLot` (`monthly_grant`, `expiresAt = now()+30d`) sized by `PLANS[plan].monthlyCredits` (+ add-on users). Annual plans: a monthly cron grants instead (since invoice fires yearly).
- **Balance:** `SUM(remaining)` over non-expired lots. Cache on the account row (`creditBalance int`) updated transactionally; the lots are the truth.
- **Debit:** `spendCredits(account, workflow, ctx)` — FIFO across non-expired lots, writes a `CreditTxn`, decrements `remaining`, fails closed (HTTP 402 / tool refusal) if insufficient. **Service-role bypasses RLS — the account scoping in this helper is the only boundary; never debit without resolving the account from a trusted server context.**
- **Refund:** wrap the workflow; on throw after debit, write a positive `CreditTxn` + restore `remaining`.
- **Top-ups:** one-time Stripe Checkout (mode=payment) → webhook inserts a `CreditLot` (`topup`, `+30d`).

### 4.4 Premium workflows → metering hook points
Build decision: **build the 3 missing workflows** so the credit menu isn't selling vapor.

| Workflow | Credits | Status | Hook point |
|---|---|---|---|
| Lead score update | 1 | ✅ exists | `app/api/contacts/[id]/rescore/route.ts`, `app/api/agent/rescore-contact/route.ts` |
| Call prep | 3 | ❌ **build** | New agent tool `call_prep` + route; debit on generate |
| Daily AI briefing | 10 | ✅ exists | `app/api/cron/daily-briefing/route.ts` (debit per brief composed) |
| Tour booking | 15 | ✅ exists | `lib/ai-tools/tools/schedule-tour.ts` |
| Lead qualification | 25 | ✅ exists (intake→score) | `app/api/public/apply/route.ts` scoring path / agent rescore |
| Follow-up *sequence* | 40 | ⚠️ **build** (only single `set_followup` today) | extend `lib/ai-tools/tools/set-followup.ts` → multi-touch sequence; debit per sequence |
| Full pipeline audit | 50 | ❌ **build** (no rescore-all) | New `pipeline_audit` tool + batch rescore + top-5 surfacing; debit per run |

Each hook calls `spendCredits()` **before** doing the work (or debit→refund-on-fail). For agent tools, the debit lives in the tool handler (after approval, before execution).

### 4.5 Layer 2 — brokerage auto-expand
- Move brokerage subscription to **`quantity = active agent count`** (the count already exists in `lib/brokerage-seats.ts`) with a Stripe **graduated/tiered price** encoding the $69→$59→$49… bands. Adjust quantity (with proration) on member add/remove; reconcile in the webhook. Replaces the hard `seatLimit` caps with metered seats.
- Annual: separate annual graduated price IDs.

### 4.6 Layer 3 — performance pricing (defer; manual first)
- New `AttributionEvent` table linking `agentRunId/toolName/contactId/dealId/actionAt → close`, fed by `AgentMemory.sourceRunId` + `DealActivity` + the `won` trigger. Define "attributed close" precisely (scored within N days → sequenced → closed) — **causation is fuzzy; ship a manual report first**, bill `$49/close` via Stripe metered usage only once the definition is trusted. Lowest priority; spec already gates it to "100+ agents, on request."

---

## 5. Phased build order

- **Phase 0 — Tiers + billing account.** `lib/plans.ts`, `Space.plan` migration, `Brokerage.plan` extension, env price IDs + validation, checkout/webhook tier routing, Free-tier gating. *(Stripe products must exist first.)*
- **Phase 1 — Credit ledger.** `CreditLot`/`CreditTxn` migration, `lib/billing/account.ts` + `lib/billing/credits.ts` (`grant/spend/refund/balance`), monthly grant on webhook + annual cron, balance UI (header/settings), top-up checkout. Wire `spendCredits()` into the **4 existing** workflows.
- **Phase 2 — Missing workflows.** Build `pipeline_audit`, `call_prep`, multi-touch `followup_sequence`; meter each.
- **Phase 3 — Layer 2 seat metering.** Stripe graduated price + quantity sync + proration; retire `seatLimit` caps.
- **Phase 4 — Layer 3 attribution.** `AttributionEvent`, manual report, then metered Stripe usage.

Phases 0–1 are the foundation everything else needs; do them first.

## 6. Stripe setup checklist (owner, before Phase 0 ships)
- Products + monthly **and** annual recurring prices: Solo, Pro, Team (+ per-seat add-on), Team Plus (+ add-on), brokerage graduated seat price (bands), Layer-3 base + metered-usage price.
- One-time prices: Starter/Growth/Power top-ups.
- Set the resulting price IDs as `STRIPE_PRICE_*` env vars in Vercel + Modal secrets.

## 7. Risks
- **Unit economics** — decided in §3 (keep spec costs; bound the pipeline audit). Re-validate against measured token spend after Phase 1; the audit bound is the live risk to watch.
- **Credit accounting correctness** — money-adjacent; the ledger must be transactional and auditable (hence append-only lots + txns).
- **Migrating live subscribers** without double-charging or access loss.
- **Service-role + app-layer scoping** — a missing account filter in `spendCredits` is a cross-tenant credit leak with no DB safety net.
- **Selling unbuilt features** — mitigated by the Phase-2 decision to build the 3 missing workflows before metering them.

---

_Companion maps that grounded this plan live in the session that authored it; every "today" claim above is cited to a file and should be re-verified against the code before each phase begins._
