'use client';

/**
 * Broker kanban card.
 *
 * Mirrors the realtor DealCard visual vocabulary exactly — same layout,
 * same serif value, same health dot, same days-in-stage line — with two
 * additions: a realtor byline below the address, and no drag handle (the
 * broker is read-only, no restaging). The card is intentionally a replica,
 * not a wrapper around DealCard, because DealCard is coupled to @dnd-kit/sortable.
 */

import { motion } from 'framer-motion';
import { EASE_APPLE } from '@/lib/motion';
import { TITLE_FONT } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCompact } from '@/lib/formatting';
import { dealHealth, HEALTH_META } from '@/lib/deals/health';

export interface BrokerDealItem {
  id: string;
  title: string;
  address: string | null;
  value: number | null;
  commissionRate: number | null;
  status: 'active' | 'won' | 'lost' | 'on_hold';
  stageChangedAt: Date | null;
  updatedAt: Date;
  closeDate: Date | null;
  followUpAt: Date | null;
  nextAction: string | null;
  nextActionDueAt: Date | null;
  /** Owning realtor display name. */
  realtorName: string;
}

interface BrokerDealCardProps {
  deal: BrokerDealItem;
  /** Index for initial-mount stagger. Null = single add, no delay. */
  entranceIndex?: number | null;
  onClick: (deal: BrokerDealItem) => void;
}

/** Days a deal has sat in the current stage. Null when there's no date. */
function daysInStage(deal: BrokerDealItem): number | null {
  const ref = deal.stageChangedAt ?? deal.updatedAt;
  if (!ref) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(ref);
  base.setHours(0, 0, 0, 0);
  const d = Math.floor((today.getTime() - base.getTime()) / 86_400_000);
  return d >= 0 ? d : null;
}

export function BrokerDealCard({
  deal,
  entranceIndex = null,
  onClick,
}: BrokerDealCardProps) {
  const staggerDelay =
    entranceIndex !== null && entranceIndex < 8 ? entranceIndex * 0.03 : 0;

  const health = dealHealth({
    status: deal.status,
    stageChangedAt: deal.stageChangedAt,
    updatedAt: deal.updatedAt,
    closeDate: deal.closeDate,
    followUpAt: deal.followUpAt,
    nextAction: deal.nextAction,
    nextActionDueAt: deal.nextActionDueAt,
  });
  const healthMeta = HEALTH_META[health.state];
  const isActive = deal.status === 'active';

  const days = daysInStage(deal);
  const gci =
    deal.value != null && deal.commissionRate != null
      ? (deal.value * deal.commissionRate) / 100
      : null;

  return (
    <motion.div
      className="mb-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_APPLE } }}
      transition={{ duration: 0.2, ease: EASE_APPLE, delay: staggerDelay }}
    >
      <div
        className={cn(
          'group bg-background border border-border/70 rounded-md p-3 cursor-pointer',
          'transition-colors duration-150',
          'hover:bg-foreground/[0.04]',
          deal.status === 'won' && 'opacity-75',
          deal.status === 'lost' && 'opacity-55',
          deal.status === 'on_hold' && 'opacity-70',
        )}
        onClick={() => onClick(deal)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(deal);
          }
        }}
      >
        {/* Title row with health dot */}
        <div className="flex items-center gap-1.5">
          {isActive && (
            <span
              className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', healthMeta.dotClass)}
              title={health.reason ? `${healthMeta.label}: ${health.reason}` : healthMeta.label}
              aria-label={`Health: ${healthMeta.label}${health.reason ? `, ${health.reason}` : ''}`}
            />
          )}
          <p
            className={cn(
              'text-sm font-medium leading-tight truncate text-foreground',
              deal.status === 'lost' && 'line-through text-muted-foreground',
            )}
          >
            {deal.title}
          </p>
        </div>

        {/* Address */}
        {deal.address && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{deal.address}</p>
        )}

        {/* Focal value — serif Times, matches realtor card */}
        {deal.value != null && (
          <p
            className="text-base tabular-nums text-foreground mt-1.5 leading-none"
            style={TITLE_FONT}
          >
            {formatCurrency(deal.value)}
          </p>
        )}

        {/* GCI — quiet meta */}
        {gci != null && (
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            GCI {formatCompact(gci)}
          </p>
        )}

        {/* Days in stage — broker-specific signal */}
        {isActive && days != null && days > 0 && (
          <p
            className={cn(
              'text-[11px] tabular-nums mt-1',
              health.state === 'stuck'
                ? 'text-red-600 dark:text-red-400'
                : health.state === 'at-risk'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground',
            )}
          >
            {days}d in stage
          </p>
        )}

        {/* Realtor byline — the broker oversight addition */}
        <p className="text-[11px] text-muted-foreground truncate mt-1.5 flex items-center gap-1">
          <span
            className="w-1 h-1 rounded-full bg-muted-foreground/40 flex-shrink-0"
            aria-hidden
          />
          {deal.realtorName}
        </p>
      </div>
    </motion.div>
  );
}
