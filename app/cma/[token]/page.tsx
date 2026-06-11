/**
 * /cma/[token] — the PUBLIC, polished CMA report a realtor shares with a seller.
 *
 * No Clerk gate. Access is the unguessable shareToken; only a `published`
 * report renders (a draft 404s, so a half-finished analysis never leaks). The
 * report renders the frozen `payload`, so it stays stable even if the realtor
 * later edits or deletes the underlying Property rows.
 *
 * Design (Jobs lens): this is a deliverable a seller will read, screenshot, and
 * forward. Paper-flat, one focal element (the suggested range), the comps as a
 * clean table, the realtor's workspace name as the only branding. Print-friendly
 * via a scoped @media print block — "save as PDF" from the browser is our v1
 * export, no PDF library.
 *
 * NOTE FOR DEPLOY: /cma/(.*) must be added to middleware's public routes or
 * Clerk will gate this page.
 */

import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatting';
import type { CmaPayload, CmaComp } from '@/lib/cma';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string }>;
}

interface ReportRow {
  id: string;
  spaceId: string;
  subjectAddress: string;
  title: string | null;
  status: string;
  payload: CmaPayload;
}

function money(n: number | null): string {
  return n == null ? '—' : formatCurrency(n);
}

function ppsf(n: number | null): string {
  return n == null ? '—' : `$${n.toLocaleString('en-US')}`;
}

function facts(c: { beds: number | null; baths: number | null; squareFeet: number | null }): string {
  const parts: string[] = [];
  if (c.beds != null) parts.push(`${c.beds} bd`);
  if (c.baths != null) parts.push(`${c.baths} ba`);
  if (c.squareFeet != null) parts.push(`${c.squareFeet.toLocaleString('en-US')} sqft`);
  return parts.join(' · ') || '—';
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  sold: 'Sold',
  off_market: 'Off market',
  owned: 'Owned',
};

const BASIS_NOTE: Record<CmaPayload['stats']['basis'], string> = {
  sold: 'Based on recent sold prices of comparable homes.',
  list: 'Based on current list prices of comparable homes.',
  mixed: 'Based on a mix of recent sold and current list prices.',
  none: 'Not enough priced comparables to compute a range yet.',
};

