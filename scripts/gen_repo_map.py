#!/usr/bin/env python3
"""Generate docs/repo-map.generated.md — the structural spine of the repo.

Everything here is DERIVED from source (the route tree, vercel.json, schema.sql,
the two agent tool catalogs, package.json). Nothing is hand-typed, so it cannot
drift from reality the way prose docs do. Output is deterministic (sorted, no
timestamps) so a CI staleness gate can `git diff --exit-code` it.

Run:  python3 scripts/gen_repo_map.py
Check (CI): regenerate, then fail if the working tree changed.

This file maps STRUCTURE (what exists, where). The judgment layer — what each
system is for and where it's fragile — lives in the hand-written SYSTEMS.md /
SEAMS.md (not generated).
"""
import json
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rel(p):
    return os.path.relpath(p, ROOT)


# ---------------------------------------------------------------------------
# Route tree (pages + API) from the App Router filesystem
# ---------------------------------------------------------------------------
def route_from_dir(dirpath):
    """app/(marketing)/pricing -> /pricing ; app/s/[slug]/deals -> /s/[slug]/deals"""
    parts = rel(dirpath).split(os.sep)
    assert parts[0] == "app", parts
    segs = [s for s in parts[1:] if not (s.startswith("(") and s.endswith(")"))]
    return "/" + "/".join(segs) if segs else "/"


def collect_pages():
    pages = set()
    for f in glob.glob(os.path.join(ROOT, "app", "**", "page.tsx"), recursive=True):
        pages.add(route_from_dir(os.path.dirname(f)))
    return sorted(pages)


def collect_api():
    routes = set()
    for f in glob.glob(os.path.join(ROOT, "app", "api", "**", "route.ts"), recursive=True):
        routes.add(route_from_dir(os.path.dirname(f)))
    return sorted(routes)


def top_segment(route, prefix=""):
    body = route[len(prefix):].lstrip("/") if prefix else route.lstrip("/")
    return body.split("/")[0] if body else "/"


# ---------------------------------------------------------------------------
# Crons (vercel.json)
# ---------------------------------------------------------------------------
def collect_crons():
    with open(os.path.join(ROOT, "vercel.json")) as fh:
        data = json.load(fh)
    return sorted(((c["path"], c["schedule"]) for c in data.get("crons", [])))


# ---------------------------------------------------------------------------
# Data model (schema.sql + migrations)
# ---------------------------------------------------------------------------
def collect_schema():
    # schema.sql is the base, but ~half the tables exist only in migrations.
    # Union both so the table/RPC list is the real universe, not just the seed.
    files = [os.path.join(ROOT, "supabase", "schema.sql")]
    mig_paths = sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql")))
    files += mig_paths
    tables, rpcs = set(), set()
    for f in files:
        with open(f) as fh:
            sql = fh.read()
        tables.update(re.findall(r'CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([A-Za-z]+)"', sql))
        rpcs.update(re.findall(r"CREATE OR REPLACE FUNCTION ([a-z_]+)", sql))
    migs = sorted(os.path.basename(p) for p in mig_paths)
    return sorted(tables), sorted(rpcs), migs


# ---------------------------------------------------------------------------
# Agent tool catalogs — the two hand-maintained surfaces that drift apart
# ---------------------------------------------------------------------------
def collect_ts_tools():
    """First `name: '...'` in each lib/ai-tools/tools/*.ts (excl index.ts)."""
    names = []
    for f in sorted(glob.glob(os.path.join(ROOT, "lib", "ai-tools", "tools", "*.ts"))):
        if os.path.basename(f) == "index.ts":
            continue
        with open(f) as fh:
            m = re.search(r"name:\s*'([a-z_]+)'", fh.read())
        if m:
            names.append(m.group(1))
    # how many are actually wired into the ALL_TOOLS registry array
    with open(os.path.join(ROOT, "lib", "ai-tools", "tools", "index.ts")) as fh:
        idx = fh.read()
    block = re.search(r"ALL_TOOLS[^=]*=\s*\[(.*?)\];", idx, re.S)
    wired = len(re.findall(r"as ToolDefinition", block.group(1))) if block else 0
    return sorted(set(names)), wired


def collect_py_tools():
    """Function name on the `def` line following each real @function_tool decorator.

    Skips test files, `base.py` (decorator infra + docstring examples), and
    `_`-prefixed files/names (private helpers). Requires the decorator at line
    start so docstring prose like "apply INSIDE @function_tool" isn't counted.
    """
    names = []
    for f in sorted(glob.glob(os.path.join(ROOT, "agent", "**", "*.py"), recursive=True)):
        base = os.path.basename(f)
        if "tests" in rel(f).split(os.sep) or base.startswith(("_", "test_")) or base == "base.py":
            continue
        with open(f) as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            if not line.lstrip().startswith("@function_tool"):
                continue
            for j in range(i + 1, min(i + 4, len(lines))):
                m = re.match(r"\s*(?:async\s+)?def\s+([a-z][a-z_]*)\(", lines[j])
                if m:
                    names.append(m.group(1))
                    break
    return sorted(set(names))


# ---------------------------------------------------------------------------
# External services (curated from dependencies)
# ---------------------------------------------------------------------------
SERVICE_MAP = {
    "@clerk/nextjs": "Clerk — auth / sessions",
    "@supabase/supabase-js": "Supabase — Postgres + pgvector",
    "@upstash/redis": "Upstash Redis — queue / dedupe / locks / cache",
    "openai": "OpenAI — scoring, embeddings, Agents SDK",
    "@openai/agents": "OpenAI Agents SDK — TS chat runtime",
    "@composio/core": "Composio — integration toolkits → agent tools",
    "stripe": "Stripe — billing",
    "resend": "Resend — email",
    "telnyx": "Telnyx — SMS + voice",
    "svix": "Svix — webhook signature verification",
    "@sentry/nextjs": "Sentry — error monitoring",
    "@vercel/analytics": "Vercel Analytics",
    "inngest": "Inngest — durable workflows",
}


