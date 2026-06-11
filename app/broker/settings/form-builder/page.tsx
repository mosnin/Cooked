'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Loader2,
  Save,
  RotateCcw,
  Eye,
  Pencil,
  Home,
  Key,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { FormBuilder } from '@/components/form-builder';
import { FormPreview } from '@/components/form-builder/form-preview';
import { TEMPLATES } from '@/components/form-builder/templates';
import type { IntakeFormConfig } from '@/components/form-builder/types';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

type LeadType = 'rental' | 'buyer';

export default function BrokerFormBuilderPage() {
  // ── Primary tab: which form are we editing ──
  const [activeLeadType, setActiveLeadType] = useState<LeadType>('rental');

  // ── Per-form state ──
  const [rentalConfig, setRentalConfig] = useState<IntakeFormConfig>(deepClone(TEMPLATES.rental.config));
  const [buyerConfig, setBuyerConfig] = useState<IntakeFormConfig>(deepClone(TEMPLATES.buyer.config));
  const [rentalHasChanges, setRentalHasChanges] = useState(false);
  const [buyerHasChanges, setBuyerHasChanges] = useState(false);
  const [rentalHasSavedConfig, setRentalHasSavedConfig] = useState(false);
  const [buyerHasSavedConfig, setBuyerHasSavedConfig] = useState(false);
  const rentalSavedRef = useRef<string>('');
  const buyerSavedRef = useRef<string>('');

  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<string>('builder');
  const [memberCount, setMemberCount] = useState<number | null>(null);

  // Confirmation dialogs (replace native confirm()).
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);

  // Load existing configs
  useEffect(() => {
    fetch('/api/broker/form-config')
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((data: {
        brokerageId: string;
        rentalFormConfig: IntakeFormConfig | null;
        buyerFormConfig: IntakeFormConfig | null;
      }) => {
        // Rental config
        if (data.rentalFormConfig?.sections) {
          setRentalConfig(data.rentalFormConfig);
          setRentalHasSavedConfig(true);
          rentalSavedRef.current = JSON.stringify(data.rentalFormConfig);
        } else {
          const defaultConfig = deepClone(TEMPLATES.rental.config);
          setRentalConfig(defaultConfig);
          setRentalHasSavedConfig(false);
          rentalSavedRef.current = JSON.stringify(defaultConfig);
        }

        // Buyer config
        if (data.buyerFormConfig?.sections) {
          setBuyerConfig(data.buyerFormConfig);
          setBuyerHasSavedConfig(true);
          buyerSavedRef.current = JSON.stringify(data.buyerFormConfig);
        } else {
          const defaultConfig = deepClone(TEMPLATES.buyer.config);
          setBuyerConfig(defaultConfig);
          setBuyerHasSavedConfig(false);
          buyerSavedRef.current = JSON.stringify(defaultConfig);
        }
      })
      .catch(() => {
        const defaultRental = deepClone(TEMPLATES.rental.config);
        const defaultBuyer = deepClone(TEMPLATES.buyer.config);
        setRentalConfig(defaultRental);
        setBuyerConfig(defaultBuyer);
        rentalSavedRef.current = JSON.stringify(defaultRental);
        buyerSavedRef.current = JSON.stringify(defaultBuyer);
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch member count for the "Push to Members" section
  useEffect(() => {
    fetch('/api/broker/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.memberCount != null) {
          setMemberCount(data.memberCount);
        }
      })
      .catch(() => {
        // Silently fail
      });
  }, []);

  // ── Active config accessor ──
  const config = activeLeadType === 'rental' ? rentalConfig : buyerConfig;
  const hasChanges = activeLeadType === 'rental' ? rentalHasChanges : buyerHasChanges;
  const hasSavedConfig = activeLeadType === 'rental' ? rentalHasSavedConfig : buyerHasSavedConfig;
  const anyHasChanges = rentalHasChanges || buyerHasChanges;
  const eitherHasSavedConfig = rentalHasSavedConfig || buyerHasSavedConfig;

  const handleConfigChange = useCallback((newConfig: IntakeFormConfig) => {
    if (activeLeadType === 'rental') {
      setRentalConfig(newConfig);
      setRentalHasChanges(JSON.stringify(newConfig) !== rentalSavedRef.current);
    } else {
      setBuyerConfig(newConfig);
      setBuyerHasChanges(JSON.stringify(newConfig) !== buyerSavedRef.current);
    }
  }, [activeLeadType]);

  // Use refs so handleSave always reads the latest config without needing
  // rentalConfig/buyerConfig in the dependency array (avoids stale closures
  // when React batches a FormBuilder onChange with the save click).
  const rentalConfigRef = useRef(rentalConfig);
  rentalConfigRef.current = rentalConfig;
  const buyerConfigRef = useRef(buyerConfig);
  buyerConfigRef.current = buyerConfig;

  const handleSave = useCallback(async () => {
    setSaving(true);
    const currentConfig = activeLeadType === 'rental' ? rentalConfigRef.current : buyerConfigRef.current;
    try {
      const res = await fetch('/api/broker/form-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadType: activeLeadType, formConfig: currentConfig }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save form configuration.');
      }

      if (activeLeadType === 'rental') {
        setRentalHasSavedConfig(true);
        setRentalHasChanges(false);
        rentalSavedRef.current = JSON.stringify(currentConfig);
      } else {
        setBuyerHasSavedConfig(true);
        setBuyerHasChanges(false);
        buyerSavedRef.current = JSON.stringify(currentConfig);
      }

      toast.success(`Brokerage ${activeLeadType === 'rental' ? 'rental' : 'buyer'} form saved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }, [activeLeadType]);

  const handleReset = useCallback(async () => {
    const label = activeLeadType === 'rental' ? 'rental' : 'buyer';
    try {
      const res = await fetch('/api/broker/form-config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadType: activeLeadType }),
      });
      if (!res.ok) {
        throw new Error('Failed to reset form configuration.');
      }
      const templateKey = activeLeadType === 'rental' ? 'rental' : 'buyer';
      const defaultConfig = deepClone(TEMPLATES[templateKey].config);
      if (activeLeadType === 'rental') {
        setRentalConfig(defaultConfig);
        setRentalHasSavedConfig(false);
        setRentalHasChanges(false);
        rentalSavedRef.current = JSON.stringify(defaultConfig);
      } else {
        setBuyerConfig(defaultConfig);
        setBuyerHasSavedConfig(false);
        setBuyerHasChanges(false);
        buyerSavedRef.current = JSON.stringify(defaultConfig);
      }
      toast.success(`Brokerage ${label} form reset to the standard Chippi default.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }, [activeLeadType]);

  const memberLabel = memberCount != null
    ? `${memberCount} member${memberCount === 1 ? '' : 's'}`
    : 'all member realtors';

  const handlePushToMembers = useCallback(async () => {
    setPushing(true);
    try {
      const res = await fetch('/api/broker/form-config/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalFormConfig: rentalConfigRef.current,
          buyerFormConfig: buyerConfigRef.current,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to push form to members.');
      }
      toast.success(`Both rental and buyer forms pushed to ${memberLabel}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setPushing(false);
    }
  }, [memberCount]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-3xl mx-auto">
        <div className="h-8 bg-muted rounded-lg w-40" />
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    );
  }

  const activeFormName = activeLeadType === 'rental' ? 'Rental application' : 'Buyer inquiry';

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-56 md:pb-24">
      {/* ── Header ── */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <header className="space-y-1.5">
            <p className={BODY_MUTED}>Settings.</p>
            <h1 className={H1} style={TITLE_FONT}>
              Brokerage intake form
            </h1>
            <p className={BODY_MUTED}>
              {hasChanges
                ? 'Unsaved changes. Save to update your brokerage standard.'
                : hasSavedConfig
                  ? 'Saved as your brokerage standard.'
                  : 'Design the standard rental and buyer forms, then push them to your team.'}
            </p>
          </header>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)}>
              <RotateCcw size={14} className="mr-1.5" /> Reset to default
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <><Loader2 size={14} className="mr-1.5 animate-spin" /> Saving…</>
              ) : (
                <><Save size={14} className="mr-1.5" /> Save form</>
              )}
            </Button>
          </div>
        </div>

        {/* ── Primary tabs: Rental / Buyer — segmented control vocabulary.
            Active = foreground (never orange); inactive recedes to muted. ── */}
        <div className="inline-flex gap-1 rounded-full bg-foreground/[0.04] p-1 self-start">
          <button
            type="button"
            onClick={() => setActiveLeadType('rental')}
            className={cn(
              'flex items-center gap-2 px-4 h-9 rounded-full text-sm font-medium transition-colors',
              activeLeadType === 'rental'
                ? 'bg-background border border-border/70 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Home size={15} />
            Rental form
            {rentalHasChanges && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveLeadType('buyer')}
            className={cn(
              'flex items-center gap-2 px-4 h-9 rounded-full text-sm font-medium transition-colors',
              activeLeadType === 'buyer'
                ? 'bg-background border border-border/70 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Key size={15} />
            Buyer form
            {buyerHasChanges && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
            )}
          </button>
        </div>

        {/* ── Active form status — calm hairline section ── */}
        <div className="space-y-1.5 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2">
            <Pencil size={14} className="text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium">Editing {activeFormName}</span>
            {hasSavedConfig ? (
              <Badge variant="secondary" className="text-[10px]">Custom</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Not configured</Badge>
            )}
          </div>
          {!hasSavedConfig && (
            <p className="text-xs text-muted-foreground">
              No custom brokerage {activeLeadType === 'rental' ? 'rental' : 'buyer'} form yet. Customize the fields below and save to create your brokerage standard.
            </p>
          )}
        </div>
      </div>

      {/* ── Push to members — calm hairline section ── */}
      <div className="space-y-2 border-b border-border/60 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Push to all members</p>
            <p className="text-xs text-muted-foreground">
              Apply both rental and buyer forms to {memberCount != null ? (
                <span className="font-medium text-foreground">{memberCount} member{memberCount === 1 ? '' : 's'}</span>
              ) : (
                'all member realtors'
              )}. Their individual form settings will be overridden.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPushConfirmOpen(true)}
            disabled={pushing || anyHasChanges || !eitherHasSavedConfig}
            className="flex-shrink-0"
          >
            {pushing ? (
              <><Loader2 size={14} className="mr-1.5 animate-spin" /> Pushing…</>
            ) : (
              <><Send size={14} className="mr-1.5" /> Push to members</>
            )}
          </Button>
        </div>
        {anyHasChanges && (
          <p className="text-xs text-muted-foreground">
            Save your changes before pushing to members.
          </p>
        )}
        {!eitherHasSavedConfig && !anyHasChanges && (
          <p className="text-xs text-muted-foreground">
            Save a custom brokerage form first before pushing to members.
          </p>
        )}
      </div>

      {/* ── Builder / Preview sub-tabs ── */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="builder">
            <Pencil size={14} className="mr-1.5" /> Builder
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye size={14} className="mr-1.5" /> Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder">
          <FormBuilder config={config} onChange={handleConfigChange} />
        </TabsContent>

        <TabsContent value="preview">
          <FormPreview config={config} />
        </TabsContent>
      </Tabs>

      {/* ── Reset confirmation ── */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset the {activeLeadType === 'rental' ? 'rental' : 'buyer'} form?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This restores the standard Chippi default and removes your custom brokerage {activeLeadType === 'rental' ? 'rental' : 'buyer'} form.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn('bg-destructive text-white hover:bg-destructive/90')}
              onClick={() => {
                setResetConfirmOpen(false);
                void handleReset();
              }}
            >
              Reset to default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Push confirmation ── */}
      <AlertDialog open={pushConfirmOpen} onOpenChange={setPushConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push forms to {memberLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              This overrides both the rental and buyer form settings for {memberLabel} with your brokerage forms. Their form source switches to the brokerage standard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPushConfirmOpen(false);
                void handlePushToMembers();
              }}
            >
              Push to members
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
