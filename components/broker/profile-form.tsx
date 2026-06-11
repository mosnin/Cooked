'use client';

/**
 * Broker member profile form — an owner/admin's own profile within the
 * brokerage. Mirror of the realtor profile-section (display name, title, bio,
 * photo, phone) but persisted per-member on BrokerageMembership via
 * /api/broker/profile (self-scoped). Photo uploads use /api/upload/onboarding
 * (works for broker-only accounts with no Space).
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CAPTION, PRIMARY_PILL } from '@/lib/typography';

export function BrokerProfileForm() {
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/broker/profile')
      .then((r) => r.json())
      .then((d) => {
        setDisplayName(d.displayName ?? '');
        setTitle(d.title ?? '');
        setBio(d.bio ?? '');
        setPhone(d.phone ?? '');
        setPhotoUrl(d.photoUrl ?? '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-40 bg-foreground/[0.04] rounded-md animate-pulse" />;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/broker/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          title: title.trim() || null,
          bio: bio.trim() || null,
          phone: phone.trim() || null,
          photoUrl: photoUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save.');
      }
      setSaved(true);
      toast.success('Profile saved.');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That tripped me up. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const initials =
    displayName
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'B';

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* Identity */}
      <div className="flex items-center gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="h-14 w-14 rounded-full object-cover bg-foreground/[0.06]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="h-14 w-14 rounded-full bg-foreground/[0.06] flex items-center justify-center text-base font-medium text-foreground">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => document.getElementById('broker-profile-photo')?.click()}
            disabled={photoUploading}
            className="text-sm text-foreground hover:text-foreground/80 underline-offset-4 hover:underline transition-colors duration-150 disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {photoUploading ? 'Uploading' : photoUrl ? 'Change photo' : 'Upload photo'}
            {photoUploading && (
              <Loader2 size={13} className="animate-spin text-muted-foreground" />
            )}
          </button>
          <p className={CAPTION}>PNG, JPG, or WebP. Max 2MB.</p>
        </div>
        <input
          id="broker-profile-photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              toast.error('Keep it under 2MB.');
              return;
            }
            setPhotoUploading(true);
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('type', 'photo');
              const res = await fetch('/api/upload/onboarding', {
                method: 'POST',
                body: formData,
              });
              const data = await res.json();
              if (res.ok && data.url) {
                setPhotoUrl(data.url);
                toast.success('Photo uploaded.');
              } else {
                toast.error(data.error || "Upload didn't go through. Try again.");
              }
            } catch {
              toast.error("Upload didn't go through. Try again.");
            } finally {
              setPhotoUploading(false);
            }
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broker-display-name" className="text-[12.5px] font-medium text-foreground">
          Display name
        </Label>
        <Input
          id="broker-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jordan Avery"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broker-title" className="text-[12.5px] font-medium text-foreground">
          Title
        </Label>
        <Input
          id="broker-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Managing Broker"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broker-phone" className="text-[12.5px] font-medium text-foreground">
          Phone number
        </Label>
        <Input
          id="broker-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broker-bio" className="text-[12.5px] font-medium text-foreground">
          Bio
        </Label>
        <Textarea
          id="broker-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A short bio shown alongside your name in the brokerage."
          rows={3}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving' : saved ? 'Saved' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