def collect_services():
    with open(os.path.join(ROOT, "package.json")) as fh:
        deps = json.load(fh).get("dependencies", {})
    found = [(SERVICE_MAP[d], d) for d in deps if d in SERVICE_MAP]
    # services that live in env/agent, not as a JS dep
    extra = [
        ("Modal — Python agent sandbox (agent/modal_app.py)", "MODAL_*"),
        ("fal.ai — Studio image/video generation", "FAL_KEY"),
        ("Google Calendar — OAuth tour sync", "GOOGLE_CLIENT_*"),
        ("Wasabi — S3-compatible file storage", "WASABI_*"),
        ("Web Push (VAPID) — browser notifications", "VAPID_*"),
        ("FirstPromoter — affiliate tracking", "FIRST_PROMOTER_*"),
    ]
    return sorted(found) + sorted(extra)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
def grouped(routes, prefix=""):
    out = {}
    for r in routes:
        out.setdefault(top_segment(r, prefix), []).append(r)
    return out


def main():
    pages = collect_pages()
    api = collect_api()
    crons = collect_crons()
    tables, rpcs, migs = collect_schema()
    ts_tools, ts_wired = collect_ts_tools()
    py_tools = collect_py_tools()
    services = collect_services()
    webhooks = sorted(r for r in api if r.startswith("/api/webhooks/"))

    L = []
    w = L.append
    w("# Repo Map (generated)")
    w("")
    w("> **Do not edit by hand.** Regenerate with `python3 scripts/gen_repo_map.py`.")
    w("> Derived from the source tree, `vercel.json`, `supabase/schema.sql`, and the")
    w("> two agent tool catalogs. CI fails if this file is stale. The *meaning* of each")
    w("> system (purpose, fragile seams) lives in `SYSTEMS.md` / `SEAMS.md`, not here.")
    w("")
    w("## At a glance")
    w("")
    w(f"- **Page routes:** {len(pages)}")
    w(f"- **API endpoints:** {len(api)}")
    w(f"- **Cron jobs:** {len(crons)}")
    w(f"- **DB tables:** {len(tables)}  ·  **RPCs:** {len(rpcs)}  ·  **migrations:** {len(migs)}")
    w(f"- **Agent tools — TS (lib/ai-tools):** {len(ts_tools)} declared, {ts_wired} wired into `ALL_TOOLS`")
    w(f"- **Agent tools — Python (agent/):** {len(py_tools)} declared")
    w("")

    # ---- Pages ----
    w("## Page routes (Surfaces)")
    w("")
    for seg, rs in sorted(grouped(pages).items()):
        label = seg if seg != "/" else "(root)"
        w(f"**{label}** ({len(rs)})")
        w("")
        for r in rs:
            w(f"- `{r}`")
        w("")

    # ---- API ----
    w("## API endpoints")
    w("")
    api_groups = grouped(api, prefix="/api")
    for seg, rs in sorted(api_groups.items()):
        w(f"**/api/{seg}** ({len(rs)})")
        w("")
        for r in rs:
            w(f"- `{r}`")
        w("")

    # ---- Crons ----
    w("## Cron jobs (vercel.json)")
    w("")
    w("| Path | Schedule |")
    w("|------|----------|")
    for path, sched in crons:
        w(f"| `{path}` | `{sched}` |")
    w("")

    # ---- Webhooks ----
    w("## Inbound webhooks")
    w("")
    for r in webhooks:
        w(f"- `{r}`")
    w("")

    # ---- Agent tool catalogs ----
    w("## Agent tool catalogs")
    w("")
    w("Two hand-maintained catalogs. A new agent verb must be added in **both** or")
    w("the runtimes diverge — this table makes the drift visible.")
    w("")
    only_ts = sorted(set(ts_tools) - set(py_tools))
    only_py = sorted(set(py_tools) - set(ts_tools))
    both = sorted(set(ts_tools) & set(py_tools))
    w(f"- **In both runtimes ({len(both)}):** {', '.join(f'`{t}`' for t in both) or '—'}")
    w("")
    w(f"- **TS only ({len(only_ts)}):** {', '.join(f'`{t}`' for t in only_ts) or '—'}")
    w("")
    w(f"- **Python only ({len(only_py)}):** {', '.join(f'`{t}`' for t in only_py) or '—'}")
    w("")

    # ---- Data model ----
    w("## Data model (supabase/schema.sql)")
    w("")
    w(f"**Tables ({len(tables)}):** {', '.join(f'`{t}`' for t in tables)}")
    w("")
    w(f"**RPCs ({len(rpcs)}):** {', '.join(f'`{r}`' for r in rpcs)}")
    w("")
    w(f"**Migrations:** {len(migs)} (latest: `{migs[-1]}`)" if migs else "**Migrations:** 0")
    w("")

    # ---- External services ----
    w("## External services")
    w("")
    for desc, key in services:
        w(f"- {desc}  (`{key}`)")
    w("")

    out = os.path.join(ROOT, "docs", "repo-map.generated.md")
    with open(out, "w") as fh:
        fh.write("\n".join(L).rstrip() + "\n")
    print("wrote", rel(out))


if __name__ == "__main__":
    main()
