# PRODUCT_SCOPE.md

What Koala is, who it serves, and the guardrails that keep new work on-product.

Current as of 2026-05. Read alongside `AGENTS.md` §1–2 (the canonical definition) and `ROADMAP.md` (what's being built now). If this file disagrees with `AGENTS.md`, `AGENTS.md` wins.

---

## 1. What Koala is

Koala is an **agentic operating system for sales teams.**

A rep's pipeline — contacts, leads, deals, demos, products, qualification forms — is the workspace. **Axil**, Koala's AI agent, works *inside* that workspace on the rep's behalf: it qualifies inbound leads, drafts and sends follow-up, schedules demos, advances deals, places and reviews calls, and surfaces what needs attention — taking sign-off only where a human decision is genuinely required.

**The product is the agent.** The CRM-style data structures underneath it — contacts, deals, pipelines — are *substrate, not the product*. Koala is not a database the rep maintains; it is an operator that maintains it for them. It runs two ways:

- **On request** — the rep talks to Axil in chat; it does the job and reports back.
- **On its own** — workspace events (new lead, qualification form submitted, demo completed, deal stage change, inbound message) and scheduled sweeps wake Axil to act in near real-time, without being asked.

Two principles follow, and they govern every scope decision:

1. **New work should make Axil do more on the user's behalf** — not add a surface the user operates themselves.
2. **A configuration screen is a last resort.** "We'll add a setting" usually means the agent didn't do its job. Decide it, or teach the agent to.

---

## 2. Who it serves

- **Solo and independent reps** — SDRs and AEs whose pipeline Koala runs end to end.
- **Teams** — manager owners and admins oversee a team of reps: lead routing, commissions, deal review, call review, coaching, performance. The team tier is *part of one product*, not a separate one — an operating system for sales spans the individual rep and the team they belong to.
- **Manager-only users** — oversee a team without running a personal lead workspace.

---

## 3. The launch wedge — the way in, not the ceiling

The product is broad. The **go-to-market entry point is deliberately narrow.** The wedge is how Koala lands a first user and proves itself fast; it is not a cap on what Koala is.

- **Who**: new SDRs/AEs and small sales teams
- **What**: inbound lead qualification and routing
- **Why this wedge**: it's the shortest path to a rep *feeling* the agent do real work — minimal setup, one shareable intake link, an explainable score, follow-up that happens without being asked
- **Activation event**: intake link generated
- **Retention signal**: qualified leads flowing in, and the rep returning to act on what Axil surfaced

"Protect the wedge" means: keep the **first-run experience** fast and unsprawled — sign-up to live intake link stays minimal. It does **not** mean the product stops at inbound lead qualification. Depth elsewhere is welcome; friction on a new rep's path to first value is not.

---

## 4. What Koala does today

A capability snapshot — categorical, not exhaustive. For the live surface map see `ARCHITECTURE.md` and `README.md`.

- **Autonomous agent** — chat plus event-triggered background runs; tool-use across the whole workspace; every mutation is approval-gated; Axil drafts, it never sends silently
- **Public intake** — branded, customizable, conversational lead qualification pages
- **Explainable lead scoring** — every lead gets a score, a hot/warm/cold label, and a plain-language reason
- **Lead → contact → deal pipeline** — the CRM substrate, with customizable stages
- **Demos** — scheduling, public booking pages, calendar sync, reminders, post-demo feedback
- **Products** — offerings and shareable sales packets / product one-pagers
- **Calling + transcription** — click-to-call and call logging over Twilio, with recordings and transcripts surfaced on the call log and fed to Axil for coaching
- **Axil coaching & practice** — mock sales calls against configurable ICPs (Ideal Customer Profiles): Axil roleplays the prospect, then scores the rep on discovery, objection handling, value articulation, closing, and talk ratio with concrete feedback
- **Team tier** — team roster, invitations, lead routing, commission ledger, deal review, leaderboards, audit log
- **Studio** — AI image and video generation, brand kit, social-post composer, scheduling and publishing
- **Integrations** — connected toolkits (Gmail, HubSpot, Slack, Google Calendar) become agent tools; Koala is also exposed as an MCP server
- **Notifications** — email and SMS for leads, demos, deals, follow-ups
- **Analytics** — pipeline, leads, demos, form traffic, team performance
- **Files & documents** — uploads and an in-app document editor
- **Billing** — per-seat team subscriptions are in place; usage-based agent metering is in progress (see `ROADMAP.md`)

---

## 5. Scope guardrails — on-product vs. off-product

Earlier versions of this file kept a list of *forbidden features*. Feature lists rot — several "out of scope" items (team accounts, SMS, marketing tools) shipped, and the doc went stale and started misdirecting. Judge new work by **principle** instead.

**On-product** — the change:

- makes the agent do more of the rep's work, or do it better
- removes a step the human currently does by hand
- deepens a surface that already exists

**Off-product** — the change:

- adds a setting, toggle, or config surface the rep must operate themselves — the agent should decide, or learn the preference
- expands toward generic all-in-one CRM breadth that doesn't route through the agent
- ships AI output that isn't explainable or actionable
- adds friction to the sign-up → live intake link path

The test, when unsure: *does this make Axil more of an operator, or more of a tool the rep operates?* Operator wins.

Note for AI coding agents: this section describes *product* scope. It does not loosen `AGENTS.md` §3 and §8 — you still never build a feature without explicit instruction, on-product or not.

---

## 6. Anti-goals

1. Don't drift toward a generic CRM dashboard the rep babysits. The agent does the work.
2. Don't ship "AI magic" without explainability — every AI output is practical and transparent.
3. Don't add setup friction. First-run stays minimal.
4. Don't solve with a setting what the agent could decide or learn.
5. Don't optimize vanity metrics (sign-ups, page views) over activation (intake link generated, qualified leads received, agent actions taken).
6. Don't let breadth degrade the wedge's first-run experience.

---

## 7. What success looks like

- **Setup**: sign-up to live intake link in minutes, not a configuration project
- **Activation**: intake link generated
- **The agent earns trust**: Axil takes real actions — scored leads, drafted follow-up, booked demos — and the rep sees and approves them
- **Retention**: the rep returns to act on what Axil surfaced, and lets it do more over time
- **Team**: managers run team oversight — routing, commissions, review, coaching — through Koala rather than spreadsheets
