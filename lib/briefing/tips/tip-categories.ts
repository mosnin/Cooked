/**
 * Tip categories — earned tips, never generic. Each category is a
 * specific gap in THIS realtor's data named in one Chippi-voiced
 * sentence with a deep-link action.
 *
 * Phase C1 ships six categories — five single-subject + one trend:
 *
 *   hot_lead_dormant      Hot lead, 7+ days since contact, no draft
 *   deal_closing_soon     Deal closing ≤7 days, no activity ≥5 days
 *   won_deal_review_ask   Won deal 14-30 days ago, no review-ask on file
 *   past_client_referral  Past client, ≥180 days quiet, won deal 6-18m ago
 *   unworked_tag          Tag with ≥5 contacts, none touched in ≥21 days
 *   overdue_pileup        ≥5 follow-ups ≥3 days overdue (trend tip)
 *
 * Phase C2 adds four multi-week trend tips. Each gates on
 * `spaceHasStabilityHistory` so a brand-new realtor can't fire
 * "your reply rate dropped" with two days of data:
 *
 *   reply_rate_decline    Reply rate dropped ≥15pt week-over-week,
 *                         prior week ≥10 sends.
 *   stage_stagnation      Every active deal in a stage has been there
 *                         21+ days, ≥3 deals in the stage. Per-stage.
 *   tour_conversion_drop  Share of completed tours converting to
 *                         application/offer dropped 20+pt vs. the
 *                         22-42-day baseline, ≥4 recent tours.
 *   source_dry_spell      A source that produced ≥5 contacts in the
 *                         prior 90 days has been silent 21+ days AND
 *                         that's ≥2x its median inter-arrival gap.
 *
 * Each category is a pure function that returns 0 or more Signal
 * candidates. The composer ranks across categories + applies cool-downs.
 */

import { supabase } from '@/lib/supabase';
import { HOT_LEAD_THRESHOLD } from '@/lib/constants';
import type { Signal } from '../types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(dateInput: string | Date | null): number | null {
  if (!dateInput) return null;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - date.getTime()) / MS_PER_DAY);
}

// ── 1. Hot lead gone dormant ─────────────────────────────────────────────────

export async function tipHotLeadDormant(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today.getTime() - 7 * MS_PER_DAY);

  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, leadScore, lastContactedAt')
    .eq('spaceId', spaceId)
    .is('brokerageId', null)
    .gte('leadScore', HOT_LEAD_THRESHOLD)
    .lt('lastContactedAt', sevenDaysAgo.toISOString())
    .order('leadScore', { ascending: false })
    .limit(5);

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; leadScore: number; lastContactedAt: string }>).map((c) => {
    const days = daysSince(c.lastContactedAt) ?? 7;
    const aboveHot = c.leadScore - HOT_LEAD_THRESHOLD;
    const confidence = aboveHot >= 10 && days >= 10 ? 0.92 : 0.8;
    return {
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence,
      subject: { id: c.id, name: c.name, href: `/contacts/${c.id}` },
      evidence: `Scored hot ${days} days ago. You haven't reached out since.`,
      tipCategory: 'hot_lead_dormant',
    };
  });
}

// ── 2. Deal closing soon with no recent touch ────────────────────────────────

export async function tipDealClosingSoonNoTouch(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysOut = new Date(today.getTime() + 7 * MS_PER_DAY).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const fiveDaysAgo = new Date(today.getTime() - 5 * MS_PER_DAY).toISOString();

  const { data, error } = await supabase
    .from('Deal')
    .select('id, title, closeDate, contactId')
    .eq('spaceId', spaceId)
    .eq('status', 'active')
    .gte('closeDate', todayStr)
    .lte('closeDate', sevenDaysOut);

  if (error || !data) return [];

  // For each, check ContactActivity recency.
  const signals: Signal[] = [];
  for (const deal of data as Array<{ id: string; title: string; closeDate: string; contactId: string | null }>) {
    if (!deal.contactId) continue;
    const { count } = await supabase
      .from('ContactActivity')
      .select('id', { count: 'exact', head: true })
      .eq('contactId', deal.contactId)
      .gte('createdAt', fiveDaysAgo);

    if ((count ?? 0) > 0) continue;

    const daysToClose = daysSince(deal.closeDate);
    const closeWord = daysToClose === 0 ? 'today' : daysToClose === -1 ? 'tomorrow' : `in ${Math.abs(daysToClose ?? 0)} days`;
    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 1,
      confidence: 0.9,
      subject: { id: deal.id, name: deal.title, href: `/deals/${deal.id}` },
      evidence: `Closes ${closeWord}. No contact activity in the last five days.`,
      tipCategory: 'deal_closing_soon',
    });
  }
  return signals;
}

