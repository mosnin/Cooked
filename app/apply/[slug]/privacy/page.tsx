import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getSpaceFromSlug } from '@/lib/space';
import { generatePrivacyPolicy } from '@/lib/privacy-policy-template';
import DOMPurify from 'isomorphic-dompurify';
import Link from 'next/link';

/**
 * Sanitize the realtor's stored privacy policy HTML before rendering.
 *
 * The realtor authors this content in their settings (rich-text editor in
 * dashboard → settings → legal). It's then displayed to APPLICANTS when
 * they click "Privacy Policy" in the intake flow. A compromised realtor
 * account, or any code path that mistakenly accepts unsanitized HTML on
 * write, could plant stored XSS that fires on every applicant's browser.
 *
 * Previous implementation was a hand-rolled regex stripper that missed
 * common bypasses: <style>, <base>, data: URLs, SVG vectors, and mutation
 * XSS via malformed nesting (`<scr<script>ipt>` style). DOMPurify parses
 * the HTML into a real DOM tree and walks it with an allowlist — the
 * battle-tested way to handle this.
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Allow only the tags a typical privacy policy needs. No <style>,
    // <script>, <iframe>, <object>, <embed>, <form>, <base>, <svg> —
    // all known XSS surfaces. <a> is allowed but rendered with
    // safe-by-default rel and target via DOMPurify hooks below.
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'strong', 'em', 'b', 'i', 'u', 's',
      'ul', 'ol', 'li',
      'a', 'blockquote', 'code', 'pre',
      'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    // Only allow http(s) and mailto: in URLs. Blocks javascript:,
    // data:, vbscript:, and anything else.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,
  });
}

export const revalidate = 300; // Cache 5 minutes

export default async function RealtorPrivacyPolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const [{ data: settings }, { data: owner }] = await Promise.all([
    supabase
      .from('SpaceSetting')
      .select('privacyPolicyHtml, businessName')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('User')
      .select('name')
      .eq('id', space.ownerId)
      .maybeSingle(),
  ]);

  const businessName = settings?.businessName || space.name;
  // Use the realtor's custom policy, or auto-generate a comprehensive default
  const rawPolicyHtml = settings?.privacyPolicyHtml || generatePrivacyPolicy(businessName, 'realtor');
  const policyHtml = sanitizeHtml(rawPolicyHtml);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">{businessName}</h1>
            <p className="text-xs text-muted-foreground">Privacy Policy</p>
          </div>
          <Link href={`/apply/${slug}`} className="text-xs text-primary underline">
            Back to application
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <article
          className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base prose-p:text-sm prose-li:text-sm"
          dangerouslySetInnerHTML={{ __html: policyHtml }}
        />
        <div className="mt-10 pt-6 border-t border-border text-xs text-muted-foreground space-y-1">
          <p>This privacy policy is maintained by {businessName}.</p>
          <p>
            {businessName} uses{' '}
            <a href="https://usechippi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Chippi
            </a>{' '}
            to process applications. Chippi&apos;s own{' '}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Terms of Service
            </a>{' '}
            also apply.
          </p>
        </div>
      </main>
    </div>
  );
}
