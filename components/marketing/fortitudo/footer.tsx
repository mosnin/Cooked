'use client';

/**
 * Marketing footer: fortitudo's inset rounded-card footer, retooled for
 * Chippi. Made theme-aware: a deep charcoal card in both modes (it reads as a
 * deliberate dark base on the light canvas, same call as the home stats card)
 * with brand-orange small-caps column heads. Chippi routes only.
 */

import Link from 'next/link';

const footerLinks = {
  product: [
    { label: 'For realtors', href: '/realtors' },
    { label: 'For brokerages', href: '/brokerages' },
    { label: 'Integrations', href: '/integrations' },
    { label: 'Pricing', href: '/pricing' },
  ],
  company: [
    { label: 'Company', href: '/company' },
    { label: 'Book a demo', href: '/demo' },
    { label: 'Status', href: '/status' },
    { label: 'Log in', href: '/login/realtor' },
  ],
  legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Legal', href: '/legal' },
  ],
};

export function FortitudoFooter() {
  return (
    <footer className="bg-background px-4 pb-6 sm:px-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-marketing-3xl bg-[#111113] text-white">
        <div className="px-6 py-12 sm:px-8 lg:px-12">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {/* Brand. */}
            <div className="col-span-2 space-y-4 md:col-span-1">
              <Link href="/" className="flex items-center gap-2" aria-label="Chippi home">
                {/* Footer is always dark, so the white wordmark always applies. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-white.png" alt="Chippi" className="block h-5 w-auto" />
              </Link>
              <p className="max-w-xs text-sm text-white/50">
                The agentic OS for real-estate agents and brokerages. The
                busywork runs itself, so the hours go to closing.
              </p>
            </div>

            <div>
              <h4 className="mb-4 font-brand text-xs uppercase tracking-[0.2em] text-brand">
                Product
              </h4>
              <ul className="space-y-2.5">
                {footerLinks.product.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-white/55 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="mb-4 font-brand text-xs uppercase tracking-[0.2em] text-brand">
                Company
              </h4>
              <ul className="space-y-2.5">
                {footerLinks.company.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-white/55 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="mb-4 font-brand text-xs uppercase tracking-[0.2em] text-brand">
                Legal
              </h4>
              <ul className="space-y-2.5">
                {footerLinks.legal.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-white/55 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 border-t border-white/10 px-6 py-4 sm:flex-row sm:justify-between sm:px-8 lg:px-12">
          <p className="text-xs text-white/40">
            &copy; {new Date().getFullYear()} Chippi. All rights reserved.
          </p>
          <Link
            href="/status"
            className="inline-flex items-center gap-2 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-emerald-500" />
            All systems operational.
          </Link>
        </div>
      </div>
    </footer>
  );
}