// ── 3. Won deal with no review/testimonial ask ───────────────────────────────

export async function tipWonDealReviewAsk(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fourteenAgo = new Date(today.getTime() - 14 * MS_PER_DAY);
  const thirtyAgo = new Date(today.getTime() - 30 * MS_PER_DAY);

  const { data, error } = await supabase
    .from('Deal')
    .select('id, title, closeDate, contactId, status')
    .eq('spaceId', spaceId)
    .eq('status', 'won')
    .gte('closeDate', thirtyAgo.toISOString().slice(0, 10))
    .lte('closeDate', fourteenAgo.toISOString().slice(0, 10));

  if (error || !data) return [];

  const signals: Signal[] = [];
  for (const deal of data as Array<{ id: string; title: string; closeDate: string; contactId: string | null }>) {
    if (!deal.contactId) continue;
    // Has any ContactActivity note mentioned "review" or "testimonial"?
    const { data: notes } = await supabase
      .from('ContactActivity')
      .select('content')
      .eq('contactId', deal.contactId)
      .eq('type', 'note')
      .gte('createdAt', deal.closeDate)
      .limit(20);

    const hasReviewMention = (notes ?? []).some((n) => {
      const txt = ((n as { content: string }).content ?? '').toLowerCase();
      return txt.includes('review') || txt.includes('testimonial');
    });
    if (hasReviewMention) continue;

    const daysAgo = daysSince(deal.closeDate) ?? 14;
    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence: 0.86,
      subject: { id: deal.id, name: deal.title, href: `/deals/${deal.id}` },
      evidence: `Closed ${daysAgo} days ago. No review ask on file yet.`,
      tipCategory: 'won_deal_review_ask',
    });
  }
  return signals;
}

// ── 4. Past client referral window ───────────────────────────────────────────

export async function tipPastClientReferral(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date(today.getTime() - 180 * MS_PER_DAY);
  const eighteenMonthsAgo = new Date(today.getTime() - 540 * MS_PER_DAY);

  // Past clients = contacts with a won Deal closed 6-18 months ago, no
  // contact in 180+ days.
  const { data: deals } = await supabase
    .from('Deal')
    .select('id, contactId, closeDate, title')
    .eq('spaceId', spaceId)
    .eq('status', 'won')
    .gte('closeDate', eighteenMonthsAgo.toISOString().slice(0, 10))
    .lte('closeDate', sixMonthsAgo.toISOString().slice(0, 10));

  if (!deals || deals.length === 0) return [];

  const signals: Signal[] = [];
  for (const deal of deals as Array<{ id: string; contactId: string | null; closeDate: string; title: string }>) {
    if (!deal.contactId) continue;
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, name, lastContactedAt')
      .eq('id', deal.contactId)
      .maybeSingle();

    if (!contact) continue;
    const lastContactDays = daysSince((contact as { lastContactedAt: string | null }).lastContactedAt);
    if (lastContactDays === null || lastContactDays < 180) continue;

    const closeDays = daysSince(deal.closeDate) ?? 180;
    const months = Math.round(closeDays / 30);
    const confidence = closeDays <= 365 ? 0.88 : 0.78;
    const name = (contact as { name: string }).name;

    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 3,
      confidence,
      subject: { id: contact.id as string, name, href: `/contacts/${contact.id}` },
      evidence: `You closed with ${name} ${months} months ago. They're in the referral window.`,
      tipCategory: 'past_client_referral',
    });
  }
  return signals;
}

// ── 5. Unworked tag — a segment the realtor hasn't touched ───────────────────

