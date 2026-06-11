#!/usr/bin/env python3
"""Generate a layered system-architecture diagram for Chippi as an SVG.

Hand-built from a fresh read of the codebase (routes, lib, agent/, schema,
package.json, vercel.json) — not from the legacy docs.
"""
import html

W = 1760
PAD = 24
BAND_X = PAD
BAND_W = W - PAD * 2
HEADER_W = 196          # left header column inside each band
CHIP_H = 30
CHIP_GAP = 9
ROW_GAP = 9
FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

def esc(s): return html.escape(str(s))

def chip_w(text):
    return max(54, int(len(text) * 7.1) + 22)

class Canvas:
    def __init__(self):
        self.parts = []
        self.y = PAD
    def add(self, s): self.parts.append(s)

def draw_band(c, title, subtitle, items, fill, stroke, accent, chip_fill="#ffffff",
              chip_stroke=None, chip_text="#1f2430", title_color="#11151c"):
    """A horizontal band: left header + flowed chips. Returns its height."""
    chip_stroke = chip_stroke or stroke
    inner_x = BAND_X + HEADER_W + 16
    inner_w = BAND_W - HEADER_W - 16 - 18
    # layout chips
    rows = [[]]
    cur_x = 0
    for it in items:
        w = chip_w(it)
        if cur_x + w > inner_w and rows[-1]:
            rows.append([])
            cur_x = 0
        rows[-1].append((it, w))
        cur_x += w + CHIP_GAP
    n_rows = len(rows)
    inner_h = n_rows * CHIP_H + (n_rows - 1) * ROW_GAP
    band_h = max(inner_h + 26, 74)
    y0 = c.y
    # container
    c.add(f'<rect x="{BAND_X}" y="{y0}" width="{BAND_W}" height="{band_h}" rx="14" '
          f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    # accent bar
    c.add(f'<rect x="{BAND_X}" y="{y0}" width="6" height="{band_h}" rx="3" fill="{accent}"/>')
    # header
    hy = y0 + band_h / 2
    c.add(f'<text x="{BAND_X+22}" y="{hy-6}" font-family="{FONT}" font-size="17" '
          f'font-weight="700" fill="{title_color}">{esc(title)}</text>')
    if subtitle:
        c.add(f'<text x="{BAND_X+22}" y="{hy+13}" font-family="{FONT}" font-size="11.5" '
              f'fill="#6b7280">{esc(subtitle)}</text>')
    # chips
    cy = y0 + 13
    for row in rows:
        cx = inner_x
        for (it, w) in row:
            c.add(f'<rect x="{cx}" y="{cy}" width="{w}" height="{CHIP_H}" rx="8" '
                  f'fill="{chip_fill}" stroke="{chip_stroke}" stroke-width="1"/>')
            c.add(f'<text x="{cx+w/2}" y="{cy+CHIP_H/2+4.5}" font-family="{FONT}" '
                  f'font-size="12.5" fill="{chip_text}" text-anchor="middle">{esc(it)}</text>')
            cx += w + CHIP_GAP
        cy += CHIP_H + ROW_GAP
    c.y = y0 + band_h
    return band_h

def arrow(c, label):
    """A downward connector with a label between bands."""
    y0 = c.y
    cx = W / 2
    c.add(f'<line x1="{cx}" y1="{y0+4}" x2="{cx}" y2="{y0+26}" stroke="#9aa3b2" '
          f'stroke-width="2" marker-end="url(#arr)"/>')
    if label:
        tw = int(len(label) * 6.4) + 20
        c.add(f'<rect x="{cx+16}" y="{y0+6}" width="{tw}" height="20" rx="10" '
              f'fill="#eef1f6" stroke="#d4d9e2" stroke-width="1"/>')
        c.add(f'<text x="{cx+16+tw/2}" y="{y0+20}" font-family="{FONT}" font-size="11.5" '
              f'fill="#525a68" text-anchor="middle">{esc(label)}</text>')
    c.y = y0 + 32

c = Canvas()
parts_head = []

# ---- title block (drawn after we know height) ----
c.y = PAD + 70

# 1. Surfaces
draw_band(c, "Surfaces", "browser + MCP clients", [
    "Marketing site (logged-out)", "Clerk auth · realtor/broker login",
    "Realtor workspace  /s/[slug]", "Broker dashboard  /broker",
    "Platform admin  /admin", "Public intake  /apply (form + AI chat)",
    "Tour booking  /book", "Link-in-bio  /p/[slug]",
    "Tokenized  /cma /packet /tour", "Applicant portal  /clients (own session)",
    "Demo app  /demo-app", "MCP clients → claude.ai",
], fill="#f3f7ff", stroke="#cdd9f0", accent="#3b6fd4", chip_fill="#ffffff", chip_stroke="#d4e0f5")
arrow(c, "HTTPS")

# 2. Edge / middleware
draw_band(c, "Edge", "middleware.ts", [
    "Clerk session", "Route protection (/s /broker /admin /setup …)",
    "Public allowlist (/apply /book /p /api/public /webhooks /mcp)",
    "Ban / suspend check", "Safe redirect allowlist", "Client-portal bypass",
], fill="#fff8f0", stroke="#f3dcc0", accent="#ff964f", chip_fill="#ffffff", chip_stroke="#f0ddc4")
arrow(c, "")

# 3. API
draw_band(c, "Next.js API", "312 endpoints (App Router)", [
    "ai · agent  (chat + autonomous, 50+)", "swarm", "contacts", "deals", "stages",
    "pipelines", "tours", "properties", "calendar", "studio", "broker (44)",
    "brokerages", "billing", "integrations", "clients", "applications", "calls",
    "whatsapp", "email", "esign", "cma", "packet", "documents · files", "notes",
    "routines", "custom-agents", "vectorize", "search", "mcp · mcp-keys",
    "account", "push", "affiliate", "support", "webhooks", "cron", "inngest", "public",
], fill="#f6f8fb", stroke="#d8dee8", accent="#5566aa", chip_fill="#ffffff", chip_stroke="#e0e5ee")
arrow(c, "")

# 4. Core services (lib)
draw_band(c, "Core services", "lib/*", [
    "lead-scoring (deterministic engine · gpt-4.1-mini summaries)", "notify · email · sms · tour-emails",
    "permissions · api-auth  (offboarding gate)", "embeddings · vectorize · zilliz (pgvector)",
    "brokerage-routing", "commissions", "brokerage-seats", "billing (Stripe)",
    "storage (Wasabi)", "usage · ledger", "briefing", "calendar", "studio · publish",
    "integrations", "inngest functions",
], fill="#f6f8fb", stroke="#d8dee8", accent="#5566aa", chip_fill="#ffffff", chip_stroke="#e0e5ee")
arrow(c, "")

# 5a. Agent runtime — the product heart
draw_band(c, "Chippi runtime", "the product · lib/ai-tools (TS, default)", [
    "runtime-flag  CHIPPI_CHAT_RUNTIME=ts", "@openai/agents in-process loop",
    "registry · 55 tools", "approval-gated mutations (SSE permission_required)",
    "execute · rate-limit · zod", "skills / sub-agents  (delegate_task)",
    "context-enrichment", "system-prompt (+ personalized)", "persistence → Message.blocks",
    "per-workspace model (OpenRouter-first)",
], fill="#fff4ea", stroke="#f6cfa6", accent="#ff7a1a", chip_fill="#ffffff", chip_stroke="#f6d9bf")
arrow(c, "delegate_task / autonomous → Modal")

# 5b. Modal + triggers
draw_band(c, "Modal sandbox", "agent/* (Python, autonomous + swarm)", [
    "modal_app.py  chat_turn / run_now / swarm", "orchestrator  (budget · run-lock · memory)",
    "chippi.py + modules · 53 tools", "chippi_broker.py  (chief-of-staff)",
    "swarm_orchestrator  (wave decomposition)", "curated Composio tools (≤100)",
    "trigger flow: fireAgentTrigger → Redis queue → webhook",
    "10 Vercel crons: sweep · sla · routines · briefing · outcomes · gc …",
], fill="#fff4ea", stroke="#f6cfa6", accent="#ff7a1a", chip_fill="#ffffff", chip_stroke="#f6d9bf")
arrow(c, "")

# 6. Data stores
draw_band(c, "Data stores", "source of truth", [
    "Supabase Postgres · 99 tables · 147 migrations",
    "User · Space · SpaceSetting · Brokerage · Membership",
    "Contact · Deal · DealStage · Tour · Property",
    "Conversation · Message · BrokerConversation · BrokerMessage",
    "Invitation · AuditLog · BrokerNotification · Attachment",
    "RPC: match_documents · reorder_deal",
    "pgvector  DocumentEmbedding (hybrid BM25 + cosine RRF)",
    "Upstash Redis: trigger queue · dedupe · rate-limit · run-lock · pending-approval · slug cache",
], fill="#eef7f1", stroke="#c9e3d3", accent="#2f9e6b", chip_fill="#ffffff", chip_stroke="#d4e8dc")
arrow(c, "")

# 7. External services
draw_band(c, "External", "3rd-party services", [
    "Clerk (auth)", "OpenAI (scoring · embeddings · Agents SDK)", "OpenRouter (chat models)",
    "Modal (agent sandbox)", "fal.ai (Studio gen)", "Resend (email)",
    "Telnyx (SMS · voice)", "Stripe (billing · 3 tiers)", "Google Calendar (OAuth)",
    "Composio (toolkits → agent tools)", "Wasabi (S3 files)", "Web Push (VAPID)",
    "Sentry (observability)", "Inngest (workflows)", "FirstPromoter (affiliate)",
], fill="#f4f0fb", stroke="#ddd0f0", accent="#7e57c2", chip_fill="#ffffff", chip_stroke="#e4d8f3")

total_h = c.y + PAD

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{total_h}" '
           f'viewBox="0 0 {W} {total_h}" font-family="{FONT}">')
svg.append('<defs>'
           '<marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" '
           'markerHeight="7" orient="auto-start-reverse">'
           '<path d="M0,0 L10,5 L0,10 z" fill="#9aa3b2"/></marker></defs>')
svg.append(f'<rect x="0" y="0" width="{W}" height="{total_h}" fill="#fbfcfe"/>')
# title
svg.append(f'<text x="{PAD+2}" y="{PAD+30}" font-family="{FONT}" font-size="26" '
           f'font-weight="800" fill="#11151c">Chippi — System Architecture</text>')
svg.append(f'<text x="{PAD+2}" y="{PAD+52}" font-family="{FONT}" font-size="13.5" '
           f'fill="#6b7280">Agentic OS for realtors &amp; brokerages · Next.js 15 / React 19 · '
           f'Supabase · Clerk · dual agent runtime (TS in-process + Modal Python) · '
           f'mapped from source, {esc("2026-06")}</text>')
svg.extend(c.parts)
svg.append('</svg>')

out = "/home/user/realestatecrm/docs/architecture-diagram.svg"
with open(out, "w") as f:
    f.write("\n".join(svg))
print("wrote", out, "h=", total_h)
