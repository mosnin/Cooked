import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ImagePlus, FileImage, FolderOpen, CalendarClock, Palette } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  SECTION_LABEL,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/motion/page-transition';

export const dynamic = 'force-dynamic';

/**
 * Studio landing — the home that explains what Studio is.
 *
 * Previously this route redirected straight to /create, which dropped the
 * realtor into a tool with zero context. Now it's the canonical realtor
 * page (muted greeting → serif H1 → status sentence) followed by a flat
 * grid of the five Studio workflows. Each card is a Link to a sub-route.
 *
 * Cards are paper-flat: hairline border, muted hover, no shadow. Matches
 * the canonical card vocabulary on the rest of the realtor surface.
 */
export default async function StudioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const workflows = [
    {
      href: `/s/${slug}/studio/create`,
      title: 'Create',
      subtitle: 'Type a prompt, get a hero photo for your post.',
      icon: ImagePlus,
    },
    {
      href: `/s/${slug}/studio/compose`,
      title: 'Compose',
      subtitle: 'Upload an image, get a social-ready caption.',
      icon: FileImage,
    },
    {
      href: `/s/${slug}/studio/library`,
      title: 'Library',
      subtitle: 'Re-use, duplicate, schedule from past work.',
      icon: FolderOpen,
    },
    {
      href: `/s/${slug}/studio/schedule`,
      title: 'Schedule',
      subtitle: 'Pick a time, Chippi posts when you are not online.',
      icon: CalendarClock,
    },
    {
      href: `/s/${slug}/studio/brand`,
      title: 'Brand',
      subtitle: 'Logo, colors, fonts — applied to every generation.',
      icon: Palette,
    },
  ] as const;

  return (
    <PageTransition className={cn('mx-auto max-w-5xl px-6 py-8', PAGE_RHYTHM)}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Studio.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Make your listings shine
        </h1>
        <p className={BODY_MUTED}>
          AI-generated photos, captions, and scheduled posts — all in one
          workflow.
        </p>
      </header>

      <section className="space-y-4">
        <p className={SECTION_LABEL}>Workflows</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {workflows.map((w) => {
            const Icon = w.icon;
            return (
              <Link
                key={w.href}
                href={w.href}
                className={cn(
                  'group rounded-xl border border-border/60 bg-card px-4 py-4',
                  'hover:bg-muted/30 transition-colors duration-150',
                )}
              >
                <div className="mb-3 w-9 h-9 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    className="text-muted-foreground group-hover:text-foreground transition-colors"
                  />
                </div>
                <p className="text-sm font-medium text-foreground">{w.title}</p>
                <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                  {w.subtitle}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </PageTransition>
  );
}
