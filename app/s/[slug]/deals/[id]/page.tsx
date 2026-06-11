import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { getSpaceFromSlug, getSpaceForUser } from '@/lib/space';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Mic, MoreHorizontal } from 'lucide-react';
import type { DealStage, DealActivity, DealMilestone } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCompact, getInitials } from '@/lib/formatting';
import { roleLabel } from '@/lib/deals/roles';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
} from '@/lib/typography';
import { PAGE_MAX } from '@/lib/geometry';
import { DealDetailClient } from '@/components/deals/deal-detail-client';
import { DealInlineField } from '@/components/deals/deal-inline-field';
import { DealFollowUpField } from '@/components/deals/deal-follow-up-field';
import { DealStatusControl } from '@/components/deals/deal-status-control';
import { DealStageSelector } from '@/components/deals/deal-stage-selector';
import { DealContactsManager } from '@/components/deals/deal-contacts-manager';
import { DealMilestones } from '@/components/deals/deal-milestones';
import { DealChecklist } from '@/components/deals/deal-checklist';
import { DealCloseDateField } from '@/components/deals/deal-close-date-field';
import { DealCommissionSplits } from '@/components/deals/deal-commission-splits';
import { DealDocuments } from '@/components/deals/deal-documents';
import { DealNextActionField } from '@/components/deals/deal-next-action-field';
import { DealPropertyPicker } from '@/components/deals/deal-property-picker';
import { DealPrioritySelector } from '@/components/deals/deal-priority-selector';
import { DeleteDealButton } from '@/components/deals/deal-delete-button';
import { FlagForReviewButton } from '@/components/deals/flag-for-review-button';
import { DealTabStrip, isDealTabKey, type DealTabKey } from '@/components/deals/deal-tab-strip';
import { AgentDealPanel } from '@/components/agent/agent-deal-panel';
import type { DealChecklistItem } from '@/lib/deals/checklist';
import type { DealDocument } from '@/lib/deals/documents';
import type { Property } from '@/lib/types';
import { isDocusignConnected } from '@/lib/esign';
import type { SignatureRequestLite } from '@/components/esign/send-for-signature';


