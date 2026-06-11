'use client';

/**
 * GradientCard: the premium 3D-tilt dark card with the studio's ASCII
 * signature and a Chippi-orange bottom glow. Ported from fortitudo; the only
 * change is the palette (#F97316 → Chippi #ff964f / pale amber). It is a
 * deliberately DARK card, so it reads identically on both the light and dark
 * marketing canvas (same call as Chippi's existing black stats card). Reserved
 * for the home "what Chippi does" cards.
 */

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AsciiField } from './ascii-field';

// Shared Chippi-orange / amber edge-glow.
const glow = {
  rest: '0 0 15px 3px rgba(255,150,79,0.7), 0 0 25px 5px rgba(255,150,79,0.5), 0 0 35px 7px rgba(255,201,148,0.35)',
  hover:
    '0 0 20px 4px rgba(255,150,79,0.9), 0 0 30px 6px rgba(255,150,79,0.7), 0 0 40px 8px rgba(255,201,148,0.5)',
} as const;

export type GradientCardProps = {
  title: string;
  description: string;
  index?: number;
  meta?: string;
  href?: string;
  cta?: string;
  className?: string;
  children?: ReactNode;
};

export function GradientCard({
  title,
  description,
  index,
  meta,
  href,
  cta,
  className,
}: GradientCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setRotation({ x: -(y / rect.height) * 5, y: (x / rect.width) * 5 });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotation({ x: 0, y: 0 });
  };

  return (
    <motion.div
      ref={cardRef}
      className={cn(
        'relative h-full min-h-[400px] overflow-hidden rounded-marketing-3xl',
        className,
      )}
      style={{
        transformStyle: 'preserve-3d',
        backgroundColor: '#0d0e12',
        boxShadow: '0 24px 70px -30px rgba(255,150,79,0.30)',
      }}
      initial={{ y: 0 }}
      animate={{
        y: isHovered ? -5 : 0,
        rotateX: rotation.x,
        rotateY: rotation.y,
        perspective: 1000,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      {/* Dark base. */}
      <div className="absolute inset-0 z-0 bg-[linear-gradient(180deg,#000_0%,#000_70%)]" />

      {/* Signature ASCII field. */}
      <AsciiField className="absolute inset-0 z-[5] h-full w-full opacity-[0.13]" cell={13} />

      {/* Orange/amber bottom glow. */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-20 h-2/3"
        style={{
          background:
            'radial-gradient(ellipse at bottom right, rgba(255,150,79,0.6) -10%, rgba(255,150,79,0) 70%), radial-gradient(ellipse at bottom left, rgba(255,201,148,0.5) -10%, rgba(255,201,148,0) 70%)',
          filter: 'blur(40px)',
        }}
        animate={{ opacity: isHovered ? 0.95 : 0.8 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />

      {/* Bottom border highlight + glow. */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-25 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0.05) 100%)',
        }}
        animate={{ boxShadow: isHovered ? glow.hover : glow.rest, opacity: isHovered ? 1 : 0.9 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />

      {/* Content. */}
      <div className="relative z-40 flex h-full flex-col p-7">
        {index !== undefined && (
          <p className="font-brand text-sm tabular-nums text-brand">
            {String(index).padStart(2, '0')}
          </p>
        )}
        <div className="flex-1" />
        <div>
          <h3 className="font-brand text-2xl leading-tight text-white">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/65">{description}</p>
          {(meta || href) && (
            <div className="mt-5 flex items-center justify-between gap-3">
              {meta && <span className="font-brand text-sm text-brand">{meta}</span>}
              {href && (
                <Link
                  href={href}
                  className="group inline-flex items-center gap-1.5 text-sm font-medium text-white/90 hover:text-white"
                >
                  {cta ?? 'Learn more'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