export async function tipUnworkedTag(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twentyOneAgo = new Date(today.getTime() - 21 * MS_PER_DAY);

  // Pull all non-brokerage contacts and bucket by tag.
  const { data, error } = await supabase
    .from('Contact')
    .select('id, tags, lastContactedAt, leadScore')
    .eq('spaceId', spaceId)
    .is('brokerageId', null);

  if (error || !data) return [];

  type Row = { id: string; tags: string[] | null; lastContactedAt: string | null; leadScore: number | null };
  const tagBuckets = new Map<string, { count: number; recentTouches: number; avgScore: number }>();

  for (const row of data as Row[]) {
    const tags = Array.isArray(row.tags) ? row.tags : [];
    for (const tag of tags) {
      // Skip system tags — they're not segments the realtor curated.
      if (tag === 'new-lead' || tag === 'application-link' || tag.startsWith('_')) continue;
      const bucket = tagBuckets.get(tag) ?? { count: 0, recentTouches: 0, avgScore: 0 };
      bucket.count += 1;
      bucket.avgScore += row.leadScore ?? 0;
      const touched = row.lastContactedAt && new Date(row.lastContactedAt) > twentyOneAgo;
      if (touched) bucket.recentTouches += 1;
      tagBuckets.set(tag, bucket);
    }
  }

  const signals: Signal[] = [];
  for (const [tag, bucket] of tagBuckets.entries()) {
    if (bucket.count < 5 || bucket.recentTouches > 0) continue;
    const avgScore = bucket.count > 0 ? bucket.avgScore / bucket.count : 0;
    if (avgScore < 40) continue; // skip cold segments

    const confidence = bucket.count >= 10 ? 0.88 : 0.78;
    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 3,
      confidence,
      subject: { id: `tag:${tag}`, name: `Tag "${tag}"`, href: `/contacts?tag=${encodeURIComponent(tag)}` },
      evidence: `${bucket.count} contacts tagged "${tag}". None touched in three weeks.`,
      tipCategory: 'unworked_tag',
    });
  }
  return signals;
}

// ── 6. Overdue follow-ups piling up — the only trend tip in C1 ──────────────

export async function tipOverduePileup(spaceId: string): Promise<Signal[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threeAgo = new Date(today.getTime() - 3 * MS_PER_DAY).toISOString();

  const { count, error } = await supabase
    .from('Contact')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .is('brokerageId', null)
    .lt('followUpAt', threeAgo);

  if (error) return [];
  const overdue = count ?? 0;
  if (overdue < 5) return [];

  const confidence = overdue >= 10 ? 0.88 : 0.82;
  return [
    {
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence,
      // Trend tips have no named subject — the subject is the realtor's
      // own backlog. Cool-down is per (category, null).
      subject: {
        id: 'overdue_pileup',
        name: `${overdue} overdue follow-ups`,
        href: '/contacts?filter=overdue',
      },
      evidence: `${overdue} follow-ups are more than three days late.`,
      tipCategory: 'overdue_pileup',
    },
  ];
}

// ── Trend-tip helpers (pure, testable) ───────────────────────────────────────
// Pulled out so the four trend functions stay thin and the math (rate
// computation, denominator floor, median cadence) is testable without a
// Supabase mock.

const MIN_STABILITY_DAYS = 21;

/** New-space gate. True when the space has 21+ days of history (drafts
 *  or contacts) — premature data would fire fake trends. */
export async function spaceHasStabilityHistory(spaceId: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() - MIN_STABILITY_DAYS * MS_PER_DAY).toISOString();

  const { count: draftCount } = await supabase
    .from('AgentDraft')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .lt('createdAt', cutoff);
  if ((draftCount ?? 0) > 0) return true;

  const { count: contactCount } = await supabase
    .from('Contact')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .is('brokerageId', null)
    .lt('createdAt', cutoff);
  return (contactCount ?? 0) > 0;
}

export function replyRate(sends: number, replies: number): number {
  return sends <= 0 ? 0 : replies / sends;
}

/** Percentage points between two rates. Positive = decline. */
export function rateDropPoints(prior: number, current: number): number {
  return Math.round((prior - current) * 100);
}

/** Spec floor: prior week needs 10+ sends or noise swamps the comparison. */
export function isReplyRateSampleStable(priorSends: number): boolean {
  return priorSends >= 10;
}

/** 0.80 at 15pt drop / 10+ sends, 0.90 at 25+pt drop / 20+ sends. */
export function replyRateConfidence(dropPoints: number, priorSends: number): number {
  return dropPoints >= 25 && priorSends >= 20 ? 0.9 : 0.8;
}

