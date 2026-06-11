'use client';

/**
 * FilePreviewModal — click a file card and see it inline.
 *
 * Render shape by mime category:
 *   image  →  <img> sized to viewport (object-contain so the original
 *             aspect ratio is preserved)
 *   video  →  <video controls> with the signed/public URL as src
 *   audio  →  <audio controls> on a paper-flat surface
 *   pdf    →  <iframe> at ~80vh, with a Download fallback link inside in
 *             case the browser refuses to render it (Firefox without
 *             pdf.js, mobile Safari with content-disposition: attachment)
 *   other  →  filename + size + download button (today's icon-only state)
 *
 * The modal needs a signed/public URL to render. For File-table rows we
 * fetch one lazily via /api/files/[id]; for chat attachments we already
 * have a publicUrl (carried on the row from the list response).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Download, Trash2, Loader2, FileText, AlertCircle } from 'lucide-react';
import { formatBytes, type FileCategory } from '@/lib/storage/limits';

export interface PreviewableFile {
  id: string;
  name: string;
  mimeType: string;
  category: FileCategory;
  sizeBytes: number;
  isPublic: boolean;
  source: 'file' | 'chat';
  /** Carried through from the list response for chat attachments + already
   *  signed previewable files. Image / video rows on the list have one;
   *  PDFs and "other" don't, and we have to mint it here on open. */
  previewUrl?: string | null;
}

interface Props {
  file: PreviewableFile | null;
  onClose: () => void;
  onDelete?: (file: PreviewableFile) => void;
}

/** Lightweight category helper so the modal doesn't need to import
 *  /api/files/route's deriveCategory. */
function kind(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

export function FilePreviewModal({ file, onClose, onDelete }: Props) {
  // The URL the inline renderer points at. For image/video rows the list
  // already attaches one; for everything else (PDF, audio, "other") we
  // fetch it on open via /api/files/[id].
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = file != null;

  useEffect(() => {
    if (!file) {
      setResolvedUrl(null);
      setError(null);
      return;
    }

    // The list response already gave us a URL for inline-previewable
    // rows — use it. Chat attachments always have a publicUrl too.
    if (file.previewUrl) {
      setResolvedUrl(file.previewUrl);
      return;
    }

    // Chat attachments don't have a File-table id; the GET endpoint we
    // mint signed URLs against is /api/files/[id], scoped to the File
    // table. If we land here with a chat row that somehow has no
    // previewUrl, fall back to the "other" view — nothing to render.
    if (file.source !== 'file') return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/files/${file.id}`);
        if (!res.ok) throw new Error('Could not load preview');
        const body = (await res.json()) as { url?: string };
        if (cancelled) return;
        if (!body.url) throw new Error('No preview URL');
        setResolvedUrl(body.url);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load preview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const onDownload = useCallback(() => {
    if (resolvedUrl) window.open(resolvedUrl, '_blank', 'noopener');
  }, [resolvedUrl]);

  // Esc + click-outside come from Radix Dialog for free. Wire onClose
  // through onOpenChange so internal close actions (Cancel, the X) all
  // funnel to the same path.
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {file && (
        <DialogContent
          className="!max-w-[min(96vw,1024px)] gap-3 p-0 sm:p-0 overflow-hidden"
        >
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60 gap-1.5">
            <DialogTitle className="truncate text-base font-semibold pr-8">
              {file.name}
            </DialogTitle>
            <DialogDescription className="text-[11px] tabular-nums text-muted-foreground">
              {formatBytes(file.sizeBytes)} · {file.mimeType || 'unknown type'}
            </DialogDescription>
          </DialogHeader>

          <PreviewBody
            file={file}
            url={resolvedUrl}
            loading={loading}
            error={error}
          />

          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3 bg-background">
            {onDelete && file.source === 'file' && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${file.name}"?`)) {
                    onDelete(file);
                    onClose();
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 px-3 h-9 text-[13px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 size={13} />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onDownload}
              disabled={!resolvedUrl}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 h-9 text-[13px] font-semibold text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Download size={13} />
              Download
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function PreviewBody({
  file,
  url,
  loading,
  error,
}: {
  file: PreviewableFile;
  url: string | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="px-5 py-12 flex items-center justify-center gap-2 text-sm text-rose-600 dark:text-rose-400">
        <AlertCircle size={14} />
        {error}
      </div>
    );
  }

  if (loading || (!url && file.source === 'file' && kind(file.mimeType) !== 'other')) {
    return (
      <div className="px-5 py-16 flex items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  const k = kind(file.mimeType);

  if (k === 'image' && url) {
    return (
      <div className="bg-muted/30 flex items-center justify-center p-4 max-h-[80vh] overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={file.name}
          className="max-h-[80vh] max-w-[90vw] object-contain"
        />
      </div>
    );
  }

  if (k === 'video' && url) {
    return (
      <div className="bg-black flex items-center justify-center p-2">
        <video
          src={url}
          controls
          preload="metadata"
          className="max-h-[80vh] max-w-full"
        />
      </div>
    );
  }

  if (k === 'audio' && url) {
    return (
      <div className="px-5 py-10 flex items-center justify-center bg-muted/20">
        <audio src={url} controls className="w-full max-w-md" />
      </div>
    );
  }

  if (k === 'pdf' && url) {
    return (
      <div className="bg-muted/20">
        <iframe
          src={url}
          title={file.name}
          className="w-full h-[80vh] bg-background"
        >
          {/* Fallback if the browser refuses to embed the PDF (some mobile
           *  browsers, some with strict CSP). */}
          <p className="p-6 text-sm text-muted-foreground">
            Your browser can&apos;t preview this PDF.{' '}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              Download it instead.
            </a>
          </p>
        </iframe>
      </div>
    );
  }

  // "other" — keep today's pure-icon experience inside the modal so the
  // realtor still sees the file name and gets a Download.
  return (
    <div className="px-5 py-16 flex flex-col items-center gap-3 text-center bg-muted/20">
      <FileText className="h-10 w-10 text-muted-foreground/60" />
      <p className="text-sm text-foreground">No inline preview for this file type.</p>
      <p className="text-xs text-muted-foreground">
        Use Download to open it locally.
      </p>
    </div>
  );
}
