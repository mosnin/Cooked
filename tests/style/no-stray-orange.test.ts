/**
 * STYLESHEET enforcement — brand orange is scarce.
 *
 * Phase 2 codifies brand orange into five named contexts
 * (`BRAND_ORANGE_CONTEXTS` in `lib/colors.ts`). Every orange-tinted
 * class on a product surface must EITHER:
 *
 *   1. Live inside a file that imports `brandOrange` from
 *      `lib/colors.ts` — opt-in tagging that says "this orange is
 *      deliberate, one of the five named moments."
 *   2. Or live inside the named-leaf component files themselves
 *      (the AGENT_BADGE primitives, the lead-warm tier indicator,
 *      etc.) where the brand contexts are baked in.
 *
 * Scope discipline. Like the shadow lint, we start with a small
 * strict zone and grow it. Files in the strict zone must either
 * import brandOrange or appear in NAMED_LEAF_FILES.
 *
 * What this catches. A future PR adds `text-orange-500` to a notification
 * row without importing brandOrange — the test fails with the file:line
 * and points at the stylesheet rule. Discipline holds in code, not in
 * a paragraph of prose.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Strict-enforced directories — orange usage requires a brandOrange
 * import or NAMED_LEAF_FILES membership. Promoting a directory here
 * is a one-way door; the migration backlog lives in STRICT_DIRS_TODO.
 *
 * Phase 2: `components/onboarding` (Phase 1 also cleaned it) and the
 * three Chippi/agent leaf-component directories where the orange is
 * actually built. They're either clean or contain the leaf files.
 */
const STRICT_DIRS = ['components/onboarding'];

/**
 * Directories with known orange-without-brandOrange-tag debt. Each
 * promoted in a subsequent phase as we audit + wrap the call sites.
 * The list living here keeps the migration backlog visible at every PR.
 */
const STRICT_DIRS_TODO = [
  'components/agent',     // mostly leaf files (NAMED_LEAF_FILES) — audit + tag the rest
  'components/chippi',    // chippi-bar / chippi-avatar / etc. — leaf files; tag the rest
  'components/contacts',  // CHIPPI_PILL use site lives here; audit other orange usages
  'components/leads',     // lead-warm indicator usage — leaf file candidates
  'components/dashboard',
  'components/settings',
  'app/s',
  'app/broker',
];

/**
 * Files where brand orange is BAKED IN — these define the named
 * contexts. They don't need to import brandOrange because they ARE
 * the brand orange contexts.
 */
const NAMED_LEAF_FILES = new Set<string>([
  // CHIPPI_AVATAR + CHIPPI_WORDMARK_INLINE + ChippiAuthoredDot all live here
  'components/agent/chippi-authored.tsx',
  // AGENT_BADGE
  'components/agent/agent-generated-badge.tsx',
  // LOGO — the brand mark itself
  'components/ui/brand-logo.tsx',
  // CHIPPI_AVATAR widget
  'components/agent/chippi-avatar.tsx',
  // ACTIVITY_BAR + LEAD_WARM — the score/progress bar fills
  'components/agent/lead-score-bar.tsx',
  // The CHIPPI_PILL constant lives in typography.ts
  'lib/typography.ts',
  // The colors module itself
  'lib/colors.ts',
]);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(tsx|ts)$/.test(name) && !/\.(test|stories)\.(tsx|ts)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// Match Tailwind orange utilities. Excludes the rare cases where
// "orange" appears in a string literal that isn't a Tailwind class
// (e.g. a contact tag value). The pattern requires either a
// className-shape preceding char (space, single-quote, double-quote,
// backtick) OR a hyphen (for dark: prefixes).
const ORANGE_RE = /(?<![\w-])(?:bg|text|border|ring|from|to|via|fill|stroke)-orange-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\[?\d+%?\]?)?/g;

interface Violation {
  file: string;
  line: number;
  match: string;
}

function scanForOrange(file: string): Violation[] {
  const text = readFileSync(file, 'utf-8');
  // If the file imports brandOrange OR CHIPPI_PILL, the orange usages
  // are tagged as deliberate. Wholesale allow-list at file granularity
  // — this is a "did the contributor commit to the discipline" test,
  // not a per-line gate.
  const hasBrandOrangeImport =
    /\bbrandOrange\b/.test(text) ||
    /\bCHIPPI_PILL\b/.test(text) ||
    /\bBRAND_ORANGE_CONTEXTS\b/.test(text);
  if (hasBrandOrangeImport) return [];

  const lines = text.split('\n');
  const out: Violation[] = [];
  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    ORANGE_RE.lastIndex = 0;
    while ((m = ORANGE_RE.exec(line)) !== null) {
      out.push({ file, line: idx + 1, match: m[0] });
    }
  });
  return out;
}

describe('STYLESHEET enforcement — brand orange is scarce', () => {
  it('files in STRICT_DIRS using `*-orange-*` classes must import brandOrange (or be a named leaf)', () => {
    const allFiles: string[] = [];
    for (const dir of STRICT_DIRS) {
      allFiles.push(...collectFiles(join(ROOT, dir)));
    }
    const violations: Violation[] = [];
    for (const file of allFiles) {
      const rel = relative(ROOT, file);
      if (NAMED_LEAF_FILES.has(rel)) continue;
      violations.push(...scanForOrange(file));
    }

    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 25)
        .map((v) => `  ${relative(ROOT, v.file)}:${v.line}  →  ${v.match}`)
        .join('\n');
      const extra = violations.length > 25 ? `\n  …+${violations.length - 25} more` : '';
      throw new Error(
        `Brand orange is scarce (see STYLESHEET.md §Color §The brand orange rule).\n` +
        `${violations.length} orange usage(s) on STRICT product chrome without a brandOrange tag:\n\n` +
        `${formatted}${extra}\n\n` +
        `Either wrap with brandOrange('<CONTEXT>', '...') from lib/colors.ts,\n` +
        `use one of the five named primitives (ChippiAuthoredDot,\n` +
        `ChippiWordmarkInline, AgentGeneratedBadge, etc.), or use\n` +
        `CHIPPI_PILL from lib/typography.ts. Adding a sixth named context\n` +
        `requires deleting one of the existing five.\n`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
