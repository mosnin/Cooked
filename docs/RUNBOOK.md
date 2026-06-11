# RUNBOOK — Incident Response

One-pager for "prod is down — what do I check?" Keep it boring. Work top to
bottom; most incidents are caught in the first three checks.

The app is a Next.js 15 app on **Vercel** with a **Modal** Python agent
runtime, **Supabase** Postgres, **Clerk** auth, **Stripe** billing, **Resend**
email, and **Sentry** for errors + cron monitoring.

---

## 0. First 60 seconds — triage

1. Open the public status page: `https://my.usechippi.com/status` (or the
   marketing `/status`). It probes the database, the agent runtime config, and
   integrations live at request time. A rose dot there points you straight at
   the failing subsystem.
2. Open **Sentry** → Issues, filtered to the last hour, environment
   `production`. A spike of a single error tells you what broke and where.
3. Open the **Vercel** dashboard → the project → Deployments. Is the latest
   deploy `Ready`, or did it error / is it still building? A bad deploy is the
   single most common cause of "everything is down."

If all three are clean, the problem is probably a specific subsystem — jump to
the relevant section below.

---

## 1. Vercel (hosting, API routes, crons)

- **Dashboard:** Vercel → project → Deployments / Logs.
- **Symptom: site 500s or won't load.** Check the latest production deployment.
  If it's broken, **roll back** (see below). If it's `Ready`, check Runtime
  Logs for the failing function.
- **Symptom: a feature 500s but the page loads.** Filter Vercel Runtime Logs to
  that route; cross-reference Sentry for the stack trace.
- **Crons:** the 10 scheduled jobs are defined in `vercel.json` and monitored
  in Sentry (see the cron table below + `lib/cron-monitor.ts`). Vercel →
  project → Crons shows last-run status and lets you trigger a manual run.

### Roll back a Vercel deploy

The fastest, safest recovery from a bad deploy — no rebuild required:

1. Vercel dashboard → project → **Deployments**.
2. Find the last known-good **production** deployment (green, before the
   incident started).
3. Click the `…` menu on that deployment → **Promote to Production**
   (a.k.a. "Instant Rollback" / "Redeploy to Production").
4. Confirm. Vercel re-points the production alias to that build's existing
   output. Propagation is seconds.
5. CLI alternative: `vercel rollback <deployment-url>` (requires `vercel` CLI
   auth and project link).

After rollback: confirm `/status` is green, confirm the original Sentry error
stops firing, then fix forward on a branch — don't leave prod pinned to an old
build longer than necessary.

---

## 2. Sentry (errors + cron monitoring)

- **Dashboard:** Sentry → org `SENTRY_ORG`, project `SENTRY_PROJECT`.
- DSN is injected via the Sentry↔Vercel integration (`NEXT_PUBLIC_SENTRY_DSN` /
  `SENTRY_DSN`). With no DSN the SDK is dormant — so if Sentry is silent in a
  given environment, first confirm the DSN is actually set there.
- **Crons → Cron Monitors** shows each job's check-in history. A monitor in
  `missed` or `error` is a real signal: the job either didn't run on schedule
  or failed. Monitor slugs match the cron path segment (e.g. `lead-sla`).

---

## 3. Supabase (database)

- **Status page:** https://status.supabase.com — check for a platform incident
  before assuming it's us.
- **Project dashboard:** Supabase → project → Database / Logs.
- Connection comes from `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- **Symptom: DB row on `/status` is rose, or every route 500s on a query.**
  Check Supabase project health (paused project? out of connections? disk
  full?) and the Supabase status page.
- Backup / restore is its own runbook: see `docs/BACKUP-RESTORE.md`.

---

## 4. Modal (agent runtime)

- **Dashboard:** https://modal.com — your workspace → Apps / Logs.
- The app talks to Modal via `MODAL_CHAT_URL` (interactive chat),
  `MODAL_WEBHOOK_URL` (autonomous run trigger used by `agent-sweep` and
  `routines`), and `MODAL_SWARM_URL`. Auth is a shared bearer
  (`AGENT_INTERNAL_SECRET`).
- **Symptom: chat hangs or agent never produces drafts.** Check Modal logs for
  the function, confirm the URLs/secret are set in Vercel env, and verify the
  Modal app is deployed and not erroring on cold start.
- The agent source lives under `agent/` in this repo.

---

## 5. Clerk (auth)

- **Status page:** https://status.clerk.com
- **Dashboard:** https://dashboard.clerk.com — the application for this env.
- Keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
- **Symptom: users can't sign in / every request 401s.** Check the Clerk status
  page and that the keys in Vercel match the Clerk environment (test vs. live
  keys are a classic mismatch after a config change).

---

## 6. Stripe (billing)

- **Status page:** https://status.stripe.com
- **Dashboard:** https://dashboard.stripe.com
- Keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.
- **Symptom: subscriptions not updating / webhooks failing.** Stripe Dashboard →
  Developers → Webhooks shows delivery attempts and failures. A signature
  failure usually means `STRIPE_WEBHOOK_SECRET` is stale.
- Note: subscription status (`active` / `trialing`) gates whether `agent-sweep`
  and `routines` run for a Space — a billing outage can quietly stop agent work
  for affected spaces.

---

## 7. The 10 crons — what each one does

All are `GET` handlers under `app/api/cron/**`, authenticated by
`Authorization: Bearer ${CRON_SECRET}`, scheduled in `vercel.json`, and wrapped
with `monitorCron()` from `lib/cron-monitor.ts` for Sentry dead-man monitoring.
Schedules are UTC.

| Cron | Schedule (UTC) | What it does | Disable switch |
| --- | --- | --- | --- |
| `lead-sla` | every 15 min | Speed-to-lead sweep: nudges the assigned realtor on un-worked routed leads, escalates cold leads to the broker. | — |
| `follow-up-reminders` | daily 09:00 | Emails/texts/pushes each realtor a digest of contacts whose follow-up is due. Day-locked against double-send. | — |
| `broker-weekly-report` | Mon 09:00 | Emails each active brokerage owner a weekly per-agent activity report. Day-locked. | — |
| `agent-sweep` | every 4 h | Triggers the Modal agent for active spaces to pre-stage `AgentDraft`s. Never sends outbound itself. | `CRON_SWEEP_DISABLED=1` |
| `routines` | hourly | Fires due `Routine`s through the Modal autonomous path. Never sends outbound itself. | `CRON_ROUTINES_DISABLED=1` |
| `draft-outcomes` | daily 03:00 | Labels sent drafts with a `deal_advanced` / `none` outcome signal. Read-mostly. | `CRON_OUTCOMES_DISABLED=1` |
| `sweep-paused-runs` | daily 04:00 | Expires stale `AgentPausedRun`s and hard-deletes rows >30 days. | `CRON_PAUSED_RUNS_DISABLED=true` |
| `cleanup` | daily 03:00 | Runs the Postgres `cleanup_agent_data()` batch GC (capped 1k rows/table/run). | — |
| `storage-gc` | daily 05:00 | Round-robins storage prefixes, deletes orphaned objects not referenced in the DB. | `CRON_STORAGE_GC_DISABLED=1` |
| `daily-briefing` | hourly | Generates + delivers each space's daily brief at the space's local brief hour. | `CRON_DAILY_BRIEFING_DISABLED=1` |

**If a cron is firing in Sentry:** read the tagged exception (`cron: <slug>`),
check Vercel Runtime Logs for that route, and if it's actively harmful, set the
job's disable switch above in Vercel env (where one exists) and redeploy — that
short-circuits the handler without removing the schedule.