/** 0.85 at 3 deals / 21+ days, 0.92 at 5+ deals / 30+ days. */
export function stageStagnationConfidence(deals: number, maxDaysInStage: number): number {
  return deals >= 5 && maxDaysInStage >= 30 ? 0.92 : 0.85;
}

/** 0.78 at 4 tours, 0.88 at 6+. */
export function tourConversionConfidence(recentTours: number): number {
  return recentTours >= 6 ? 0.88 : 0.78;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Day gaps between consecutive millis timestamps (input must be sorted asc). */
export function interArrivalDays(timestampsAsc: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < timestampsAsc.length; i += 1) {
    gaps.push((timestampsAsc[i] - timestampsAsc[i - 1]) / MS_PER_DAY);
  }
  return gaps;
}

// ── 7. Reply rate declining week-over-week ───────────────────────────────────

const REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

export async function tipReplyRateDecline(spaceId: string): Promise<Signal[]> {
  if (!(await spaceHasStabilityHistory(spaceId))) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenAgo = new Date(today.getTime() - 7 * MS_PER_DAY);
  const fourteenAgo = new Date(today.getTime() - 14 * MS_PER_DAY);

  const { data: drafts, error } = await supabase
    .from('AgentDraft')
    .select('contactId, createdAt')
    .eq('spaceId', spaceId)
    .eq('status', 'sent')
    .gte('createdAt', fourteenAgo.toISOString())
    .lt('createdAt', today.toISOString());

  if (error || !drafts) return [];

  type DraftRow = { contactId: string | null; createdAt: string };
  const rows = (drafts as DraftRow[]).filter((d) => d.contactId);
  const current = rows.filter((d) => new Date(d.createdAt) >= sevenAgo);
  const prior = rows.filter((d) => new Date(d.createdAt) < sevenAgo);

  // Denominator stability before we touch the activity table.
  if (!isReplyRateSampleStable(prior.length)) return [];

  const contactIds = Array.from(new Set(rows.map((d) => d.contactId as string)));
  if (contactIds.length === 0) return [];

  const { data: activities } = await supabase
    .from('ContactActivity')
    .select('contactId, type, createdAt')
    .eq('spaceId', spaceId)
    .in('contactId', contactIds)
    .in('type', ['note', 'email', 'call'])
    .gte('createdAt', fourteenAgo.toISOString());

  type ActivityRow = { contactId: string; type: string; createdAt: string };
  const actsByContact = new Map<string, ActivityRow[]>();
  for (const a of (activities ?? []) as ActivityRow[]) {
    const list = actsByContact.get(a.contactId) ?? [];
    list.push(a);
    actsByContact.set(a.contactId, list);
  }

  const countReplies = (sends: DraftRow[]): number =>
    sends.reduce((n, send) => {
      const sendTime = new Date(send.createdAt).getTime();
      const contactActs = actsByContact.get(send.contactId as string) ?? [];
      const hit = contactActs.some((a) => {
        const t = new Date(a.createdAt).getTime();
        return t > sendTime && t - sendTime <= REPLY_WINDOW_MS;
      });
      return n + (hit ? 1 : 0);
    }, 0);

  const currentRate = replyRate(current.length, countReplies(current));
  const priorRate = replyRate(prior.length, countReplies(prior));
  const drop = rateDropPoints(priorRate, currentRate);
  if (drop < 15) return [];

  const priorPct = Math.round(priorRate * 100);
  const currentPct = Math.round(currentRate * 100);

  return [
    {
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence: replyRateConfidence(drop, prior.length),
      subject: {
        id: 'reply_rate_decline',
        name: 'Reply rate dropped',
        href: '/chippi/activity?filter=sent_no_reply',
      },
      evidence: `Your reply rate dropped from ${priorPct}% to ${currentPct}% this week. Sample is ${current.length} sends.`,
      tipCategory: 'reply_rate_decline',
    },
  ];
}

// ── 8. Stage stagnation — a pipeline stage where nothing has moved ──────────