export default async function CmaPublicPage({ params }: Props) {
  const { token } = await params;

  const { data: row } = await supabase
    .from('CmaReport')
    .select('id, spaceId, subjectAddress, title, status, payload')
    .eq('shareToken', token)
    .maybeSingle();

  if (!row) notFound();
  const report = row as ReportRow;

  // A draft is private. Only published reports are visible to an outsider.
  if (report.status !== 'published') notFound();

  const { data: spaceRow } = await supabase
    .from('Space')
    .select('name, emoji')
    .eq('id', report.spaceId)
    .maybeSingle();
  const brand = (spaceRow as { name: string; emoji: string | null } | null) ?? null;

  const { subject, comps, stats, generatedAt } = report.payload;

  const subjectLocation = [subject.city, subject.stateRegion].filter(Boolean).join(', ');
  const hasRange = stats.suggestedLow != null && stats.suggestedHigh != null;
  const generated = new Date(generatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white">
      <style>{PRINT_CSS}</style>

      <div className="mx-auto max-w-3xl px-5 sm:px-6 py-10 sm:py-14 pb-16 space-y-12">
        {/* ── Brand line ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-muted-foreground">
          {brand?.emoji && <span aria-hidden className="text-base leading-none">{brand.emoji}</span>}
          <span className="text-[11px] font-medium uppercase tracking-wider">
            {brand?.name ?? 'Comparative market analysis'}
          </span>
        </div>

        {/* ── Header (the one focal block) ───────────────────────────────── */}
        <header className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Comparative market analysis.</p>
          <h1
            className="text-3xl tracking-tight text-foreground"
            style={{ fontFamily: 'var(--font-title)' }}
          >
            {report.title?.trim() || subject.address}
          </h1>
          <p className="text-sm text-muted-foreground">
            {report.title?.trim() ? subject.address : subjectLocation || 'Prepared for the property owner.'}
          </p>
        </header>

        {/* ── Suggested range — the headline number ──────────────────────── */}
        <section className="rounded-xl border border-border/70 bg-card px-6 py-7 text-center space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Suggested list-price range
          </p>
          {hasRange ? (
            <p
              className="text-3xl tracking-tight text-foreground tabular-nums"
              style={{ fontFamily: 'var(--font-title)' }}
            >
              {money(stats.suggestedLow)} – {money(stats.suggestedHigh)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add priced comparables to compute a range.
            </p>
          )}
          <p className="text-xs text-muted-foreground">{BASIS_NOTE[stats.basis]}</p>
        </section>

        {/* ── The comp-derived stat strip ────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
          <Stat label="Comparables" value={String(stats.compCount)} />
          <Stat label="Low" value={money(stats.low)} />
          <Stat label="Median" value={money(stats.median)} />
          <Stat label="High" value={money(stats.high)} />
        </section>

        {/* ── Subject property ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Subject property
          </p>
          <div className="rounded-xl border border-border/70 bg-card px-5 py-4 space-y-1.5">
            <p className="text-[17px] font-semibold text-foreground">{subject.address}</p>
            <p className="text-sm text-muted-foreground">{facts(subject)}</p>
            {subject.listPrice != null && (
              <p className="text-sm text-muted-foreground">
                List price{' '}
                <span className="text-foreground tabular-nums">{money(subject.listPrice)}</span>
              </p>
            )}
          </div>
        </section>

        {/* ── Comparables table ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Comparable homes
            </p>
            {stats.avgPricePerSqft != null && (
              <p className="text-xs text-muted-foreground">
                Avg{' '}
                <span className="text-foreground tabular-nums">
                  {ppsf(stats.avgPricePerSqft)}
                </span>
                /sqft
              </p>
            )}
          </div>

          {comps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
              <p className="text-sm text-foreground">No comparable homes on file yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Comparables drawn from this office&apos;s records will appear here.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left">
                    <Th>Address</Th>
                    <Th className="text-right">Beds / baths</Th>
                    <Th className="text-right">Sqft</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">$/sqft</Th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map((c) => (
                    <CompRow key={c.id} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="border-t border-border/60 pt-6 space-y-2">
          <p className="text-xs text-muted-foreground">
            Prepared {brand?.name ? `by ${brand.name} ` : ''}on {generated}. This analysis is an
            estimate based on comparable properties, not an appraisal.
          </p>
          <p className="text-[11px] text-muted-foreground print:hidden">
            Tip: use your browser&apos;s print to save this report as a PDF.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ── Leaf components ───────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-4 print:bg-white">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className="text-[25px] leading-tight tracking-tight text-foreground tabular-nums mt-1"
        style={{ fontFamily: 'var(--font-title)' }}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function CompRow({ c }: { c: CmaComp }) {
  const bedBath =
    c.beds != null || c.baths != null
      ? `${c.beds ?? '—'} / ${c.baths ?? '—'}`
      : '—';
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2.5 align-top">
        <span className="text-foreground">{c.address}</span>
        {c.city && <span className="text-muted-foreground"> · {c.city}</span>}
        <span className="ml-2 text-[11px] text-muted-foreground">
          {STATUS_LABEL[c.listingStatus] ?? c.listingStatus}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums align-top">{bedBath}</td>
      <td className="px-3 py-2.5 text-right tabular-nums align-top">
        {c.squareFeet != null ? c.squareFeet.toLocaleString('en-US') : '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums align-top">{money(c.price)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums align-top">{ppsf(c.pricePerSqft)}</td>
    </tr>
  );
}

// Print: drop chrome to white, tighten margins, force colors so the PDF reads
// like printed paper. Scoped to this page via inline <style>.
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }
  html, body { background: #fff !important; }
  .print\\:hidden { display: none !important; }
}
`;