export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug, id } = await params;
  const { tab } = await searchParams;
  // URL contract matches People detail: `?tab=<key>`, default `activity`. The
  // realtor moves between People and Deals all day; the chrome — and the URL
  // shape — needs to read the same on both sides.
  const activeTab: DealTabKey = isDealTabKey(tab) ? tab : 'activity';

  // Middleware only requires login; ownership of /s/[slug] is enforced here.
  // Without this, a logged-in realtor could read another realtor's deal data
  // (value, GCI, address, contacts, activities) by guessing the URL.
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const userSpace = await getSpaceForUser(userId);
  if (!userSpace || userSpace.id !== space.id) notFound();

  let dealRow: Record<string, unknown>;
  let dealContacts: { dealId: string; contactId: string; role: string | null; contact: { id: string; name: string; email: string | null; phone: string | null } | null }[];
  let activities: DealActivity[];
  let allStages: DealStage[];
  let checklist: DealChecklistItem[];
  let documents: DealDocument[];
  let linkedProperty: Property | null = null;
  let hasOpenReview = false;
  let owner: { id: string; name: string | null; email: string; avatar: string | null } | null = null;
  let signatureRequests: SignatureRequestLite[] = [];

  try {
    const { data: dealData, error: dealError } = await supabase
      .from('Deal')
      .select('*')
      .eq('id', id)
      .eq('spaceId', space.id)
      .maybeSingle();

    if (dealError) throw dealError;
    if (!dealData) notFound();
    dealRow = dealData as Record<string, unknown>;

    const [stagesResult, dcResult, activityResult, checklistResult, docsResult, ownerResult] = await Promise.all([
      supabase.from('DealStage').select('*').eq('spaceId', space.id).order('position'),
      supabase.from('DealContact').select('dealId, contactId, role, Contact(id, name, type, email, phone)').eq('dealId', id),
      supabase.from('DealActivity').select('*').eq('dealId', id).eq('spaceId', space.id).order('createdAt', { ascending: false }).limit(100),
      supabase.from('DealChecklistItem').select('*').eq('dealId', id).eq('spaceId', space.id).order('position', { ascending: true }),
      supabase.from('DealDocument').select('*').eq('dealId', id).eq('spaceId', space.id).order('createdAt', { ascending: false }),
      // The space's owner IS the assigned realtor for everything inside the
      // workspace. We render their avatar + name in the sidebar hero so the
      // page reads as "this deal belongs to a real person", not an anonymous
      // record. One row by primary key — index lookup, no perf concern.
      supabase.from('User').select('id, name, email, avatar').eq('id', space.ownerId).maybeSingle(),
    ]);

    if (stagesResult.error) throw stagesResult.error;
    if (dcResult.error) throw dcResult.error;
    if (activityResult.error) throw activityResult.error;
    if (checklistResult.error) throw checklistResult.error;
    if (docsResult.error) throw docsResult.error;

    allStages = (stagesResult.data ?? []) as DealStage[];
    checklist = (checklistResult.data ?? []) as DealChecklistItem[];
    documents = (docsResult.data ?? []) as DealDocument[];
    owner = (ownerResult.data as { id: string; name: string | null; email: string; avatar: string | null } | null) ?? null;

    // Load the linked Property, if any. Kept as a small separate fetch so we
    // don't join here — Property rows can be referenced from multiple deals.
    const linkedPropertyId = (dealRow.propertyId as string | null | undefined) ?? null;
    if (linkedPropertyId) {
      const { data: propData } = await supabase
        .from('Property')
        .select('*')
        .eq('id', linkedPropertyId)
        .eq('spaceId', space.id)
        .maybeSingle();
      linkedProperty = (propData as Property | null) ?? null;
    }
    // Lookup whether this deal already has an open broker review request.
    // Only meaningful when the space is in a brokerage; we still issue the
    // query unconditionally (it's a single indexed lookup) so the UI below
    // stays simple, and we swallow errors so an as-yet-unapplied migration
    // on another branch doesn't break the page.
    if (space.brokerageId) {
      try {
        const { data: openReview } = await supabase
          .from('DealReviewRequest')
          .select('id')
          .eq('dealId', id)
          .eq('status', 'open')
          .maybeSingle();
        hasOpenReview = !!openReview;
      } catch (reviewErr) {
        console.warn('[deal-detail] review-request lookup failed (ignored)', reviewErr);
        hasOpenReview = false;
      }
    }

    dealContacts = ((dcResult.data ?? []) as Record<string, unknown>[]).map((row) => {
      const contact = row.Contact as { id: string; name: string; type: string; email: string | null; phone: string | null } | null;
      return {
        dealId: row.dealId as string,
        contactId: row.contactId as string,
        role: (row.role as string | null) ?? null,
        contact: contact
          ? { id: contact.id, name: contact.name, email: contact.email ?? null, phone: contact.phone ?? null }
          : null,
      };
    });
    activities = (activityResult.data ?? []) as DealActivity[];

    // Signature requests for this deal — drives the inline status pill on each
    // document row. A single indexed lookup; swallow errors so an as-yet-
    // unapplied migration on another branch doesn't break the page.
    try {
      const { data: sigRows } = await supabase
        .from('SignatureRequest')
        .select('id, documentId, status, signerEmail, signerName, subject, createdAt')
        .eq('dealId', id)
        .eq('spaceId', space.id)
        .order('createdAt', { ascending: false });
      signatureRequests = (sigRows ?? []) as SignatureRequestLite[];
    } catch (sigErr) {
      console.warn('[deal-detail] signature lookup failed (ignored)', sigErr);
    }
  } catch (err) {
    console.error('[deal-detail] DB queries failed', err);
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your data. This is usually temporary.</p>
          <a
            href={`/s/${slug}/deals/${id}`}
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  const title = dealRow.title as string;
  const stageId = dealRow.stageId as string;
  const status = (dealRow.status ?? 'active') as 'active' | 'won' | 'lost' | 'on_hold';
  const priority = (dealRow.priority ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH';
  const value = dealRow.value != null ? (dealRow.value as number) : null;
  const commissionRate = dealRow.commissionRate != null ? (dealRow.commissionRate as number) : null;
  const probability = dealRow.probability != null ? (dealRow.probability as number) : null;
  const closeDate = dealRow.closeDate != null ? (dealRow.closeDate as string) : null;
  const followUpAt = dealRow.followUpAt != null ? (dealRow.followUpAt as string) : null;
  const address = dealRow.address != null ? (dealRow.address as string) : null;
  const description = dealRow.description != null ? (dealRow.description as string) : null;
  const nextAction = dealRow.nextAction != null ? (dealRow.nextAction as string) : null;
  const nextActionDueAt = dealRow.nextActionDueAt != null ? (dealRow.nextActionDueAt as string) : null;
  const stageChangedAt = dealRow.stageChangedAt != null ? (dealRow.stageChangedAt as string) : null;
  const updatedAt = dealRow.updatedAt as string;
  const milestones = (dealRow.milestones ?? []) as DealMilestone[];

  const linkedContacts = dealContacts
    .filter((dc) => dc.contact !== null)
    .map((dc) => ({ ...dc.contact!, role: dc.role as import('@/lib/types').DealContactRole | null }));

  const currentStage = allStages.find((s) => s.id === stageId) ?? null;
  const pipelineType = currentStage?.pipelineType ?? null;
  const gci =
    value != null && commissionRate != null ? (value * commissionRate) / 100 : null;

  // Is DocuSign connected for this realtor? Drives whether the documents tab
  // shows "Send for signature" or a quiet "Connect DocuSign" link. Gated +
  // best-effort inside the helper — never throws.
  const docusignConnected = await isDocusignConnected(userId);

  // Headline is the address when present; the deal title otherwise. Addresses
  // are how realtors actually talk about deals — "the Maple Ave place", not
  // "Buyer rep — Smith". When the user hasn't entered an address yet, the
  // title is the next-best identity. Either way it's serif Times h1, the
  // one focal element on the page.
  const rawHeadline = (address && address.trim().length > 0 ? address : title).trim();
  const headline = rawHeadline.length > 0 ? rawHeadline : 'Untitled deal';

  const statusSentence = buildStatusSentence({
    status,
    stageName: currentStage?.name ?? null,
    stageChangedAt,
    closeDate,
    value,
    updatedAt,
    lastActivityAt: activities[0]?.createdAt as unknown as string | null | undefined,
  });

  const ownerName = owner?.name?.trim() || owner?.email || 'You';
  const ownerInitials = getInitials(ownerName);

  return (
    <div className={cn(PAGE_MAX, 'mx-auto space-y-8 pb-12')}>
      {/* Quiet back link — mirrors the People detail's "ArrowLeft People"
          breadcrumb. The card-wrapped breadcrumb in the old design was loud
          chrome for a navigation primitive. */}
      <Link
        href={`/s/${slug}/deals`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={12} /> Pipeline
      </Link>

      {/* Header — serif h1 + status sentence + action row + hairline-divider
          grid. The address (or title) is the one focal element on the page;
          everything else recedes. Same shape as the People detail; same
          hairline-divider snapshot vocabulary as the deal quick panel. */}
      <header className="space-y-5">
        <div className="space-y-2">
          <h1
            className={cn(H1)}
            style={TITLE_FONT}
          >
            {headline}
          </h1>
          <p className={cn(BODY_MUTED, 'tabular-nums leading-relaxed')}>
            {statusSentence}
          </p>
          {/* When the address IS the headline, show the deal title beneath as
              a secondary identifier. The realtor named the deal for a reason
              ("Buyer rep — Smith"); don't lose it. */}
          {address && address.trim().length > 0 && title.trim().length > 0 && title.trim() !== address.trim() && (
            <p className={BODY_MUTED}>{title}</p>
          )}
        </div>

        {/* Action row — Log a tour + Flag for review are peers. Delete moves
            into the overflow menu. Destructive actions should never be a
            peer chip on a primary surface. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/s/${slug}/chippi/log?dealId=${id}`}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 rounded-full px-4 text-sm transition-colors',
              'border border-border/70 bg-background text-foreground hover:bg-muted/40',
            )}
            title="Record a quick post-tour debrief"
          >
            <Mic size={13} />
            Log a tour
          </Link>
          <FlagForReviewButton
            dealId={id}
            hasOpenReview={hasOpenReview}
            visible={!!space.brokerageId}
          />
          {/* Overflow — hosts destructive actions so they can't be hit by
              mistake. Same shape contact-table uses for its More menu so the
              vocabulary is consistent across the app. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More options"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-1.5">
              {/* DeleteDealButton is owned by Deals β — we render it inside
                  the overflow menu instead of inline. The button still has
                  its own confirm; this only changes where it lives. The
                  current component renders as an icon-only ghost button;
                  we wrap it with a sibling label so the menu reads as
                  "Delete deal" until β ships the proper menu-item shape. */}
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-destructive">
                <DeleteDealButton dealId={id} slug={slug} dealTitle={title} />
                <span className="font-medium">Delete deal</span>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hairline-divider snapshot grid — same vocabulary as the deal quick
            panel. Four cells max so each one breathes. */}
        <section
          className={cn(
            'grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden',
            'border border-border/60 bg-border/60',
          )}
        >
          <StatCell label="Value">
            <p
              className="text-2xl tracking-tight tabular-nums text-foreground"
              style={TITLE_FONT}
            >
              {value != null ? formatCurrency(value) : '—'}
            </p>
          </StatCell>
          <StatCell label="GCI">
            <p
              className="text-2xl tracking-tight tabular-nums text-foreground"
              style={TITLE_FONT}
            >
              {gci != null ? formatCompact(gci) : '—'}
            </p>
            {commissionRate != null && (
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {commissionRate}%
              </p>
            )}
          </StatCell>
          <StatCell label="Close">
            <p
              className="text-2xl tracking-tight tabular-nums text-foreground"
              style={TITLE_FONT}
            >
              {closeDate
                ? new Date(closeDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : '—'}
            </p>
            {closeDate && (
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {new Date(closeDate).getFullYear()}
              </p>
            )}
          </StatCell>
          <StatCell label="Stage">
            <p className="text-base font-medium text-foreground leading-tight">
              {currentStage?.name ?? '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 capitalize">
              {status === 'on_hold' ? 'on hold' : status}
            </p>
          </StatCell>
        </section>
      </header>

      {/* Sidebar + main grid. Card wraps both because the realtor reads the
          page as one object, not two columns. */}
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">

          {/* LEFT SIDEBAR — hero (assigned realtor + linked contacts) on top,
              then a tight grid of edits-on-this-record below a hairline.
              Previously: 10 stacked cells, each with its own uppercase label,
              no hierarchy. The hero now says "this deal belongs to a person
              working with these people"; the fields say "and here's the
              control surface", and the hairline says "these are different
              kinds of information." */}
          <aside className="border-b lg:border-b-0 lg:border-r border-border/60 p-5 space-y-5">

            {/* Hero — the assigned realtor on top, contacts beneath. Avatars
                make the page feel like it's about real people, not a form. */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar size="default">
                  {owner?.avatar ? <AvatarImage src={owner.avatar} alt={ownerName} /> : null}
                  <AvatarFallback>{ownerInitials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{ownerName}</p>
                  <p className="text-[11px] text-muted-foreground">Realtor</p>
                </div>
              </div>

              {linkedContacts.length > 0 && (
                <ul className="space-y-2">
                  {linkedContacts.map((c) => {
                    const initials = getInitials(c.name);
                    const role = roleLabel(c.role) ?? 'Contact';
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/s/${slug}/contacts/${c.id}`}
                          className="flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
                        >
                          <Avatar size="sm">
                            <AvatarFallback>{initials}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground truncate">{c.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{role}</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="h-px bg-border/60" />

            {/* Dense field grid — close / value / GCI / commission / stage /
                priority / status / follow-up / probability. Two-column where
                each cell is short; full-width where the control needs room.
                No more "every field on its own row with its own uppercase
                label." */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FieldCell label="Value">
                  <DealInlineField
                    dealId={id}
                    field="value"
                    value={value}
                    type="number"
                    label="Deal Value"
                    prefix="$"
                    displayValue={value != null ? `$${value.toLocaleString()}` : ''}
                    placeholder="Not set"
                    min={0}
                    step={1000}
                  />
                </FieldCell>
                <FieldCell label="Commission">
                  <DealInlineField
                    dealId={id}
                    field="commissionRate"
                    value={commissionRate}
                    type="number"
                    label="Commission Rate"
                    suffix="%"
                    placeholder="Not set"
                    min={0}
                    max={100}
                    step={0.1}
                  />
                </FieldCell>
              </div>

              <FieldCell label="Close date">
                <DealCloseDateField dealId={id} initial={closeDate} />
              </FieldCell>

              <div className="grid grid-cols-2 gap-3">
                <FieldCell label="Stage">
                  <DealStageSelector dealId={id} initialStageId={stageId} stages={allStages} />
                </FieldCell>
                <FieldCell label="Status">
                  <DealStatusControl dealId={id} initialStatus={status} />
                </FieldCell>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FieldCell label="Priority">
                  <DealPrioritySelector dealId={id} initialPriority={priority} />
                </FieldCell>
                <FieldCell label="Probability">
                  <DealInlineField
                    dealId={id}
                    field="probability"
                    value={probability}
                    type="number"
                    label="Probability"
                    suffix="%"
                    placeholder="Not set"
                    min={0}
                    max={100}
                    step={1}
                  />
                </FieldCell>
              </div>

              <FieldCell label="Follow-up">
                <DealFollowUpField dealId={id} followUpAt={followUpAt} status={status} />
              </FieldCell>

              <DealPropertyPicker dealId={id} slug={slug} initial={linkedProperty} />
            </div>
          </aside>

          {/* RIGHT MAIN — URL-driven tabs that mirror the People detail
              page. Same `?tab=` contract, same border-b-2 active underline,
              same default (`activity`). The realtor switches between People
              and Deals all day; the chrome reads identically by design. */}
          <main className="p-5 min-h-[400px] space-y-5">

            {/* Next action — the "what's next" focal line, hoisted above
                the tab strip with the rest of the deal's primary control
                surface (stage / status / value / follow-up live in the
                sidebar; next-action lives here so it sits at the top of
                the realtor's reading order). */}
            <DealNextActionField
              dealId={id}
              initialAction={nextAction}
              initialDueAt={nextActionDueAt}
            />

            {/* Tab strip — near-copy of `ContactTabStrip` in
                `app/s/[slug]/contacts/[id]/detail-client.tsx`. Consolidating
                them into one shared `<DetailTabStrip>` is a deliberate
                follow-up; doing it now would refactor the contact one
                mid-ship. */}
            <DealTabStrip baseHref={`/s/${slug}/deals/${id}`} />

            {/* Tab content. Each tab owns a slice of what used to live in
                the old Overview / Checklist / Documents / Activity layout —
                now reordered to match the People detail's general-to-
                specific flow (Activity first, then the artefacts). */}
            {activeTab === 'activity' && (
              <div className="space-y-5">
                {/* Deal metadata — title / address / notes used to live in
                    the old Overview tab. They're settings on this record,
                    not "activity", but the realtor wants them visible
                    while logging notes. Park them at the top of Activity
                    rather than spin up a sixth tab for two text fields. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className={cn(SECTION_LABEL, 'mb-1.5')}>Title</p>
                    <DealInlineField
                      dealId={id}
                      field="title"
                      value={title}
                      type="text"
                      label="Title"
                      placeholder="Deal title"
                    />
                  </div>
                  <div>
                    <p className={cn(SECTION_LABEL, 'mb-1.5')}>Address</p>
                    <DealInlineField
                      dealId={id}
                      field="address"
                      value={address}
                      type="text"
                      label="Address"
                      placeholder="Not set"
                    />
                  </div>
                </div>
                <div>
                  <p className={cn(SECTION_LABEL, 'mb-1.5')}>Notes</p>
                  <DealInlineField
                    dealId={id}
                    field="description"
                    value={description}
                    type="textarea"
                    label="Notes"
                    placeholder="Add notes or description…"
                  />
                </div>

                <DealDetailClient
                  dealId={id}
                  slug={slug}
                  initialActivities={activities}
                />

                <AgentDealPanel dealId={id} slug={slug} dealTitle={title} />
              </div>
            )}

            {activeTab === 'documents' && (
              <DealDocuments
                dealId={id}
                slug={slug}
                docusignConnected={docusignConnected}
                signatureRequests={signatureRequests}
                initial={documents}
                pipelineType={pipelineType}
              />
            )}

            {activeTab === 'contacts' && (
              <DealContactsManager dealId={id} slug={slug} initialContacts={linkedContacts} />
            )}

            {activeTab === 'commission' && (
              <DealCommissionSplits
                dealId={id}
                dealValue={value}
                dealCommissionRate={commissionRate}
              />
            )}

            {activeTab === 'tasks' && (
              <div className="space-y-6">
                <DealChecklist dealId={id} initial={checklist} />
                <DealMilestones dealId={id} initialMilestones={milestones} />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

/**
 * One cell in the hairline-divider snapshot grid. Muted label above, strong
 * value below. Same vocabulary as the deal quick panel and the People detail
 * snapshot strip. STYLESHEET.md §"Surfaces → hairline-divider grid".
 */
function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-background px-4 py-4">
      <p className={SECTION_LABEL}>{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * One field in the dense sidebar grid. Small-caps label, control beneath.
 * No card chrome — the surrounding card carries the visual structure.
 */
function FieldCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={cn(SECTION_LABEL, 'mb-1.5')}>{label}</p>
      {children}
    </div>
  );
}

// ── Status-sentence builder ────────────────────────────────────────────────

/**
 * One-sentence narrative under the headline. Matches the People detail's
 * status-sentence vocabulary ("Hot · 78 · 9 days quiet."): tabular nums,
 * one period, no exclamation.
 *
 * Shape varies by deal status so the line reads naturally:
 *   active   → "On Under contract since Apr 14 · closes May 30 · $1.4M"
 *   active   → "On Active since Mar 02 · no close date set"
 *   won      → "Won on Apr 22 · $1.2M"
 *   lost     → "Lost on Apr 22 · last activity 6 days ago"
 *   on_hold  → "On hold since Apr 14 · last activity 6 days ago"
 */
function buildStatusSentence({
  status,
  stageName,
  stageChangedAt,
  closeDate,
  value,
  updatedAt,
  lastActivityAt,
}: {
  status: 'active' | 'won' | 'lost' | 'on_hold';
  stageName: string | null;
  stageChangedAt: string | null;
  closeDate: string | null;
  value: number | null;
  updatedAt: string;
  lastActivityAt: string | null | undefined;
}): string {
  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Won — short and final.
  if (status === 'won') {
    const when = stageChangedAt ?? updatedAt;
    const parts: string[] = [`Won on ${fmtShort(when)}`];
    if (value != null) parts.push(formatCurrency(value));
    return parts.join(' · ') + '.';
  }

  // Lost — short, with last-activity recency so the realtor remembers when
  // they last touched it.
  if (status === 'lost') {
    const when = stageChangedAt ?? updatedAt;
    const parts: string[] = [`Lost on ${fmtShort(when)}`];
    const recency = lastActivityAt ? daysAgoLabel(lastActivityAt) : null;
    if (recency) parts.push(`last activity ${recency}`);
    return parts.join(' · ') + '.';
  }

  // On hold — same shape as lost but framed in present tense.
  if (status === 'on_hold') {
    const when = stageChangedAt ?? updatedAt;
    const parts: string[] = [`On hold since ${fmtShort(when)}`];
    const recency = lastActivityAt ? daysAgoLabel(lastActivityAt) : null;
    if (recency) parts.push(`last activity ${recency}`);
    return parts.join(' · ') + '.';
  }

  // Active — the common case. "On <stage> since DATE · closes DATE · $X" or
  // "no close date set" / "no value set" when fields are blank.
  const parts: string[] = [];
  if (stageName) {
    const when = stageChangedAt ?? null;
    parts.push(when ? `On ${stageName} since ${fmtShort(when)}` : `On ${stageName}`);
  } else {
    parts.push('Active');
  }
  if (closeDate) {
    parts.push(`closes ${fmtShort(closeDate)}`);
  } else {
    parts.push('no close date set');
  }
  if (value != null) parts.push(formatCurrency(value));
  return parts.join(' · ') + '.';
}

/** "1 day ago" / "6 days ago" / "today" — keeps the status sentence calm. */
function daysAgoLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
