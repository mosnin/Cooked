import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * BentoGrid / BentoCard — MagicUI bento, re-skinned to Chippi's system.
 *
 * Changes from the upstream default: our tokens (foreground / muted-
 * foreground / card / border / brand) instead of hardcoded neutrals; the
 * canonical content radius (rounded-3xl); lucide instead of radix icons;
 * a hairline + soft marketing shadow instead of the heavy inset glow. Card
 * titles stay sans-semibold (serif Times is reserved for page/section
 * headings — scarcity is the rule).
 */

interface BentoGridProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
  className?: string;
}

interface BentoCardProps extends ComponentPropsWithoutRef<'div'> {
  name: string;
  className?: string;
  background: ReactNode;
  Icon: React.ElementType;
  description: string;
  href: string;
  cta: string;
}

function BentoGrid({ children, className, ...props }: BentoGridProps) {
  return (
    <div
      className={cn('grid w-full auto-rows-[24rem] grid-cols-3 gap-4 md:gap-5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function BentoCard({
  name,
  className,
  background,
  Icon,
  description,
  href,
  cta,
  ...props
}: BentoCardProps) {
  return (
    <div
      className={cn(
        'group relative col-span-3 flex flex-col justify-between overflow-hidden rounded-3xl',
        'bg-card ring-1 ring-border/70',
        'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.10)]',
        'transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_48px_-16px_rgba(0,0,0,0.16)]',
        className,
      )}
      {...props}
    >
      {/* Rich visual layer — sits behind the text, pinned to the top of the card. */}
      <div className="pointer-events-none absolute inset-0">{background}</div>

      <div className="pointer-events-none relative z-10 mt-auto p-6 md:p-7">
        <div className="flex transform-gpu flex-col gap-3 transition-transform duration-300 ease-out lg:group-hover:-translate-y-9">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand transition-transform duration-300 ease-out group-hover:scale-90">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <h3 className="mt-1 text-[19px] font-semibold tracking-tight text-foreground">{name}</h3>
          <p className="max-w-md text-[14px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>

      {/* Hover-revealed CTA — the Apple beat. */}
      <div className="pointer-events-none absolute bottom-0 z-10 flex w-full translate-y-8 transform-gpu items-center p-6 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 md:p-7">
        <Link
          href={href}
          className="pointer-events-auto inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground"
        >
          {cta}
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Whole-card hover tint. */}
      <div className="pointer-events-none absolute inset-0 transition-colors duration-300 group-hover:bg-foreground/[0.015]" />
    </div>
  );
}

export { BentoCard, BentoGrid };
