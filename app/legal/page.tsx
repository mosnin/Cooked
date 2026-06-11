/**
 * `/legal` — the legal hub. The index of the documents that govern Chippi.
 *
 * Why this lives at `app/legal/page.tsx` and not under the (marketing) group:
 * the five real documents (terms, privacy, cookies, acceptable-use, dpa)
 * already live under `app/legal/*` with their own `layout.tsx`. This page is
 * the missing index of that tree — one front door, not a second one. The
 * footer link to `/legal` resolves here and every document is one hairline
 * row away. A parallel `/legal` under (marketing) would collide on the route
 * (two pages resolving to `/legal`) and split the legal section in two.
 *
 * Apple-discipline: serif Times headline, hairline-divided rows, no shadow,
 * no gradient, no brand orange. The documents that exist are linked; the
 * ones we provide on request are honest muted rows, not dead "#" links.
 */

import Link from 'next/link';

export const metadata = { title: 'Legal — Chippi' };

/** Documents that exist as real pages under `app/legal/*`. */
const DOCUMENTS: { href: string; label: string; description: string }[] = [
  {
    href: '/legal/privacy',
    label: 'Privacy policy',
    description: 'How we collect, use, and protect data across the platform.',
  },
  {
    href: '/legal/terms',
    label: 'Terms of service',
    description: 'The agreement that governs your use of Chippi.',
  },
  {
    href: '/legal/cookies',
    label: 'Cookie policy',
    description: 'The cookies we set and how to manage them.',
  },
  {
    href: '/legal/acceptable-use',
    label: 'Acceptable use',
    description: 'What the platform may and may not be used for.',
  },
  {
    href: '/legal/dpa',
    label: 'Data processing agreement',
    description: 'How we process personal data on a subscriber’s behalf.',
  },
];

/** Documents we keep current but provide on request rather than publish. */
const ON_REQUEST: string[] = [
  'Subprocessors list',
  'Security overview',
  'Master services agreement',
];

export default function LegalHubPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">Legal.</p>
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          The fine print, in plain sight.
        </h1>
        <p className="text-sm text-muted-foreground">
          Every document that governs Chippi, one click away.
        </p>
      </header>

      {/* The real documents — hairline-divided rows, each a quiet link. */}
      <ul className="divide-y divide-border/60 border-t border-b border-border/60">
        {DOCUMENTS.map((doc) => (
          <li key={doc.href}>
            <Link
              href={doc.href}
              className="group -mx-3 flex items-baseline justify-between gap-4 rounded-md px-3 py-4 transition-colors hover:bg-foreground/[0.04]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {doc.label}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground leading-snug">
                  {doc.description}
                </span>
              </span>
              <span
                aria-hidden
                className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Available on request — honest muted rows, not dead links. */}
      <section className="space-y-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Available on request
        </p>
        <ul className="divide-y divide-border/60 border-t border-b border-border/60">
          {ON_REQUEST.map((label) => (
            <li
              key={label}
              className="flex items-center justify-between gap-4 py-4"
            >
              <span className="text-sm text-foreground">{label}</span>
              <a
                href="mailto:legal@chippi.app"
                className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                legal@chippi.app
              </a>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Questions about any of these — write to{' '}
          <a
            href="mailto:legal@chippi.app"
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            legal@chippi.app
          </a>
          .
        </p>
      </section>
    </article>
  );
}
