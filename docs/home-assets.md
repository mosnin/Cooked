# Homepage assets — drop-in spec

The homepage (`app/(marketing)/page.tsx`) is built. Every visual slot is
waiting on a real asset. Drop files into `public/marketing/home/` with the
exact filenames below (or paste URLs in chat) and I wire + frame each one,
then you screenshot and I fix against real pixels.

Apple-grade = real product, shot clean. No grey boxes, no fake names.

## Priority 1 — the hero (the whole first impression)

| File | Spec | Notes |
|---|---|---|
| `hero.mp4` | 1920×1080, H.264, silent, 8–18s seamless loop, ≤8 MB | The product in motion. You said you'd send the link — drop it here or paste the URL. |
| `hero.webm` | same, VP9 | optional, smaller/sharper |
| `hero-poster.jpg` | 1920×1080 | first frame, shown before the video loads |

## Priority 2 — the 5 core cards (the heart of the page)

Real product screenshots, **1600×1000 (16:10), PNG, shot at 2×, light UI,
PII scrubbed**:

| File | Surface |
|---|---|
| `card-inbox.png` | inbox triage — Chippi surfacing the one to read first |
| `card-draft.png` | Chippi drafting a reply in your voice |
| `card-leads.png` | lead scoring / people |
| `card-calendar.png` | tour booking on the calendar |
| `card-pipeline.png` | the deal pipeline board |

## Priority 3 — deep features + logos

| File | Spec |
|---|---|
| `workspace.png` | 1600×1200 (4:3) — the workspace overview |
| `logo-*.svg` | monochrome SVGs of what Chippi connects to (Gmail, Outlook, Google Calendar, …) or real brokerage logos you have rights to |

## Recommend CUT for launch (so you don't fake them)

- **Testimonials** — only ship with real quotes + names. Otherwise it's the
  single most obvious "fake startup" tell. Cut until you have 3 real ones.
- **Blog teaser** — cut until real posts exist.
- **Stats band** — confirm `24/7 · 0 cold leads · <1 min first-touch` are
  claims you can stand behind, or give me real numbers.

Trimming these two sections makes the page shorter, denser, and more
Apple — fewer, perfect moments instead of ten thin ones.
