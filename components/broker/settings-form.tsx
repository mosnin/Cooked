'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, Upload, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { generatePrivacyPolicy } from '@/lib/privacy-policy-template';
import {
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
  GHOST_PILL,
} from '@/lib/typography';

interface SettingsFormProps {
  name: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  joinCode: string | null;
  privacyPolicyHtml: string | null;
  isOwner: boolean;
}

export function BrokerageSettingsForm({
  name: initialName,
  websiteUrl: initialWebsite,
  logoUrl: initialLogo,
  joinCode,
  privacyPolicyHtml: initialPrivacyPolicy,
  isOwner,
}: SettingsFormProps) {
  const [name, setName] = useState(initialName);
  const [websiteUrl, setWebsiteUrl] = useState(initialWebsite ?? '');
  const [logoUrl, setLogoUrl] = useState(initialLogo ?? '');
  const [privacyPolicyHtml, setPrivacyPolicyHtml] = useState(initialPrivacyPolicy ?? '');
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/broker/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          websiteUrl: websiteUrl.trim() || null,
          logoUrl: logoUrl.trim() || null,
          privacyPolicyHtml: privacyPolicyHtml || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaved(true);
        toast.success('Settings saved.');
        setTimeout(() => setSaved(false), 2000);
      } else {
        toast.error(data.error ?? 'Failed to save.');
      }
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="brokerage-name">Brokerage name</Label>
        <Input
          id="brokerage-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          disabled={!isOwner}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="website-url">Website URL</Label>
        <Input
          id="website-url"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://example.com"
          maxLength={500}
          disabled={!isOwner}
        />
        <p className={CAPTION}>Optional. Shown on your brokerage profile.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Logo</Label>
        <div
          className={cn(
            'relative flex items-center gap-4 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 transition-colors',
            isOwner ? 'cursor-pointer hover:border-border' : 'opacity-60',
          )}
          onClick={() => isOwner && document.getElementById('broker-logo-upload')?.click()}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo preview"
              className="h-10 max-w-[120px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-background border border-border/70 flex items-center justify-center">
              <Upload size={16} className="text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {logoUrl ? 'Change logo' : 'Upload logo'}
            </p>
            <p className={CAPTION}>PNG, JPG, WebP, or SVG. Max 2MB.</p>
          </div>
          {logoUploading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        </div>
        <input
          id="broker-logo-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          disabled={!isOwner}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              toast.error('File must be under 2MB.');
              return;
            }
            setLogoUploading(true);
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('type', 'logo');
              // Use onboarding upload endpoint — broker-only accounts may not have a Space
              const res = await fetch('/api/upload/onboarding', { method: 'POST', body: formData });
              const data = await res.json();
              if (res.ok && data.url) {
                setLogoUrl(data.url);
                toast.success('Logo uploaded.');
              } else {
                toast.error(data.error || 'Upload failed.');
              }
            } catch {
              toast.error('Upload failed.');
            } finally {
              setLogoUploading(false);
            }
          }}
        />
        <p className={CAPTION}>Optional. Displayed on invite pages and emails.</p>
      </div>

      {joinCode && (
        <div className="space-y-1.5">
          <Label>Join code</Label>
          <Input
            value={joinCode}
            readOnly
            disabled
            className="font-mono tracking-widest"
          />
          <p className={CAPTION}>
            Current invite code. Manage it in the Invite Code section below.
          </p>
        </div>
      )}

      {/* ── Privacy Policy ──────────────────────────────────────────── */}
      <div className="space-y-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label>Privacy policy</Label>
            <p className={CAPTION}>Shown on intake pages for realtors under your brokerage.</p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => {
                setPrivacyPolicyHtml(generatePrivacyPolicy(name, 'brokerage'));
                toast.success('Privacy policy template generated.');
              }}
              className={cn(GHOST_PILL, 'h-8 px-3 text-xs border border-border/70')}
            >
              <MessageCircle size={12} />
              Generate template
            </button>
          )}
        </div>
        <RichTextEditor
          value={privacyPolicyHtml}
          onChange={setPrivacyPolicyHtml}
          placeholder="Enter your brokerage privacy policy here or click 'Generate template' to start..."
          disabled={!isOwner}
        />
        <p className={CAPTION}>
          You&apos;re responsible for making sure this complies with applicable laws in your jurisdiction.
        </p>
      </div>

      {isOwner && (
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
          >
            {saving ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <CheckCircle2 size={13} /> Saved
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      )}

      {!isOwner && (
        <p className={BODY_MUTED}>
          Only the brokerage owner or admins can edit these settings.
        </p>
      )}
    </form>
  );
}