export async function tipStageStagnation(spaceId: string): Promise<Signal[]> {
  if (!(await spaceHasStabilityHistory(spaceId))) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: deals, error } = await supabase
    .from('Deal')
    .select('id, stageId, stageChangedAt')
    .eq('spaceId', spaceId)
    .eq('status', 'active');

  if (error || !deals) return [];

  type DealRow = { id: string; stageId: string; stageChangedAt: string | null };

  // Bucket by stage. A stage is stagnant only if EVERY active deal in it
  // has stageChangedAt 21+ days ago.
  const stageBuckets = new Map<string, { count: number; oldestDays: number; allStagnant: boolean }>();
  for (const d of deals as DealRow[]) {
    const bucket = stageBuckets.get(d.stageId) ?? { count: 0, oldestDays: 0, allStagnant: true };
    bucket.count += 1;
    const days = daysSince(d.stageChangedAt);
    if (days === null || days < 21) {
      bucket.allStagnant = false;
    } else if (days > bucket.oldestDays) {
      bucket.oldestDays = days;
    }
    stageBuckets.set(d.stageId, bucket);
  }

  const stagnantStageIds: string[] = [];
  for (const [stageId, bucket] of stageBuckets.entries()) {
    if (bucket.count >= 3 && bucket.allStagnant) stagnantStageIds.push(stageId);
  }
  if (stagnantStageIds.length === 0) return [];

  // Resolve stage names in one shot.
  const { data: stages } = await supabase
    .from('DealStage')
    .select('id, name')
    .in('id', stagnantStageIds);
  const stageNameById = new Map(
    ((stages ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );

  const signals: Signal[] = [];
  for (const stageId of stagnantStageIds) {
    const bucket = stageBuckets.get(stageId);
    if (!bucket) continue;
    const stageName = stageNameById.get(stageId);
    if (!stageName) continue;

    const confidence = stageStagnationConfidence(bucket.count, bucket.oldestDays);
    const weeks = Math.floor(bucket.oldestDays / 7);
    const weekWord = weeks === 1 ? 'week' : 'weeks';

    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence,
      subject: {
        id: `stage:${stageId}`,
        name: stageName,
        href: `/deals?stage=${encodeURIComponent(stageId)}`,
      },
      evidence: `Every deal in ${stageName} has been there ${weeks}+ ${weekWord}. ${bucket.count} deals, no movement.`,
      tipCategory: 'stage_stagnation',
    });
  }
  return signals;
}

// ── 9. Tour conversion drop — fewer post-tour applications/offers ───────────

export async function tipTourConversionDrop(spaceId: string): Promise<Signal[]> {
  if (!(await spaceHasStabilityHistory(spaceId))) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentStart = new Date(today.getTime() - 21 * MS_PER_DAY);
  const baselineStart = new Date(today.getTime() - 42 * MS_PER_DAY);
  const baselineEnd = new Date(today.getTime() - 22 * MS_PER_DAY);

  type TourRow = { id: string; contactId: string | null; endsAt: string };
  const fetchTours = async (from: Date, to: Date) => {
    const { data } = await supabase
      .from('Tour')
      .select('id, contactId, endsAt')
      .eq('spaceId', spaceId)
      .eq('status', 'completed')
      .gte('endsAt', from.toISOString())
      .lt('endsAt', to.toISOString());
    return ((data ?? []) as TourRow[]).filter((t) => t.contactId);
  };
  const recent = await fetchTours(recentStart, today);
  const baseline = await fetchTours(baselineStart, baselineEnd);

  // Sample stability — both windows need a real shape to compare.
  if (recent.length < 4 || baseline.length < 4) return [];

  const allContactIds = Array.from(
    new Set([...recent, ...baseline].map((t) => t.contactId as string)),
  );

  // Conversion = an AgentDraft tagged application/offer within 7 days,
  // OR a Deal stage move within 7 days. Both because some realtors stage
  // applications as deal moves; others draft them as messages.
  const { data: drafts } = await supabase
    .from('AgentDraft')
    .select('contactId, channel, subject, createdAt')
    .eq('spaceId', spaceId)
    .in('contactId', allContactIds)
    .gte('createdAt', baselineStart.toISOString());

  type DraftRow = { contactId: string; channel: string; subject: string | null; createdAt: string };
  const draftRows = ((drafts ?? []) as DraftRow[]).filter((d) =>
    /application|offer/i.test(`${d.channel} ${d.subject ?? ''}`),
  );

  const { data: deals } = await supabase
    .from('Deal')
    .select('id, contactId, stageChangedAt')
    .eq('spaceId', spaceId)
    .in('contactId', allContactIds);
  type DealRow = { id: string; contactId: string; stageChangedAt: string | null };
  const dealRows = (deals ?? []) as DealRow[];

  const converted = (tour: TourRow): boolean => {
    const tourEnd = new Date(tour.endsAt).getTime();
    const within7 = (whenIso: string | null): boolean => {
      if (!whenIso) return false;
      const t = new Date(whenIso).getTime();
      return t > tourEnd && t - tourEnd <= 7 * MS_PER_DAY;
    };
    return (
      draftRows.some((d) => d.contactId === tour.contactId && within7(d.createdAt)) ||
      dealRows.some((d) => d.contactId === tour.contactId && within7(d.stageChangedAt))
    );
  };

  const recentConverted = recent.filter(converted).length;
  const baselineConverted = baseline.filter(converted).length;

  const recentRate = replyRate(recent.length, recentConverted);
  const baselineRate = replyRate(baseline.length, baselineConverted);
  const drop = rateDropPoints(baselineRate, recentRate);

  if (drop < 20) return [];

  const confidence = tourConversionConfidence(recent.length);
  const baselineFraction = `${baselineConverted} in ${baseline.length}`;
  const recentMovedWord = recentConverted === 0 ? 'None' : String(recentConverted);

  return [
    {
      source: 'tips',
      kind: 'tip',
      urgency: 2,
      confidence,
      subject: {
        id: 'tour_conversion_drop',
        name: 'Tour conversion dropped',
        href: '/deals?status=tour_completed',
      },
      evidence: `${recent.length} tours last three weeks. ${recentMovedWord} moved to application. Last quarter the rate was ${baselineFraction}.`,
      tipCategory: 'tour_conversion_drop',
    },
  ];
}

