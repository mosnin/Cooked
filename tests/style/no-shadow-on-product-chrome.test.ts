/**
 * STYLESHEET enforcement — paper-flat is the rule.
 *
 * `shadow-*` is forbidden on product chrome. The redesign deliberately
 * removed shadows from buttons, inputs, cards, and outline buttons in
 * favour of hairline borders. Marketing pages (`app/features/*`,
 * `components/ui/hero-section-1.tsx`, etc.) are allowed shadows; the
 * product is not.
 *
 * Scope discipline. Strict enforcement on a directory is irreversible
 * once it's in CI — every future contributor pays the cost. So we
 * graduate directories into the strict zone one at a time as we
 * audit + clean them. The non-strict directories get a per-test
 * inventory (`STRICT_DIRS_TODO`) so the migration backlog is visible
 * but doesn't fail CI today.
 *
 * Phase 1 (this commit): only `components/onboarding` is in the strict
 * zone. Subsequent phases promote `components/agent`, then
 * `components/chippi`, then the per-area dirs.
 *
 * Why a vitest test, not an ESLint rule. A focused fixture is faster
 * to maintain, runs in the same CI as everything else, and produces a
 * specific file:line error with the path to STYLESHEET.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Directories the lint STRICTLY enforces on. Adding a directory here
 * is a one-way door — every shadow on every file in that dir must be
 * allowlisted or removed before this list grows.
 */
const STRICT_DIRS = [
  'components/onboarding',
  // Phase 5: promoted after audit. agent/ had zero shadows; chippi/ had
  // shadows only in the docked floating composer (allowlisted below).
  // These are the two most brand-heavy dirs — locking them paper-flat
  // is the highest-value strict promotion.
  'components/agent',
  'components/chippi',
];

/**
 * Directories with known shadow debt the migration hasn't reached yet.
 * Kept here so the size of the backlog is visible — not enforced.
 * Each promoted to STRICT_DIRS once audited (allowlist the legit
 * floating surfaces, fix the real violations).
 */
const STRICT_DIRS_TODO = [
  'components/contacts',  // mix of legitimate modals + a few real violations
  'components/deals',     // kanban drag overlays legitimate; segmented-control violations real
  'components/dashboard', // sidebar / header popovers — legitimate; needs allowlist
  'components/settings',
  'app/s',
  'app/broker',
];

/**
 * Files explicitly allowed to use `shadow-*`. Each entry needs a
 * one-line WHY comment so the next reviewer understands the
 * exemption. STYLESHEET.md §Shadows has the four sanctioned cases at
 * the system level; this list extends them for legitimate
 * hand-rolled-floating-surface cases.
 */
const SHADOW_ALLOWLIST = new Set<string>([
  // Toast — floats above the page; without lift it reads as a banner.
  'components/ui/sonner.tsx',
  // Dialog / AlertDialog — modal elevation.
  'components/ui/dialog.tsx',
  'components/ui/alert-dialog.tsx',
  // Chart tooltips — hover surfaces over data; need clear separation.
  'components/ui/chart.tsx',
  // The docked Chippi composer/bar — a floating surface over page
  // content (backdrop-blur + lift), same class as a toast/dialog.
  // The floating mic pill and recording state share the lift.
  'components/chippi/chippi-bar.tsx',
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

// Match `shadow-*` Tailwind utilities. Skips `shadow-none` (legal).
// The hyphen suffix is required so we don't match `shadowfoo` token IDs.
const SHADOW_RE = /(?<![\w-])shadow-(?!none\b)(sm|md|lg|xl|2xl|inner|\[)/g;

interface Violation {
  file: string;
  line: number;
  match: string;
}

function scanForShadows(file: string): Violation[] {
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  const out: Violation[] = [];
  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    SHADOW_RE.lastIndex = 0;
    while ((m = SHADOW_RE.exec(line)) !== null) {
      out.push({ file, line: idx + 1, match: m[0] });
    }
  });
  return out;
}

describe('STYLESHEET enforcement — paper-flat product chrome', () => {
  it('no shadow class appears in STRICT_DIRS outside the allowlist', () => {
    const allFiles: string[] = [];
    for (const dir of STRICT_DIRS) {
      allFiles.push(...collectFiles(join(ROOT, dir)));
    }
    const violations: Violation[] = [];
    for (const file of allFiles) {
      const rel = relative(ROOT, file);
      if (SHADOW_ALLOWLIST.has(rel)) continue;
      violations.push(...scanForShadows(file));
    }

    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 25)
        .map((v) => `  ${relative(ROOT, v.file)}:${v.line}  →  ${v.match}`)
        .join('\n');
      const extra = violations.length > 25 ? `\n  …+${violations.length - 25} more` : '';
      throw new Error(
        `Paper-flat is the rule (see STYLESHEET.md §Shadows).\n` +
        `${violations.length} shadow violation(s) on STRICT product chrome:\n\n` +
        `${formatted}${extra}\n\n` +
        `Use a hairline border (border-border/60 or /70) or a ring on\n` +
        `selected state instead. The legitimate-floating-surface\n` +
        `allowlist is in SHADOW_ALLOWLIST at the head of this file.\n`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
