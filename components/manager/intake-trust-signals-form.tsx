'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
} from '@/lib/typography';

interface IntakeTrustSignalsFormProps {
  licenseNumber: string;
  complianceNotice: string;
  showComplianceMark: boolean;
  isOwner: boolean;
}

const COMPLIANCE_PLACEHOLDER =
  'All calls and texts are consent-based and TCPA-compliant. Reply STOP any time to opt out — opt-outs are honored immediately.';

/**
 * Team-level intake trust signals — set once by the team admin
 * and inherited by every agent's /apply/b/[teamId] intake footer.
 * If both per-space and per-team values exist, the team value
 * wins on the team variant.
 */
export function TeamIntakeTrustSignalsForm({
  licenseNumber: initialLicense,
  complianceNotice: initialNotice,
  showComplianceMark: initialShow,
  isOwner,
}: IntakeTrustSignalsFormProps) {
  const [licenseNumber, setLicenseNumber] = useState(initialLicense);
  const [complianceNotice, setComplianceNotice] = useState(initialNotice);
  const [showComplianceMark, setShowComplianceMark] = useState(initialShow);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/manager/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamLicenseNumber: licenseNumber.trim() || null,
          teamComplianceNotice: complianceNotice || null,
          teamShowComplianceMark: showComplianceMark,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaved(true);
        toast.success('Trust signals saved.');
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
        <Label htmlFor="teamLicenseNumber">License number</Label>
        <Input
          id="teamLicenseNumber"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          placeholder="TX-RE-12345"
          maxLength={200}
          disabled={!isOwner}
        />
        <p className={CAPTION}>Your team license number, shown verbatim.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="teamComplianceNotice">Compliance notice</Label>
        <Textarea
          id="teamComplianceNotice"
          value={complianceNotice}
          onChange={(e) => setComplianceNotice(e.target.value)}
          placeholder={COMPLIANCE_PLACEHOLDER}
          rows={4}
          maxLength={2000}
          disabled={!isOwner}
        />
        <p className={CAPTION}>Plain text. Line breaks are preserved.</p>
      </div>

      <div className="flex items-start gap-3 pt-1">
        <Switch
          id="teamShowComplianceMark"
          checked={showComplianceMark}
          onCheckedChange={setShowComplianceMark}
          disabled={!isOwner}
        />
        <div className="space-y-0.5">
          <Label
            htmlFor="teamShowComplianceMark"
            className="cursor-pointer"
          >
            Show compliance mark
          </Label>
          <p className={CAPTION}>Displays a compliance badge next to the notice.</p>
        </div>
      </div>

      {isOwner && (
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
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
          Only the team owner or admins can edit these settings.
        </p>
      )}
    </form>
  );
}
