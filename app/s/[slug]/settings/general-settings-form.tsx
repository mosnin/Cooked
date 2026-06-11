'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Space } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  BODY_MUTED,
  CAPTION,
  FIELD_RHYTHM,
  PRIMARY_PILL,
} from '@/lib/typography';

interface GeneralSettingsFormProps {
  space: Space;
}

/**
 * Danger zone — delete the entire workspace. Typed-confirmation modal so a
 * misclick can't destroy the space. The button alone is too cheap to trust;
 * the realtor has to type the name back to prove intent. Matches the
 * AlertDialog pattern from components/deals/deal-delete-button.tsx.
 */
export function DangerZone({ space }: { space: Space }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const nameMatches = confirmText.trim() === space.name.trim();

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!nameMatches) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/spaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: space.slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Couldn't delete the workspace. Try again.");
        setDeleting(false);
        return;
      }
      setOpen(false);
      router.push('/');
    } catch {
      toast.error('Lost the connection. Check it and try again.');
      setDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setOpen(next);
        if (!next) setConfirmText('');
      }}
    >
      <div className="space-y-3">
        <p className={BODY_MUTED}>
          Deleting your space is permanent. Every client, deal, and note goes
          with it. I can&apos;t bring it back.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={deleting}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium',
            'bg-destructive text-white hover:bg-destructive/90 active:scale-[0.98] transition-all duration-150',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
          Delete space
        </button>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{space.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Every client, deal, note, and integration goes with it. This cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-space-name" className="text-[12.5px] font-medium text-foreground">
            Type the workspace name to confirm
          </Label>
          <Input
            id="confirm-space-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={space.name}
            autoComplete="off"
            disabled={deleting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting || !nameMatches}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            {deleting ? 'Deleting' : 'Delete workspace'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function GeneralSettingsForm({ space }: GeneralSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(space.name);
  const [newSlug, setNewSlug] = useState(space.slug);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const checkSlug = useCallback(
    async (value: string) => {
      if (value === space.slug) {
        setSlugAvailable(null);
        return;
      }
      if (value.length < 3) {
        setSlugAvailable(null);
        return;
      }
      setCheckingSlug(true);
      try {
        const res = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_slug', slug: value }),
        });
        const data = await res.json();
        setSlugAvailable(data.available);
      } finally {
        setCheckingSlug(false);
      }
    },
    [space.slug],
  );

  useEffect(() => {
    const timer = setTimeout(() => checkSlug(newSlug), 400);
    return () => clearTimeout(timer);
  }, [newSlug, checkSlug]);

  const slugChanged = newSlug !== space.slug;
  const slugValid = !slugChanged || (slugChanged && newSlug.length >= 3 && slugAvailable === true);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/spaces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: space.slug,
          newSlug: slugChanged ? newSlug : undefined,
          name,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setSlugAvailable(false);
          setSaveError('That slug was just taken. Pick a different one.');
          return;
        }
        setSaveError(data.error || "Couldn't save those settings. Try again.");
        return;
      }
      const updated = await res.json().catch(() => ({}));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (slugChanged && updated.slug) {
        router.replace(`/s/${updated.slug}/settings`);
      } else {
        router.refresh();
      }
    } catch {
      setSaveError('Network hiccup. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div className={FIELD_RHYTHM}>
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-[12.5px] font-medium text-foreground">
            Workspace name
          </Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slug" className="text-[12.5px] font-medium text-foreground">
            Slug
          </Label>
          <div className="relative">
            <Input
              id="slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="pr-16"
            />
            {slugChanged && newSlug.length >= 3 && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {checkingSlug ? (
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                ) : slugAvailable === true ? (
                  <CheckCircle2 size={14} className="text-foreground" />
                ) : slugAvailable === false ? (
                  <span className="text-xs font-medium text-destructive">taken</span>
                ) : null}
              </div>
            )}
          </div>
          <p className={CAPTION}>Your intake link: chippi.com/apply/{newSlug}</p>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !slugValid}
            className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving' : saved ? 'Saved' : 'Save changes'}
          </button>
          {saved && <p className={BODY_MUTED}>Changes saved.</p>}
        </div>
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      </div>
    </form>
  );
}
