# Koala Transformation Guide

Single source of truth for converting this codebase from **Chippi** (agentic OS
for U.S. real-estate agents and brokerages) into **Koala** (agentic OS for
sales teams). Every workstream agent reads this before editing.

## 1. Product identity

**Koala** is an agentic operating system for **sales teams**. It tracks sales
reps and their performance, qualifies and routes leads, manages deals and
commissions, places and transcribes calls through **Twilio**, and ships with
**Axil** — an AI agent that works the pipeline on the rep's behalf, coaches
reps to improve, and runs **mock sales calls** against configurable **ICPs**
(Ideal Customer Profiles).

- **Koala** = the product / brand / company. Used in: marketing pages, billing,
  plans, package metadata, emails, docs branding, env var prefixes (`KOALA_*`).
- **Axil** = the AI agent persona users talk to and that acts autonomously.
  Used in: chat surfaces, agent attribution ("Axil drafted this"), the Python
  agent service, plugins, prompts, avatar components. Axil speaks in first
  person as Axil. Anywhere the *assistant* (not the company) is named, it is
  Axil.

Who it serves: solo reps/AEs and SDRs run their own pipeline; **teams** —
sales managers oversee reps: lead routing, commission management, deal review,
rep performance, call review, coaching. The "manager" role is the sales
manager (formerly broker).

## 2. Terminology map

A mechanical, case-aware rename has **already been applied** repo-wide
(content + file/dir names): `chippi→koala`, `brokerage→team`,
`broker→manager`, `realtor→rep`, `tour→demo`. Do not reintroduce old terms.

Remaining mappings are **judgment work** — apply them in copy, prompts,
comments, emails, and (only where you verify every reference with `git grep`
and keep the build consistent) identifiers/files:

| Real-estate concept | Koala (sales) concept |
|---|---|
| real estate / realty | sales |
| property (the asset) | **product** (what the team sells) |
| listing | offering / pitch |
| property packet | sales packet / product one-pager |
| CMA (comparative market analysis) | competitive pricing analysis |
| buyer / seller | prospect / customer |
| renter / tenant / leasing lead | inbound lead / SMB lead |
| landlord / owner | decision-maker / account owner |
| rental application / apply flow | lead qualification form |
| home / house / unit / address | product / account context |
| open house / showing | demo / webinar |
| MLS / Zillow / Redfin | CRM data sources / enrichment |
| escrow / under contract / closing | contract sent / closing (keep) |
| square footage, beds/baths | product specs / plan tier |
| GCI (gross commission income) | gross commission |
| fair-housing compliance copy | sales compliance (TCPA for calling) |
| Telnyx (voice provider) | **Twilio** |

Notes:
- A "demo" (formerly tour) is a booked product demo / sales meeting. Demo
  booking pages, waitlists, availability all carry over with sales copy.
- "Space" (a rep's workspace), "Deal", "Contact", "Lead" already fit sales.
- `co_agent` commission party = co-seller; "agent" alone (AI sense) stays.
- Beware generic `property`/`properties` in TS/JS/Python (object properties,
  CSS, `@property`). Only rename domain usages; verify each.

## 3. Feature specs (new work)

### F1 — Twilio calling + transcription (replaces Telnyx)
- `lib/twilio.ts`: REST client helpers (outbound call creation, recording
  fetch), `X-Twilio-Signature` validation (HMAC-SHA1 of url+sorted params,
  base64), TwiML helpers.
- `app/api/webhooks/twilio-voice/route.ts`: call status callbacks, recording
  status callbacks, transcription callbacks → persist on the existing call log
  (provider columns via new migration: `twilio_call_sid`, `recording_url`,
  `transcript_text`, `transcript_status`). Signature-validated, rate-limited,
  test-covered like the Telnyx route was.
- Click-to-call + calls views surface recordings and transcripts; transcripts
  feed Axil coaching (F2 stretch).
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
  (config agent adds to `.env.example`; Twilio agent wires `lib/env.ts`).
- All files matching `git grep -il telnyx` belong to this workstream.

### F2 — Axil practice: ICPs + mock sales calls
- Migration: `Icp` (team/space scoped; name, description, persona JSONB —
  industry, company_size, role, pain_points[], objections[], budget,
  buying_process, temperament) and `MockCall` (space_id, user, icp_id,
  scenario, status, transcript JSONB turns[], score numeric, rubric/feedback
  JSONB, started_at, ended_at). Follow `DB_CONVENTIONS.md` (PascalCase tables,
  RLS posture matching existing tables).
- `lib/mock-calls/`: ICP CRUD + session orchestration. Axil roleplays the
  prospect per ICP (raises that ICP's objections, matches temperament), then
  scores the rep on a rubric — discovery, objection handling, value
  articulation, closing, talk ratio — with concrete coaching feedback.
  Reuse `lib/llm.ts` patterns for model calls.
- API: `app/api/mock-calls/` (list/create; `[id]` get/turn/end+score),
  auth/shape per `API_CONTRACTS.md` and existing `app/api/calls/*` exemplars.
- UI: `app/s/[slug]/practice/` + `components/practice/` — manage ICPs, start a
  mock call, chat-style call surface, post-call score card + coaching report.
  Nav entry "Practice" in `lib/nav-items.ts` (owned by this workstream).

### F3 — Commissions & rep performance (adapt existing)
- `lib/commissions.ts` + commission UI: sales wording (gross commission, team
  split, co-seller, referral), keep math/tests green.
- Team console: rep tracking dashboards (leaderboard, quota/attainment
  language, call + demo + deal metrics) get sales-native labels.

## 4. Working rules (all agents)

1. Stay inside your assigned paths; the one exception: if you rename an
   identifier/file/route, update **every** reference repo-wide (`git grep`)
   in the same pass, and if you change a user-visible string asserted in
   `tests/`, update that assertion.
2. Strings-first. Identifier and file renames only with full-reference
   verification. Keep TypeScript compiling and imports resolving.
3. Never touch: `pnpm-lock.yaml`, `node_modules/`, `package.json`
   dependencies, `.git/`.
4. Do NOT run `git add`/`git commit`/`git push` — commits happen centrally.
   Do not start dev servers or run `pnpm install`.
5. Prompts/LLM instructions you encounter must end up sales-native (no
   realtor framing left inside Axil's brain).
6. Match existing code style, casing conventions (`DB_CONVENTIONS.md`,
   `STYLESHEET.md`), and auth patterns (`lib/api-auth.ts`).
7. Placeholder domains/emails: use `koala.so` style placeholders
   (e.g. `support@koala.so`) consistently.
