'use client';

/**
 * PropertyPhotoEditor — multi-image upload + featured-photo picker.
 *
 * One idea: by the time you click Save, you should see the house. Not a row.
 * The house.
 *
 * Convention enforced everywhere else in the app: `photos[0]` IS the
 * featured photo. The list page reads `property.photos[0]`. The detail hero
 * reads `property.photos[0]`. So "set as featured" here is just "move this
 * URL to index 0" — no separate flag, no `featuredPhotoIndex` column, no
 * `sortOrder` to keep consistent. The array order IS the order.
 *
 * Storage: posts to `/api/upload` with `type=property-photo`, which writes
 * to the `property-photos/{spaceId}/` prefix the storage-gc sweeper already
 * scans against `Property.photos`. No new migration, no new endpoint, no
 * new GC handler — vertical reuse of the existing chain.
 */

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Star, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Apple ease-out cubic — entrances, reorders. */
const EASE_APPLE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Hard cap so a runaway uploader can't push the form past the API's 20-URL ceiling. */
  max?: number;
}

const DEFAULT_MAX = 20;

export function PropertyPhotoEditor({ value, onChange, max = DEFAULT_MAX }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // URL of the tile the realtor just promoted to position 0 — drives a brief
  // 200ms cross-fade on the swapped image so the swap reads as a deliberate
  // beat, not a jump. Cleared after the animation completes.
  const [promotedUrl, setPromotedUrl] = useState<string | null>(null);

  const remaining = Math.max(0, max - value.length);
  const atCap = remaining === 0;

  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', 'property-photo');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      setError(data.error || 'Upload failed.');
      return null;
    }
    return data.url;
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the realtor re-pick the same file
    if (picked.length === 0) return;

    setError('');
    setUploading(true);

    // Truncate to `remaining` so we don't silently lose extras to the cap.
    const toUpload = picked.slice(0, remaining);
    if (picked.length > toUpload.length) {
      setError(`Only ${toUpload.length} more photo${toUpload.length === 1 ? '' : 's'} fit.`);
    }

    try {
      // Sequential, not parallel — keeps order predictable (first picked
      // lands first in the array) and avoids hammering the upload route
      // (which is rate-limited at 10/min per user).
      const collected: string[] = [];
      for (const file of toUpload) {
        const url = await uploadOne(file);
        if (url) collected.push(url);
        else break; // first failure halts the batch
      }
      if (collected.length > 0) onChange([...value, ...collected]);
    } finally {
      setUploading(false);
    }
  }

  function setFeatured(idx: number) {
    if (idx === 0) return;
    const next = [...value];
    const [picked] = next.splice(idx, 1);
    next.unshift(picked);
    onChange(next);
    // Trigger the cross-fade beat on the swapped tile. The clear lines up with
    // the 200ms reorder animation so the next swap starts from a clean state.
    setPromotedUrl(picked);
    setTimeout(() => setPromotedUrl(null), 240);
  }

  function remove(idx: number) {
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleFiles}
        className="hidden"
      />

      {/* Empty state: one calm tile that doubles as the upload trigger.
          No call-out card, no instructional copy. The tile teaches itself. */}
      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || atCap}
          className={cn(
            'flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg',
            'border border-dashed border-border/70 bg-muted/20 text-muted-foreground',
            'transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {uploading ? (
            <Loader2 size={20} className="animate-spin" aria-hidden />
          ) : (
            <>
              <Plus size={20} aria-hidden />
              <span className="text-xs">Add photos</span>
              <span className="text-[10px] text-muted-foreground/70">
                PNG / JPEG / WebP, up to 5MB
              </span>
            </>
          )}
        </button>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <AnimatePresence initial={false}>
            {value.map((url, idx) => {
              const isFeatured = idx === 0;
              const isPromoted = promotedUrl === url;
              return (
                <motion.div
                  key={url}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.22, ease: EASE_APPLE }}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md border bg-muted',
                    isFeatured ? 'border-foreground' : 'border-border/70',
                  )}
                >
                  {/* The whole tile is a click target for "set as featured" —
                      except the featured tile, where the click is a no-op and
                      we drop the cursor hint to make that obvious. */}
                  <button
                    type="button"
                    onClick={() => setFeatured(idx)}
                    disabled={isFeatured}
                    aria-label={isFeatured ? 'Featured photo' : 'Set as featured photo'}
                    className={cn(
                      'block h-full w-full',
                      !isFeatured && 'cursor-pointer',
                    )}
                  >
                    {/* Image cross-fade dip on promote — 1 → 0.7 → 1 over the
                        200ms layout swap so the eye registers the position
                        change as a deliberate beat, not a jump. */}
                    <motion.img
                      src={url}
                      alt={isFeatured ? 'Featured property photo' : `Property photo ${idx + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      animate={isPromoted ? { opacity: [1, 0.7, 1] } : { opacity: 1 }}
                      transition={{ duration: 0.2, ease: EASE_APPLE }}
                    />
                  </button>

                  {/* Featured star — always shown on photos[0]. On hover for
                      non-featured tiles, a faint star appears as the "tap to
                      set as featured" hint. The motion.span keyed by
                      isFeatured re-mounts on toggle and plays a 0.9 → 1.0
                      scale pulse, 180ms — confirms the action without a
                      flash of color. */}
                  <motion.span
                    key={isFeatured ? 'featured' : 'idle'}
                    initial={isFeatured ? { scale: 0.9 } : false}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.18, ease: EASE_APPLE }}
                    className={cn(
                      'pointer-events-none absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-opacity duration-150',
                      isFeatured
                        ? 'bg-foreground text-background opacity-100'
                        : 'bg-foreground/70 text-background opacity-0 group-hover:opacity-100',
                    )}
                    aria-hidden
                  >
                    <Star size={11} className={isFeatured ? 'fill-current' : ''} />
                  </motion.span>

                  {/* Delete X — hover-only, top-right. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); remove(idx); }}
                    aria-label="Remove photo"
                    className={cn(
                      'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full',
                      'bg-foreground/70 text-background opacity-0 transition-opacity duration-150',
                      'hover:bg-foreground group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    <X size={11} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Add-more tile — same footprint as the photo tiles so the grid
              never reflows on upload. Disappears at cap. */}
          {!atCap && (
            <motion.button
              layout
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              transition={{ duration: 0.22, ease: EASE_APPLE }}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-md',
                'border border-dashed border-border/70 bg-muted/20 text-muted-foreground',
                'transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {uploading ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <>
                  <Plus size={16} aria-hidden />
                  <span className="text-[10px]">Add more</span>
                </>
              )}
            </motion.button>
          )}
        </div>
      )}

      {/* Hint line — only when there's at least one photo and we have room. */}
      {value.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {value.length === 1
            ? 'Tap a new photo to swap the featured one.'
            : 'Tap any photo to feature it. The starred one shows on cards and the listing page.'}
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
