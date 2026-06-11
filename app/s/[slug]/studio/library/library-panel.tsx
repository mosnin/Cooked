'use client';

/**
 * LibraryPanel — /s/[slug]/studio/library. A gallery of the realtor's past
 * Studio generations, newest first.
 *
 * Paginated 60-at-a-time. Each tile carries an overflow menu with the four
 * canonical actions: Duplicate (re-render in Create with the same prompt),
 * Schedule (queue a post from this asset), Edit (open in Edit), Delete
 * (confirm-via-toast so the destructive default isn't a modal). Videos
 * show a poster (the metadata frame) with a play overlay; clicking opens
 * in a new tab so the native controls bar never eats the thumbnail.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ImagePlus,
  Trash2,
  Play,
  MoreHorizontal,
  Copy,
  CalendarClock,
  Pencil,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BODY_MUTED, CAPTION, PRIMARY_PILL } from '@/lib/typography';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';

interface LibraryItem {
  id: string;
  kind: string;
  model: string;
  prompt: string;
  fileId: string;
  createdAt: string;
  url: string | null;
}

interface LibraryResponse {
  items: LibraryItem[];
  nextOffset: number | null;
}

export function LibraryPanel() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPage = useCallback(async (offset: number): Promise<LibraryResponse> => {
    const res = await fetch(`/api/studio/library?offset=${offset}`);
    if (!res.ok) throw new Error('load failed');
    return (await res.json()) as LibraryResponse;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadPage(0);
        if (!cancelled) {
          setItems(data.items);
          setNextOffset(data.nextOffset);
        }
      } catch {
        if (!cancelled) setError('Could not load your library.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  async function handleLoadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await loadPage(nextOffset);
      setItems((prev) => [...prev, ...data.items]);
      setNextOffset(data.nextOffset);
    } catch {
      setError('Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  // Destructive but recoverable — a sonner toast with an inline confirm
  // beats a blocking modal for a single asset. Optimistic remove from the
  // grid happens only after the realtor confirms in the toast.
  function handleDeleteRequest(item: LibraryItem) {
    if (deletingId) return;
    const toastId = `delete-${item.fileId}`;
    toast(
      item.kind === 'video' ? 'Delete this video?' : 'Delete this image?',
      {
        id: toastId,
        description: 'This cannot be undone.',
        duration: 8000,
        action: {
          label: 'Delete',
          onClick: () => void performDelete(item.fileId, toastId),
        },
        cancel: {
          label: 'Cancel',
          onClick: () => toast.dismiss(toastId),
        },
      },
    );
  }

  async function performDelete(fileId: string, toastId: string) {
    setDeletingId(fileId);
    setError(null);
    toast.dismiss(toastId);
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Could not delete.');
      }
      setItems((prev) => prev.filter((i) => i.fileId !== fileId));
      toast.success('Deleted.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete.';
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  function handleDuplicate(item: LibraryItem) {
    if (!slug) return;
    const qs = new URLSearchParams();
    if (item.prompt) qs.set('prompt', item.prompt);
    if (item.model) qs.set('model', item.model);
    router.push(`/s/${slug}/studio/create?${qs.toString()}`);
  }

  function handleSchedule(item: LibraryItem) {
    if (!slug) return;
    router.push(`/s/${slug}/studio/schedule?fileId=${item.fileId}`);
  }

  function handleEdit(item: LibraryItem) {
    if (!slug) return;
    router.push(`/s/${slug}/studio/edit?fileId=${item.fileId}`);
  }

  if (loading) {
    return <p className={cn(BODY_MUTED, 'py-12 text-center')}>Loading…</p>;
  }
  if (error && items.length === 0) {
    return (
      <p className="py-12 text-center text-[12.5px] text-rose-700 dark:text-rose-400">
        {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ImagePlus}
        title="Nothing in your library yet."
        description="Images and video you generate in Studio collect here."
        action={
          slug
            ? { label: 'Create something', href: `/s/${slug}/studio/create` }
            : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header CTA — the realtor's eye lands here after scanning past
          work; the primary action sits inline so "make another one" is
          one click from any tile. */}
      <div className="flex items-center justify-between gap-3">
        <p className={BODY_MUTED}>
          {items.length} {items.length === 1 ? 'asset' : 'assets'}
        </p>
        {slug && (
          <Link
            href={`/s/${slug}/studio/create`}
            className={cn(PRIMARY_PILL, 'inline-flex items-center gap-1.5')}
          >
            <Plus size={14} aria-hidden />
            New image
          </Link>
        )}
      </div>

      {error && (
        <p className="text-[12.5px] text-rose-700 dark:text-rose-400 text-center">
          {error}
        </p>
      )}

      <StaggerList stagger={0.03} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <StaggerItem
            key={item.id}
            className="group relative rounded-xl border border-border/60 bg-card overflow-hidden"
          >
            <div className="aspect-square bg-muted/30 relative">
              {item.url ? (
                item.kind === 'video' ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full h-full"
                    aria-label={item.prompt || 'Open video'}
                  >
                    <video
                      src={item.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover pointer-events-none"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Play
                        className="w-8 h-8 text-white drop-shadow-md"
                        fill="currentColor"
                      />
                    </span>
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={item.prompt || 'Generated asset'}
                    className="w-full h-full object-cover"
                  />
                )
              ) : null}

              {/* Overflow menu — hover-revealed on desktop, always-tappable
                  on touch (focus-visible keeps it accessible). Houses the
                  four canonical actions so a tile is a real working
                  surface, not just a thumbnail-with-trash. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Asset actions"
                    disabled={deletingId === item.fileId}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-black/70 transition-opacity disabled:opacity-50 flex items-center justify-center"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => handleDuplicate(item)}>
                    <Copy />
                    <span>Duplicate</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleSchedule(item)}>
                    <CalendarClock />
                    <span>Schedule</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => handleEdit(item)}
                    disabled={item.kind === 'video'}
                  >
                    <Pencil />
                    <span>Edit</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => handleDeleteRequest(item)}
                    disabled={deletingId === item.fileId}
                  >
                    <Trash2 />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="px-2.5 py-2 space-y-1.5">
              {item.prompt && (
                <p className={cn(CAPTION, 'line-clamp-2')} title={item.prompt}>
                  {item.prompt}
                </p>
              )}
            </div>
          </StaggerItem>
        ))}
      </StaggerList>
      {nextOffset !== null && (
        <div className="flex justify-center pt-2">
          <Button onClick={() => void handleLoadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
