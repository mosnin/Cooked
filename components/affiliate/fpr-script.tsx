'use client';

/**
 * FprScript — injects the FirstPromoter fpr.js snippet on marketing pages.
 *
 * When a visitor lands on a marketing page via a ?fpr=<token> link, fpr.js
 * reads the token from the URL and sets a _fprom_tid cookie. That cookie is
 * later read on the signup/subscription flow to attribute the conversion.
 *
 * Rendered only when NEXT_PUBLIC_FIRST_PROMOTER_CID is set. Mount this in
 * the marketing layout so every marketing page participates.
 *
 * No secrets — only the public CID is used here.
 */

import Script from 'next/script';

const CID = process.env.NEXT_PUBLIC_FIRST_PROMOTER_CID;

export function FprScript() {
  if (!CID) return null;

  const inline = `
    (function(w){
      w.fpr = w.fpr || function(){(w.fpr.q = w.fpr.q || []).push(arguments)};
    })(window);
    fpr("init", { cid: ${JSON.stringify(CID)} });
    fpr("click");
  `;

  return (
    <>
      <Script
        id="fpr-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: inline }}
      />
      <Script
        id="fpr-js"
        src="https://cdn.firstpromoter.com/fpr.js"
        strategy="afterInteractive"
      />
    </>
  );
}
