'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { BODY_MUTED } from '@/lib/typography';

/**
 * Your data — the GDPR/CCPA rights surface, in plain language.
 *
 * Two actions, no configuration: take a copy, or delete the account. Both are
 * scoped server-side to the caller's workspace. The export is one tap. The
 * delete is type-to-confirm, because it's permanent.
 */
export function YourDataSection({ spaceName }: { spaceName: string }) {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch('/api/account/export', { method: 'GET' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "couldn't build your export. try again in a moment.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? 'chippi-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('lost the connection. check it and try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Export — right to access + portability */}
      <div className="space-y-3">
        <p className={BODY_MUTED}>
          download a complete copy of your workspace — your people, deals,
          properties, conversations, and documents — as a single json file.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium',
            'border border-border bg-background hover:bg-muted/60 active:scale-[0.98] transition-all duration-150',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {exporting ? 'preparing' : 'download a copy'}
        </button>
      </div>

      {/* Delete account — right to erasure */}
      <div className="pt-6 border-t border-border/60">
        <DeleteAccount spaceName={spaceName} onDeleted={() => router.push('/')} />
      </div>
    </div>
  );
}

function DeleteAccount({
  spaceName,
  onDeleted,
}: {
  spaceName: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const nameMatches = confirmText.trim() === spaceName.trim();

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!nameMatches) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "couldn't delete your account. try again.");
        setDeleting(false);
        return;
      }
      setOpen(false);
      onDeleted();
    } catch {
      toast.error('lost the connection. check it and try again.');
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
          delete your account and everything in it — permanently. your login is
          removed and your workspace data is erased. this cannot be undone.
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
          delete account
        </button>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            your login and every client, deal, note, and document go with it.
            this cannot be undone. download a copy first if you want to keep
            anything.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label
            htmlFor="confirm-account-delete"
            className="text-[12.5px] font-medium text-foreground"
          >
            type your workspace name to confirm
          </Label>
          <Input
            id="confirm-account-delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={spaceName}
            autoComplete="off"
            disabled={deleting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting || !nameMatches}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            {deleting ? 'deleting' : 'delete account'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
