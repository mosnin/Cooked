#!/usr/bin/env node
/**
 * Verify every slug in `CURATED_TRIGGERS` exists in Composio's
 * published catalog.
 *
 * Source of truth: composio.dev/toolkits/<toolkit>.md ships a markdown
 * mirror of each toolkit's HTML page. The "Supported Triggers" section
 * is a table of slugs in backticks — the same slugs the SDK's
 * `composio.triggers.listTypes()` would return.
 *
 * Why this exists: adding a slug to CURATED_TRIGGERS that doesn't
 * exist at Composio fails SILENTLY at OAuth-completion time —
 * createTrigger throws, we record `status='failed'` on a fresh
 * IntegrationTrigger row, the realtor sees the connection as green
 * with no inbound notifications. This script catches that pre-deploy.
 *
 * Usage:
 *   node scripts/verify-composio-trigger-slugs.mjs
 *
 * Exit codes:
 *   0 — every curated slug verified
 *   1 — at least one slug not found in Composio's catalog
 *   2 — script-level failure (network, parser, etc.)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRIGGERS_FILE = join(__dirname, '../lib/integrations/triggers.ts');

/**
 * Parse `CURATED_TRIGGERS = { ... }` out of triggers.ts. We do a
 * regex-based scrape rather than evaluating the TS so the script
 * stays a single-file, zero-dependency node tool.
 */
function readCuratedMap() {
  const text = readFileSync(TRIGGERS_FILE, 'utf-8');
  const start = text.indexOf('export const CURATED_TRIGGERS');
  if (start === -1) throw new Error('CURATED_TRIGGERS export not found');
  // Find the matching closing brace of the object literal.
  const openBrace = text.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('CURATED_TRIGGERS body not closed');

  const body = text.slice(openBrace + 1, end);

  /** @type {Record<string, string[]>} */
  const map = {};
  // Match "<toolkit>: [ ... ]" entries. Toolkit keys are bare or quoted
  // identifiers; values are bracketed string arrays with optional
  // comments and trailing commas inside.
  const entryRe = /(['"]?)([a-z][a-z0-9_]*)\1\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const toolkit = m[2];
    const inside = m[3];
    // Pull single-quoted string literals; ignore comments + commas.
    const slugs = [...inside.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((x) => x[1]);
    map[toolkit] = slugs;
  }
  return map;
}

/**
 * Fetch one toolkit's published catalog page and extract trigger slugs
 * from the "Supported Triggers" table.
 */
async function fetchPublishedSlugs(toolkit) {
  const url = `https://composio.dev/toolkits/${toolkit}.md`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'verify-composio-trigger-slugs/1' } });
  } catch (err) {
    return { ok: false, reason: `network: ${err.message}` };
  }
  if (!res.ok) {
    if (res.status === 404) return { ok: true, slugs: [] }; // no public page = empty catalog
    return { ok: false, reason: `HTTP ${res.status}` };
  }
  const text = await res.text();

  // Slice the "## Supported Triggers" section.
  const m = text.match(/^##+ Supported Triggers[\s\S]*?(?=^##+ |\Z)/m);
  if (!m) return { ok: true, slugs: [] };
  const section = m[0];
  const slugs = [...section.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((x) => x[1]);
  // Deduplicate while preserving order.
  return { ok: true, slugs: [...new Set(slugs)] };
}

async function main() {
  const curated = readCuratedMap();
  const toolkits = Object.entries(curated).filter(([, slugs]) => slugs.length > 0);

  console.log(`Verifying ${toolkits.length} toolkits…\n`);

  let allOk = true;
  const networkFails = [];

  for (const [toolkit, slugs] of toolkits) {
    process.stdout.write(`  ${toolkit.padEnd(20)} `);
    const fetched = await fetchPublishedSlugs(toolkit);
    if (!fetched.ok) {
      console.log(`⚠  could not verify (${fetched.reason})`);
      networkFails.push(toolkit);
      continue;
    }
    const published = new Set(fetched.slugs);
    const missing = slugs.filter((s) => !published.has(s));
    if (missing.length === 0) {
      console.log(`✓ all ${slugs.length} verified`);
    } else {
      allOk = false;
      console.log(`✗ ${missing.length} of ${slugs.length} NOT FOUND:`);
      for (const slug of missing) {
        console.log(`      - ${slug}`);
      }
      if (fetched.slugs.length > 0) {
        console.log(`      (Composio publishes: ${fetched.slugs.slice(0, 8).join(', ')}${fetched.slugs.length > 8 ? `, …+${fetched.slugs.length - 8} more` : ''})`);
      }
    }
  }

  console.log('');
  const verifiedCount = toolkits.length - networkFails.length;
  if (networkFails.length > 0) {
    console.log(`Skipped ${networkFails.length} toolkits due to network errors: ${networkFails.join(', ')}`);
    console.log('Re-run when you have connectivity.');
  }
  // Exit codes are honest about WHAT happened:
  //   1 — at least one slug verified-and-wrong (the real failure to fix)
  //   2 — network failures made verification inconclusive
  //   0 — every attempted toolkit verified, and at least one toolkit
  //       was actually checked. (Empty CURATED_TRIGGERS map → also 0.)
  if (!allOk) {
    console.log('At least one curated slug is not in Composio\'s catalog.');
    console.log('Fix or remove the bad slugs in lib/integrations/triggers.ts before deploy.');
    process.exit(1);
  }
  if (toolkits.length > 0 && verifiedCount === 0) {
    console.log('No toolkits could be verified. Verification inconclusive.');
    process.exit(2);
  }
  console.log(
    `Verified ${verifiedCount} of ${toolkits.length} toolkits against Composio's published catalog.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-composio-trigger-slugs failed:', err);
  process.exit(2);
});
