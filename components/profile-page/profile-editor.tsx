'use client';

/**
 * Editor for the realtor's public "link in bio" page (/p/[slug]).
 *
 * Reads and writes the ProfilePage row through /api/profile-page. Three
 * tabs split the surface so the realtor's mental model matches the page
 * itself:
 *
 *   Identity  → Profile photo, Headline, Verified badge, Social links
 *   Page      → Enabled toggle, Cover photo, section visibility toggles
 *   Content   → Custom links, Videos, Featured properties
 *
 * The Share row (URL + Copy + View) sits above the tabs — always-relevant
 * context, no tabbing needed.
 *
 * All three Content sections support drag-reorder via @dnd-kit. The array
 * order = render order on the public page.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowUpRight,
  Copy,
  Check,
  ImagePlus,
  Play,
  GripVertical,
  Home,
} from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { parseYouTubeId, youTubeThumbnail } from '@/lib/profile-page';
import { BODY_MUTED, CAPTION, PRIMARY_PILL } from '@/lib/typography';
import {
  SOCIAL_PLATFORMS,
  SOCIAL_LABELS,
  SOCIAL_PLACEHOLDERS,
  type SocialPlatform,
} from '@/components/profile-page/public-profile';

interface CustomLink {
  id: string;
  label: string;
  url: string;
  thumbnail: string;
}

interface VideoItem {
  id: string;
  url: string;
  title: string;
}

interface AvailableProperty {
  id: string;
  address: string;
  city: string | null;
  stateRegion: string | null;
  listPrice: number | null;
  photo: string | null;
}

const MAX_LINKS = 20;
const MAX_VIDEOS = 12;
const MAX_FEATURED = 12;

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatPrice(value: number | null): string | null {
  if (value == null || value <= 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function ProfileEditor({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [headline, setHeadline] = useState('');
  const [showIntake, setShowIntake] = useState(true);
  const [showTours, setShowTours] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [socialLinks, setSocialLinks] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [customLinks, setCustomLinks] = useState<CustomLink[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [featuredPropertyIds, setFeaturedPropertyIds] = useState<string[]>([]);
  const [availableProperties, setAvailableProperties] = useState<AvailableProperty[]>([]);
  // Cover photo is owned by its dedicated endpoint — updated independently
  // of the rest of the form (no "Save changes" required).
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverFileRef = useRef<HTMLInputElement>(null);
  // Profile photo — separate from the dashboard's realtorPhotoUrl. Owned by
  // a dedicated endpoint so the realtor can swap their public-page face
  // without disturbing the dashboard chrome / intake / booking photo.
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const [profilePhotoError, setProfilePhotoError] = useState('');
  const profilePhotoFileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);

  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Initial config load.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/profile-page');
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        if (!active) return;
        applyConfig(data);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function applyConfig(data: Record<string, unknown>) {
    setEnabled(data.enabled !== false);
    setHeadline(typeof data.headline === 'string' ? data.headline : '');
    setShowIntake(data.showIntake !== false);
    setShowTours(data.showTours !== false);
    setShowProperties(data.showProperties !== false);
    setIsVerified(data.isVerified === true);
    {
      const raw =
        data.socialLinks && typeof data.socialLinks === 'object' && !Array.isArray(data.socialLinks)
          ? (data.socialLinks as Record<string, unknown>)
          : {};
      const next: Partial<Record<SocialPlatform, string>> = {};
      for (const p of SOCIAL_PLATFORMS) {
        const v = raw[p];
        if (typeof v === 'string') next[p] = v;
      }
      setSocialLinks(next);
    }
    setCustomLinks(
      Array.isArray(data.customLinks)
        ? (data.customLinks as Partial<CustomLink>[]).map((l) => ({
            id: typeof l.id === 'string' && l.id ? l.id : newId(),
            label: typeof l.label === 'string' ? l.label : '',
            url: typeof l.url === 'string' ? l.url : '',
            thumbnail: typeof l.thumbnail === 'string' ? l.thumbnail : '',
          }))
        : [],
    );
    setVideos(
      Array.isArray(data.videos)
        ? (data.videos as Partial<VideoItem>[]).map((v) => ({
            id: typeof v.id === 'string' && v.id ? v.id : newId(),
            url: typeof v.url === 'string' ? v.url : '',
            title: typeof v.title === 'string' ? v.title : '',
          }))
        : [],
    );
    setFeaturedPropertyIds(
      Array.isArray(data.featuredPropertyIds)
        ? (data.featuredPropertyIds as unknown[]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          )
        : [],
    );
    if (Array.isArray(data.availableProperties)) {
      setAvailableProperties(
        (data.availableProperties as Partial<AvailableProperty>[]).map((p) => ({
          id: typeof p.id === 'string' ? p.id : '',
          address: typeof p.address === 'string' ? p.address : '',
          city: typeof p.city === 'string' ? p.city : null,
          stateRegion: typeof p.stateRegion === 'string' ? p.stateRegion : null,
          listPrice: typeof p.listPrice === 'number' ? p.listPrice : null,
          photo: typeof p.photo === 'string' ? p.photo : null,
        })).filter((p) => p.id),
      );
    }
    setCoverPhotoUrl(
      typeof data.coverPhotoUrl === 'string' && data.coverPhotoUrl ? data.coverPhotoUrl : null,
    );
    setProfilePhotoUrl(
      typeof data.profilePhotoUrl === 'string' && data.profilePhotoUrl
        ? data.profilePhotoUrl
        : null,
    );
  }

  async function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the realtor re-pick the same file
    if (!file) return;

    // Client-side check is a UX convenience — the server check is authoritative.
    if (file.size > 5 * 1024 * 1024) {
      setCoverError('Image must be 5 MB or smaller.');
      return;
    }
    if (!/^image\//.test(file.type)) {
      setCoverError('Pick an image file (PNG, JPEG, or WebP).');
      return;
    }

    setCoverError('');
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/profile-page/cover-photo', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCoverError(data.error || 'Upload failed.');
        return;
      }
      setCoverPhotoUrl(typeof data.url === 'string' ? data.url : null);
    } catch {
      setCoverError('Upload failed.');
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleCoverRemove() {
    setCoverError('');
    setCoverUploading(true);
    try {
      const res = await fetch('/api/profile-page/cover-photo', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCoverError(data.error || 'Could not remove cover.');
        return;
      }
      setCoverPhotoUrl(null);
    } catch {
      setCoverError('Could not remove cover.');
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleProfilePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setProfilePhotoError('Image must be 5 MB or smaller.');
      return;
    }
    if (!/^image\//.test(file.type)) {
      setProfilePhotoError('Pick an image file (PNG, JPEG, or WebP).');
      return;
    }
    setProfilePhotoError('');
    setProfilePhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/profile-page/profile-photo', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfilePhotoError(data.error || 'Upload failed.');
        return;
      }
      setProfilePhotoUrl(typeof data.url === 'string' ? data.url : null);
    } catch {
      setProfilePhotoError('Upload failed.');
    } finally {
      setProfilePhotoUploading(false);
    }
  }

  async function handleProfilePhotoRemove() {
    setProfilePhotoError('');
    setProfilePhotoUploading(true);
    try {
      const res = await fetch('/api/profile-page/profile-photo', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setProfilePhotoError(data.error || 'Could not remove photo.');
        return;
      }
      setProfilePhotoUrl(null);
    } catch {
      setProfilePhotoError('Could not remove photo.');
    } finally {
      setProfilePhotoUploading(false);
    }
  }

  function updateLink(id: string, patch: Partial<CustomLink>) {
    setCustomLinks((links) => links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLink(id: string) {
    setCustomLinks((links) => links.filter((l) => l.id !== id));
  }
  function addLink() {
    setCustomLinks((links) =>
      links.length >= MAX_LINKS
        ? links
        : [...links, { id: newId(), label: '', url: '', thumbnail: '' }],
    );
  }

  // Drag-to-reorder for all three lists (links, videos, featured
  // properties). The array order is the render order on the public page,
  // so reordering here IS the feature — Save changes persists. PointerSensor
  // handles mouse + pen, TouchSensor handles mobile (a 200ms hold so the
  // realtor can still scroll); 5px activation distance on the pointer
  // keeps small fidget clicks from starting a drag accidentally. One
  // sensor set, used by every DndContext on the page.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleLinkDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setCustomLinks((links) => {
      const oldIndex = links.findIndex((l) => l.id === active.id);
      const newIndex = links.findIndex((l) => l.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return links;
      return arrayMove(links, oldIndex, newIndex);
    });
  }

  function handleVideoDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setVideos((vs) => {
      const oldIndex = vs.findIndex((v) => v.id === active.id);
      const newIndex = vs.findIndex((v) => v.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return vs;
      return arrayMove(vs, oldIndex, newIndex);
    });
  }

  function handleFeaturedDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFeaturedPropertyIds((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return ids;
      return arrayMove(ids, oldIndex, newIndex);
    });
  }

  function updateVideo(id: string, patch: Partial<VideoItem>) {
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }
  function removeVideo(id: string) {
    setVideos((vs) => vs.filter((v) => v.id !== id));
  }
  function addVideo() {
    setVideos((vs) =>
      vs.length >= MAX_VIDEOS ? vs : [...vs, { id: newId(), url: '', title: '' }],
    );
  }

  function toggleFeatured(id: string) {
    setFeaturedPropertyIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= MAX_FEATURED) return ids; // capped — checkbox stays off
      return [...ids, id];
    });
  }

  // Index for O(1) lookup when rendering the featured-order list (it reads
  // the available-properties metadata by id).
  const propertyById = new Map(availableProperties.map((p) => [p.id, p]));
  // Featured rows in render order — drops ids that are no longer in the
  // active-listing set so the editor doesn't show ghost entries.
  const featuredRows = featuredPropertyIds
    .map((id) => propertyById.get(id))
    .filter((p): p is AvailableProperty => Boolean(p));

  const publicUrl = origin ? `${origin}/p/${slug}` : `/p/${slug}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the visible URL is still selectable */
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');

    const cleanedLinks = customLinks
      .map((l) => ({ ...l, label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label || l.url);
    if (cleanedLinks.some((l) => !l.label || !/^https?:\/\//i.test(l.url))) {
      setSaveError(
        'Each link needs a label and a URL that starts with http:// or https://.',
      );
      return;
    }

    const cleanedVideos = videos
      .map((v) => ({ ...v, url: v.url.trim(), title: v.title.trim() }))
      .filter((v) => v.url || v.title);
    if (cleanedVideos.some((v) => !parseYouTubeId(v.url))) {
      setSaveError('Each video needs a valid YouTube link.');
      return;
    }

    // Trim and validate social links — empty values are dropped (= unset
    // on the server). Anything non-empty must be a real http(s) URL so we
    // never persist an unclickable link.
    const cleanedSocial: Partial<Record<SocialPlatform, string>> = {};
    for (const p of SOCIAL_PLATFORMS) {
      const v = (socialLinks[p] ?? '').trim();
      if (!v) continue;
      if (!/^https?:\/\//i.test(v)) {
        setSaveError(`${SOCIAL_LABELS[p]} link needs to start with http:// or https://.`);
        return;
      }
      cleanedSocial[p] = v;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/profile-page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          headline: headline.trim() || null,
          showIntake,
          showTours,
          showProperties,
          isVerified,
          socialLinks: cleanedSocial,
          customLinks: cleanedLinks,
          videos: cleanedVideos,
          featuredPropertyIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Couldn't save. Try again.");
        return;
      }
      const data = await res.json();
      applyConfig(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Network hiccup. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm text-foreground">Couldn&apos;t load your page.</p>
        <p className={cn(CAPTION, 'mt-1')}>Usually temporary — refresh to try again.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-10">
      {/* ── Share ──────────────────────────────────────────────────────────
          Sits ABOVE the tabs — the URL and "view live" are always relevant
          regardless of which tab the realtor is on. The page-live toggle
          also lives here because it's a page-wide kill switch, not a tab
          concern. ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-base font-semibold">Your link</h2>
          <p className={BODY_MUTED}>
            Put this one link in your Instagram bio, email signature, or
            anywhere a lead might find you.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {publicUrl}
          </code>
          <button
            type="button"
            onClick={copyUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/40"
          >
            {copied ? (
              <>
                <Check size={13} className="text-foreground" />
                Copied
              </>
            ) : (
              <>
                <Copy size={13} />
                Copy
              </>
            )}
          </button>
          <a
            href={`/p/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/40"
          >
            View page
            <ArrowUpRight size={13} />
          </a>
        </div>
      </section>

      {/* ── Tabs ───────────────────────────────────────────────────────────
          Three tabs, line variant so the active state reads as the sliding
          underline (canon — see STYLESHEET, "Tabs … Sliding 2px underline").
          Short labels: Identity / Page / Content. ─────────────────────── */}
      <Tabs defaultValue="identity">
        <TabsList variant="line" className="w-full justify-start gap-4 border-b border-border/60">
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="page">Page</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
        </TabsList>

        {/* ── Identity tab ──────────────────────────────────────────────── */}
        <TabsContent value="identity" className="mt-8 space-y-12">
          {/* Profile photo */}
          <section className="space-y-4">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Profile photo</h2>
              <p className={BODY_MUTED}>
                The face on your public page. Separate from your workspace
                photo so you can swap one without changing the other.
              </p>
            </header>

            {profilePhotoUrl ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-full border border-border/70 bg-muted/20 w-32 h-32">
                  <img
                    src={profilePhotoUrl}
                    alt="Profile photo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => profilePhotoFileRef.current?.click()}
                    disabled={profilePhotoUploading}
                  >
                    {profilePhotoUploading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ImagePlus size={14} />
                    )}
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleProfilePhotoRemove}
                    disabled={profilePhotoUploading}
                  >
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => profilePhotoFileRef.current?.click()}
                  disabled={profilePhotoUploading}
                  className="flex h-32 w-32 items-center justify-center rounded-full border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {profilePhotoUploading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <ImagePlus size={18} />
                  )}
                </button>
              </div>
            )}

            <input
              ref={profilePhotoFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleProfilePhotoFile}
            />

            <p className={CAPTION}>PNG, JPEG, or WebP. Up to 5 MB. Square crop looks best.</p>
            {profilePhotoError && (
              <p className="text-xs text-destructive">{profilePhotoError}</p>
            )}
          </section>

          {/* Headline */}
          <section className="space-y-4 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Headline</h2>
              <p className={BODY_MUTED}>
                One line under your name. Your photo, logo, accent colour, and
                light/dark theme are inherited from your{' '}
                <a
                  href={`/s/${slug}/configure`}
                  className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                >
                  page appearance
                </a>{' '}
                — set your brand once and every public page matches.
              </p>
            </header>
            <div className="space-y-1.5">
              <Label
                htmlFor="headline"
                className="text-[12.5px] font-medium text-foreground"
              >
                Headline
              </Label>
              <Input
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Helping families find home in Austin."
                maxLength={200}
              />
              <p className={CAPTION}>Optional. Up to 200 characters.</p>
            </div>
          </section>

          {/* Verified badge + social links */}
          <section className="space-y-6 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Trust signals</h2>
              <p className={BODY_MUTED}>
                What sits with your name at the top of the page.
              </p>
            </header>

            <ToggleRow
              id="isVerified"
              checked={isVerified}
              onChange={setIsVerified}
              label="Verified badge"
              help="A small blue checkmark next to your name — a quiet trust signal for visitors."
            />

            <div className="space-y-3">
              <div>
                <p className="text-[12.5px] font-medium text-foreground">Social links</p>
                <p className={CAPTION}>
                  Add what you use. Empty fields are hidden — only the platforms with links show on
                  your page.
                </p>
              </div>
              <div className="space-y-2">
                {SOCIAL_PLATFORMS.map((platform) => (
                  <SocialRow
                    key={platform}
                    platform={platform}
                    value={socialLinks[platform] ?? ''}
                    onChange={(value) =>
                      setSocialLinks((prev) => ({ ...prev, [platform]: value }))
                    }
                  />
                ))}
              </div>
            </div>
          </section>
        </TabsContent>

        {/* ── Page tab ──────────────────────────────────────────────────── */}
        <TabsContent value="page" className="mt-8 space-y-12">
          {/* Enabled */}
          <section className="space-y-4">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Visibility</h2>
              <p className={BODY_MUTED}>The page-wide kill switch.</p>
            </header>
            <ToggleRow
              id="enabled"
              checked={enabled}
              onChange={setEnabled}
              label="Page is live"
              help={
                enabled
                  ? 'Anyone with the link can see it.'
                  : 'Turned off — the link shows a "not found" page until you publish.'
              }
            />
          </section>

          {/* Cover photo */}
          <section className="space-y-4 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Cover photo</h2>
              <p className={BODY_MUTED}>
                A wide image at the top of your page. Leave it blank to use your
                profile photo as the header.
              </p>
            </header>

            {coverPhotoUrl ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                  <img
                    src={coverPhotoUrl}
                    alt="Cover photo"
                    className="aspect-[16/9] w-full object-cover"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => coverFileRef.current?.click()}
                    disabled={coverUploading}
                  >
                    {coverUploading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ImagePlus size={14} />
                    )}
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCoverRemove}
                    disabled={coverUploading}
                  >
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => coverFileRef.current?.click()}
                  disabled={coverUploading}
                  className="flex aspect-[16/9] w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {coverUploading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <ImagePlus size={16} />
                      Upload cover photo
                    </span>
                  )}
                </button>
              </div>
            )}

            <input
              ref={coverFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleCoverFile}
            />

            <p className={CAPTION}>PNG, JPEG, or WebP. Up to 5 MB. Wide format works best.</p>
            {coverError && <p className="text-xs text-destructive">{coverError}</p>}
          </section>

          {/* Section visibility */}
          <section className="space-y-4 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Sections</h2>
              <p className={BODY_MUTED}>What shows on the page, top to bottom.</p>
            </header>
            <div className="space-y-4">
              <ToggleRow
                id="showIntake"
                checked={showIntake}
                onChange={setShowIntake}
                label="Application"
                help="The button to start an application — your main way to capture a lead."
              />
              <ToggleRow
                id="showTours"
                checked={showTours}
                onChange={setShowTours}
                label="Book a tour"
                help="A link to your tour-booking page."
              />
              <ToggleRow
                id="showProperties"
                checked={showProperties}
                onChange={setShowProperties}
                label="Featured listings"
                help="The properties you've picked in Content. Hidden if none are selected."
              />
            </div>
          </section>
        </TabsContent>

        {/* ── Content tab ──────────────────────────────────────────────── */}
        <TabsContent value="content" className="mt-8 space-y-12">
          {/* Custom links */}
          <section className="space-y-4">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Custom links</h2>
              <p className={BODY_MUTED}>
                Anything else worth a tap — your website, a saved-search page, a
                review profile. Drag to reorder. Links show the site&apos;s icon
                automatically; add your own image to override it.
              </p>
            </header>

            {customLinks.length === 0 ? (
              <p className={CAPTION}>No custom links yet.</p>
            ) : (
              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleLinkDragEnd}
              >
                <SortableContext
                  items={customLinks.map((l) => l.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {customLinks.map((link) => (
                      <SortableLinkRow
                        key={link.id}
                        link={link}
                        onChange={(patch) => updateLink(link.id, patch)}
                        onRemove={() => removeLink(link.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLink}
              disabled={customLinks.length >= MAX_LINKS}
            >
              <Plus size={14} />
              Add link
            </Button>
            {customLinks.length >= MAX_LINKS && (
              <p className={CAPTION}>You&apos;ve reached the limit of {MAX_LINKS} links.</p>
            )}
          </section>

          {/* Videos */}
          <section className="space-y-4 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Videos</h2>
              <p className={BODY_MUTED}>
                Paste a YouTube link — a property tour, a market update — and it
                shows as a playable thumbnail in a &ldquo;Watch&rdquo; section.
                Drag to reorder.
              </p>
            </header>

            {videos.length === 0 ? (
              <p className={CAPTION}>No videos yet.</p>
            ) : (
              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleVideoDragEnd}
              >
                <SortableContext
                  items={videos.map((v) => v.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {videos.map((video) => (
                      <SortableVideoRow
                        key={video.id}
                        video={video}
                        onChange={(patch) => updateVideo(video.id, patch)}
                        onRemove={() => removeVideo(video.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addVideo}
              disabled={videos.length >= MAX_VIDEOS}
            >
              <Plus size={14} />
              Add video
            </Button>
            {videos.length >= MAX_VIDEOS && (
              <p className={CAPTION}>You&apos;ve reached the limit of {MAX_VIDEOS} videos.</p>
            )}
          </section>

          {/* Featured properties */}
          <section className="space-y-4 border-t border-border/60 pt-10">
            <header className="space-y-1">
              <h2 className="text-base font-semibold">Featured properties</h2>
              <p className={BODY_MUTED}>
                Pick which active listings show on your page, and the order
                they show in. Up to {MAX_FEATURED}.
              </p>
            </header>

            <FeaturedPicker
              available={availableProperties}
              selectedIds={featuredPropertyIds}
              onToggle={toggleFeatured}
              maxReached={featuredPropertyIds.length >= MAX_FEATURED}
            />

            {featuredRows.length > 0 && (
              <div className="space-y-3 pt-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Order on your page
                </p>
                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleFeaturedDragEnd}
                >
                  <SortableContext
                    items={featuredRows.map((p) => p.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
                      {featuredRows.map((p) => (
                        <SortablePropertyRow
                          key={p.id}
                          property={p}
                          onRemove={() => toggleFeatured(p.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      {/* ── Save ───────────────────────────────────────────────────────── */}
      <div className="space-y-3 border-t border-border/60 pt-6">
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className={cn(PRIMARY_PILL, 'disabled:cursor-not-allowed disabled:opacity-60')}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving' : 'Save changes'}
          </button>
          {saved && (
            <span className={cn('inline-flex items-center gap-1.5', BODY_MUTED)}>
              <CheckCircle2 size={14} className="text-foreground" />
              Saved
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

function ToggleRow({
  id,
  checked,
  onChange,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <div className="space-y-0.5">
        <Label
          htmlFor={id}
          className="cursor-pointer text-[12.5px] font-medium text-foreground"
        >
          {label}
        </Label>
        <p className={CAPTION}>{help}</p>
      </div>
    </div>
  );
}

/** The shared drag-handle button. Used by every sortable row (links,
 *  videos, properties). Reveals on row hover on desktop, always visible on
 *  touch — matches the restraint guidance in STYLESHEET.md (the row
 *  doesn't carry chrome until the realtor reaches for it). */
function DragHandle({
  className,
  isDragging,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isDragging?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Reorder"
      className={cn(
        'flex h-5 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 transition-opacity duration-150',
        'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
        isDragging && 'cursor-grabbing opacity-100',
        className,
      )}
      {...rest}
    >
      <GripVertical size={14} />
    </button>
  );
}

/** Sortable wrapper around <LinkRow>. */
function SortableLinkRow(props: {
  link: CustomLink;
  onChange: (patch: Partial<CustomLink>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.link.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <LinkRow
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

function LinkRow({
  link,
  onChange,
  onRemove,
  dragHandleProps,
  isDragging,
}: {
  link: CustomLink;
  onChange: (patch: Partial<CustomLink>) => void;
  onRemove: () => void;
  /** Spread on the drag handle button. When omitted, no handle renders. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the realtor re-pick the same file
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Image must be under 2MB.');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', 'link-thumb');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || 'Upload failed.');
        return;
      }
      onChange({ thumbnail: data.url });
    } catch {
      setUploadError('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn('group space-y-1.5', isDragging && 'cursor-grabbing')}>
      <div className="flex items-start gap-2">
        {dragHandleProps && (
          <div className="mt-[1.0625rem]">
            <DragHandle isDragging={isDragging} {...dragHandleProps} />
          </div>
        )}

        {/* Thumbnail */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={link.thumbnail ? 'Change link image' : 'Add link image'}
          className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {uploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : link.thumbnail ? (
            <img src={link.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus size={16} />
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFile}
        />

        {/* Label + URL */}
        <div className="flex-1 space-y-2">
          <Input
            value={link.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Link label"
            maxLength={80}
            aria-label="Link label"
          />
          <Input
            value={link.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://"
            maxLength={500}
            inputMode="url"
            aria-label="Link URL"
          />
        </div>

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove link"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {(link.thumbnail || uploadError) && (
        <div
          className={cn(
            'flex items-center gap-3',
            // Match the thumbnail offset; bump it when the drag handle
            // is in front so the helper text aligns under the inputs.
            dragHandleProps ? 'pl-[5.5rem]' : 'pl-[3.75rem]',
          )}
        >
          {link.thumbnail && (
            <button
              type="button"
              onClick={() => onChange({ thumbnail: '' })}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Remove image
            </button>
          )}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      )}
    </div>
  );
}

/** Sortable wrapper around <VideoRow>. Same useSortable + transform
 *  vocabulary as the link row. */
function SortableVideoRow(props: {
  video: VideoItem;
  onChange: (patch: Partial<VideoItem>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.video.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <VideoRow
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

function VideoRow({
  video,
  onChange,
  onRemove,
  dragHandleProps,
  isDragging,
}: {
  video: VideoItem;
  onChange: (patch: Partial<VideoItem>) => void;
  onRemove: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const videoId = parseYouTubeId(video.url);
  const showError = video.url.trim().length > 0 && !videoId;

  return (
    <div className={cn('group space-y-1.5', isDragging && 'cursor-grabbing')}>
      <div className="flex items-start gap-2">
        {dragHandleProps && (
          <div className="mt-[1.0625rem]">
            <DragHandle isDragging={isDragging} {...dragHandleProps} />
          </div>
        )}

        <div className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/30 text-muted-foreground">
          {videoId ? (
            <img
              src={youTubeThumbnail(videoId)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Play size={16} />
          )}
        </div>

        <div className="flex-1 space-y-2">
          <Input
            value={video.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="YouTube link"
            maxLength={500}
            inputMode="url"
            aria-label="YouTube link"
          />
          <Input
            value={video.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Title (optional)"
            maxLength={120}
            aria-label="Video title"
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove video"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {showError && (
        <p className={cn('text-xs text-destructive', dragHandleProps ? 'pl-[5.5rem]' : 'pl-[3.75rem]')}>
          That doesn&apos;t look like a YouTube link.
        </p>
      )}
    </div>
  );
}

/** Sortable wrapper around <PropertyOrderRow>. Used for the curated
 *  featured-listings list in render order. */
function SortablePropertyRow(props: {
  property: AvailableProperty;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.property.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="bg-card">
      <PropertyOrderRow
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </li>
  );
}

function PropertyOrderRow({
  property,
  onRemove,
  dragHandleProps,
  isDragging,
}: {
  property: AvailableProperty;
  onRemove: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const locality = [property.city, property.stateRegion].filter(Boolean).join(', ');
  const price = formatPrice(property.listPrice);

  return (
    <div className={cn('group flex items-center gap-3 px-3 py-3', isDragging && 'cursor-grabbing')}>
      {dragHandleProps && <DragHandle isDragging={isDragging} {...dragHandleProps} />}

      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/30">
        {property.photo ? (
          <img src={property.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Home size={16} className="text-muted-foreground/60" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{property.address}</p>
        <p className="truncate text-xs text-muted-foreground">
          {locality}
          {locality && price && ' · '}
          {price && <span className="tabular-nums">{price}</span>}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from featured"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** Checkbox-led picker for the featured-properties section. Lists every
 *  active listing in the space; checking a row appends its id to the
 *  featured array; unchecking removes it. The reorder UI lives in a
 *  separate sortable list below — this picker is membership only. */
function FeaturedPicker({
  available,
  selectedIds,
  onToggle,
  maxReached,
}: {
  available: AvailableProperty[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  maxReached: boolean;
}) {
  if (available.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-8 text-center">
        <p className="text-sm text-foreground">No active listings yet.</p>
        <p className={cn(CAPTION, 'mt-1')}>
          Add listings in your workspace and they&apos;ll show up here.
        </p>
      </div>
    );
  }

  const selected = new Set(selectedIds);

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <ul className="divide-y divide-border/60">
        {available.map((p) => {
          const checked = selected.has(p.id);
          const disabled = !checked && maxReached;
          const locality = [p.city, p.stateRegion].filter(Boolean).join(', ');
          const price = formatPrice(p.listPrice);
          return (
            <li key={p.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 bg-card px-3 py-3 transition-colors hover:bg-muted/30',
                  disabled && 'cursor-not-allowed opacity-60 hover:bg-card',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(p.id)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-border/70 text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1"
                />
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/30">
                  {p.photo ? (
                    <img src={p.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <Home size={16} className="text-muted-foreground/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{p.address}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {locality}
                    {locality && price && ' · '}
                    {price && <span className="tabular-nums">{price}</span>}
                  </p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A single social-link input row in the editor. The platform's icon is
 *  intentionally not shown here — the row reads cleaner as a labeled
 *  input; the icon shows up where it matters, on the public page. */
function SocialRow({
  platform,
  value,
  onChange,
}: {
  platform: SocialPlatform;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `social-${platform}`;
  return (
    <div className="flex items-center gap-3">
      <Label
        htmlFor={id}
        className="w-[6.5rem] shrink-0 text-[12.5px] font-medium text-foreground"
      >
        {SOCIAL_LABELS[platform]}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={SOCIAL_PLACEHOLDERS[platform]}
        maxLength={500}
        inputMode="url"
        aria-label={SOCIAL_LABELS[platform]}
      />
    </div>
  );
}