// ── 10. Source dry spell — a normally-productive source has gone quiet ──────

export async function tipSourceDrySpell(spaceId: string): Promise<Signal[]> {
  if (!(await spaceHasStabilityHistory(spaceId))) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ninetyAgo = new Date(today.getTime() - 90 * MS_PER_DAY);

  const { data, error } = await supabase
    .from('Contact')
    .select('sourceLabel, createdAt')
    .eq('spaceId', spaceId)
    .is('brokerageId', null)
    .not('sourceLabel', 'is', null)
    .gte('createdAt', ninetyAgo.toISOString());

  if (error || !data) return [];

  type Row = { sourceLabel: string | null; createdAt: string };
  const byLabel = new Map<string, number[]>();
  for (const row of data as Row[]) {
    if (!row.sourceLabel) continue;
    const list = byLabel.get(row.sourceLabel) ?? [];
    list.push(new Date(row.createdAt).getTime());
    byLabel.set(row.sourceLabel, list);
  }

  const signals: Signal[] = [];
  for (const [label, timestamps] of byLabel.entries()) {
    if (timestamps.length < 5) continue;
    timestamps.sort((a, b) => a - b);

    const newest = timestamps[timestamps.length - 1];
    const daysSinceLast = Math.floor((today.getTime() - newest) / MS_PER_DAY);
    if (daysSinceLast < 21) continue;

    const med = median(interArrivalDays(timestamps));
    if (med <= 0) continue;
    // 21 days must be at least 2x the source's median gap. Otherwise
    // this is a high-variance source and 21 days is normal noise.
    if (daysSinceLast < 2 * med) continue;

    signals.push({
      source: 'tips',
      kind: 'tip',
      urgency: 3,
      confidence: 0.82,
      subject: {
        id: `source:${label}`,
        name: label,
        href: '/settings/integrations',
      },
      evidence: `${label} has been silent ${daysSinceLast} days. Your prior median was ${Math.round(med)}.`,
      tipCategory: 'source_dry_spell',
    });
  }
  return signals;
}

export const ALL_TIP_CATEGORIES = [
  tipHotLeadDormant,
  tipDealClosingSoonNoTouch,
  tipWonDealReviewAsk,
  tipPastClientReferral,
  tipUnworkedTag,
  tipOverduePileup,
  tipReplyRateDecline,
  tipStageStagnation,
  tipTourConversionDrop,
  tipSourceDrySpell,
];
