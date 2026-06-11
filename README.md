# Koala

Agentic operating system for reps and teams.

---

## What is Koala?

Koala is an agentic operating system for reps and teams. It combines always-on AI agent workflows, lead intake, qualification, follow-up orchestration, and team coordination into a single operational platform.

### Key features

- **Public intake forms** — Custom-branded application pages for prospects to submit rental applications
- **AI lead scoring** — Automatic lead qualification using GPT-4o-mini with score, tier (hot/warm/cold), and actionable summaries
- **Deal pipeline** — Kanban-style deal management with customizable stages, drag-and-drop, and contact linking
- **Demo scheduling** — Public booking page, calendar integration, automated confirmations/reminders
- **Team management** — Multi-user team dashboards, invite system, performance tracking across reps
- **AI agent** — Agent runtime with tool-use over the rep operating system (read-only tools auto-run; mutating tools — email, SMS, deal/stage changes, demos — require per-call user approval). Delegates research questions to read-only sub-agents so profile lookups don't bloat the orchestrator's context. See `lib/ai-tools/tools/index.ts` for the tool registry and `lib/ai-tools/skills/*` for the sub-agents.
- **Always-on background activation** — Incoming workspace events (new lead, deal stage change, demo completed, application submitted) are queued in Redis and immediately attempt a Modal webhook fire (`POST /api/agent/trigger`) so per-rep agents can react in near real-time with queue-based fallback if Modal is unavailable. Immediate fire policy is configurable with `AGENT_IMMEDIATE_EVENTS` (`all` by default, or comma-separated event names; invalid values fail safe to `all`).
- **Trigger operations runbook** — Operational endpoints, env vars, alerting, and replay workflow are documented in `docs/AGENT_TRIGGER_OPERATIONS.md`.
- **Team tier** — Multi-agent organisation with per-seat billing: team membership + role tiers (`manager_owner`, `manager_admin`, `rep_member`) in `lib/permissions.ts`; lead routing across agents (`lib/team-routing.ts`); commission ledger (`lib/commissions.ts`); Stripe-backed seat subscriptions (`lib/team-seats.ts`, `app/api/billing/*`)
- **Notifications** — Email (Resend) and SMS (Telnyx) notifications for leads, demos, deals, and follow-ups
- **Analytics** — Weekly trends, conversion funnels, and team performance metrics

### Who it's for

- **Solo reps** handling leasing and rental leads
- **Small teams** and teams managing multiple reps
- **Manager-only users** overseeing team performance without a personal workspace

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS 4, shadcn/ui components |
| Auth | Clerk |
| Database | PostgreSQL via Supabase |
| AI | OpenAI (scoring + embeddings + assistant) |
| Vector search | Supabase pgvector |
| Email | Resend |
| SMS | Telnyx |
| Cache | Upstash Redis |
| Deployment | Vercel |

---

## Project structure

```
app/                    # Next.js App Router pages, layouts, API routes
  (auth)/               # Sign-in, sign-up, login pages
  s/[slug]/             # Workspace pages (dashboard, leads, contacts, deals, demos, settings)
  manager/               # Team management pages
  setup/                # Onboarding and workspace creation
  api/                  # API routes (contacts, deals, demos, onboarding, AI, etc.)
components/             # UI and feature components
  ui/                   # Base shadcn/ui components
  dashboard/            # Dashboard widgets (header, sidebar, notification center)
  deals/                # Kanban board, deal forms
  manager/               # Team-specific components
  auth/                 # Auth page layout, onboarding flow
lib/                    # Core business logic
  email.ts              # Resend email templates (leads, deals, invitations, digests)
  demo-emails.ts        # Demo confirmation, reminder, follow-up emails
  sms.ts                # Telnyx SMS integration
  notify.ts             # Unified notification dispatcher (email + SMS)
  lead-scoring.ts       # AI lead scoring via OpenAI
  ai.ts                 # AI assistant with provider fallback
  supabase.ts           # Supabase client
  permissions.ts        # Auth helpers and manager context
supabase/
  schema.sql            # Database schema and migrations
docs/framework/         # Design system documentation (tokens, components, archetypes)
```

---

## Getting started

### Prerequisites

- Node.js 18+
- pnpm
- Supabase project (or PostgreSQL database)
- Clerk account for authentication

### Environment setup

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Supabase connection
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` — Clerk auth
- `OPENAI_API_KEY` — Lead scoring and embeddings

Optional:
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — Email notifications
- `TELNYX_API_KEY` + `TELNYX_FROM_NUMBER` — SMS notifications
See [ENVIRONMENT.md](./ENVIRONMENT.md) for the full reference.

### Install and run

```bash
pnpm install
pnpm dev
```

### Database setup

1. Create a Supabase project
2. Enable the pgvector extension (Database > Extensions > search "vector")
3. Run `supabase/schema.sql` in the SQL editor

### Build for production

```bash
pnpm build
pnpm start
```

---

## Core workflows

1. **Rep signs up** via Clerk and completes onboarding (or skips to set up later)
2. **Workspace created** with a custom slug and public intake link
3. **Prospects submit** rental applications through the public intake form
4. **Leads are scored** automatically by AI and saved as contacts
5. **Rep manages** leads, contacts, deals, and demos from the workspace dashboard
6. **Notifications sent** via email and/or SMS based on workspace preferences
7. **Managers** can invite reps, track team performance, and manage the team

---

## Environment reference

See [ENVIRONMENT.md](./ENVIRONMENT.md) for a detailed breakdown of all environment variables, services, and per-workspace configuration.

---

## Design system

The design system documentation lives in `docs/framework/` and covers:
- Design tokens (colors, spacing, typography, motion)
- Component specs (cards, tables, forms, modals, etc.)
- Screen archetypes (dashboard, analytics, table index, detail, settings)
- Dashboard archetypes (queue, pipeline, analytics, admin overview)
- Responsive breakpoints and mobile behavior

---

## License

Proprietary. All rights reserved.
