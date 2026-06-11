'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { toast } from 'sonner';

interface DeleteDealButtonProps {
  dealId: string;
  slug: string;
  dealTitle: string;
}

export function DeleteDealButton({ dealId, slug, dealTitle }: DeleteDealButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open while the request is in flight so the
    // user sees the loading state. We close it ourselves on success.
    event.preventDefault();
    setDeleting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: 'DELETE' });
      if (res.ok) {
        setOpen(false);
        router.push(`/s/${slug}/deals`);
      } else {
        toast.error("Couldn't delete that deal. Try again.");
        setDeleting(false);
      }
    } catch {
      toast.error("Couldn't delete that deal. Try again.");
      setDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setOpen(next);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
        onClick={() => setOpen(true)}
        disabled={deleting}
        aria-label="Delete deal"
      >
        <Trash2 size={15} />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{dealTitle}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this deal. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete deal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
