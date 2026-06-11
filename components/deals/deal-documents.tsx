'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Loader2,
  ArrowUpFromLine,
  Image as ImageIcon,
  Film,
  Music,
  Paperclip,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DEAL_DOCUMENT_KINDS,
  defaultDocumentKind,
  documentKindsForPipeline,
  documentKindLabel,
  formatFileSize,
  type DealDocument,
  type DealDocumentKind,
} from '@/lib/deals/documents';
import {
  SendForSignature,
  type SignatureRequestLite,
} from '@/components/esign/send-for-signature';

interface DealDocumentsProps {
  dealId: string;
  slug: string;
  /** True when the realtor has DocuSign connected (server-resolved). */
  docusignConnected?: boolean;
  /** Latest signature request per documentId, for the inline status pill. */
  signatureRequests?: SignatureRequestLite[];
  initial?: DealDocument[];
  pipelineType?: string | null;
}

/**
 * Document library for a single deal. Drop zone + kind picker + list with
 * signed-URL download. Deliberately minimal — the win here is having a
 * typed, labeled place to store these files at all, not a full DMS.
 */
export function DealDocuments({
  dealId,
  slug,
  docusignConnected = false,
  signatureRequests = [],
  initial = [],
  pipelineType,
}: DealDocumentsProps) {
  // Latest request keyed by documentId — the inline pill reads from here.
  const requestByDoc = new Map<string, SignatureRequestLite>();
  for (const r of signatureRequests) {
    if (r.documentId && !requestByDoc.has(r.documentId)) requestByDoc.set(r.documentId, r);
  }
  const [docs, setDocs] = useState<DealDocument[]>(initial);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedKind, setSelectedKind] = useState<DealDocumentKind>(() => defaultDocumentKind(pipelineType));
  const orderedKinds = documentKindsForPipeline(pipelineType);
  const sortedKinds = DEAL_DOCUMENT_KINDS.slice().sort(
    (a, b) => orderedKinds.indexOf(a.value) - orderedKinds.indexOf(b.value),
  );
  const [dragging, setDragging] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initial.length > 0) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/documents`);
        if (!res.ok) return;
        const data: DealDocument[] = await res.json();
        if (!cancelled) setDocs(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [dealId, initial.length]);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', selectedKind);
      fd.append('label', file.name);

      const res = await fetch(`/api/deals/${dealId}/documents`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Upload didn't go through. Try again.");
        return;
      }
      const created: DealDocument = await res.json();
      setDocs((prev) => [created, ...prev]);
      toast.success(`${file.name} uploaded.`);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: DealDocument) {
    const res = await fetch(`/api/deals/${dealId}/documents/${doc.id}`);
    if (!res.ok) {
      toast.error("Couldn't open that download link.");
      return;
    }
    const { url } = await res.json();
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleDelete(doc: DealDocument) {
    const prev = docs;
    setDocs((list) => list.filter((d) => d.id !== doc.id));
    const res = await fetch(`/api/deals/${dealId}/documents/${doc.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setDocs(prev);
      toast.error("Couldn't delete that.");
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragging) setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) await uploadFile(f);
  }

  return (
    <div className="space-y-4">
      {/* Drop zone + kind picker */}
      <div
        className={cn(
          'rounded-lg border-2 border-dashed px-4 py-6 transition-colors',
          dragging ? 'border-foreground bg-muted/40' : 'border-border bg-muted/10',
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            {uploading ? <Loader2 size={18} className="animate-spin text-muted-foreground" /> : <ArrowUpFromLine size={18} className="text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Drag files here or click to upload</p>
            <p className="text-xs text-muted-foreground">PDF, image, or Word — 25MB max.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="sr-only" htmlFor="deal-doc-kind">Document type</label>
            <select
              id="deal-doc-kind"
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as DealDocumentKind)}
              className="text-xs border border-border rounded px-2 py-1.5 bg-card"
              disabled={uploading}
            >
              {sortedKinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
            >
              <Upload size={12} />
              Choose file
            </button>
            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background text-xs font-medium text-foreground px-3 py-1.5 hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              <Paperclip size={12} />
              Attach from files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                // Reset so the same filename can be picked again.
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>

      <AttachFromFilesDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        dealId={dealId}
        defaultKind={defaultDocumentKind(pipelineType)}
        sortedKinds={sortedKinds}
        onAttached={(attached) => setDocs((prev) => [...attached, ...prev])}
      />

      {/* Document list */}
      {loading && docs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">One moment.</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Nothing here yet. Drop the offer in to start.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-card">
          {docs.map((doc) => (
            <li key={doc.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
              <FileText size={18} className="text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {documentKindLabel(doc.kind)}
                  {doc.sizeBytes ? ` · ${formatFileSize(doc.sizeBytes)}` : ''}
                  {' · '}
                  {new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <div className="flex-shrink-0">
                <SendForSignature
                  slug={slug}
                  connected={docusignConnected}
                  documentId={doc.id}
                  documentLabel={doc.label}
                  dealId={dealId}
                  initialRequest={requestByDoc.get(doc.id) ?? null}
                  compact
                />
              </div>
              <button
                type="button"
                onClick={() => handleDownload(doc)}
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title={`Download ${doc.label}`}
              >
                <Download size={13} />
                Download
              </button>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                title={`Delete ${doc.label}`}
                aria-label={`Delete ${doc.label}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Attach-from-files dialog ─────────────────────────────────────────── */

interface FileListRow {
  id: string;
  name: string;
  mimeType: string;
  category: 'image' | 'document' | 'video' | 'audio' | 'other';
  sizeBytes: number;
  isPublic: boolean;
  createdAt: string;
  source: 'file' | 'chat';
  previewUrl: string | null;
}

interface AttachDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  defaultKind: DealDocumentKind;
  sortedKinds: typeof DEAL_DOCUMENT_KINDS;
  onAttached: (docs: DealDocument[]) => void;
}

const CATEGORY_FALLBACK_ICON = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  other: FileText,
} as const;

function AttachFromFilesDialog({
  open,
  onOpenChange,
  dealId,
  defaultKind,
  sortedKinds,
  onAttached,
}: AttachDialogProps) {
  const [files, setFiles] = useState<FileListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<DealDocumentKind>(defaultKind);
  const [attaching, setAttaching] = useState(false);

  // Refetch on each open so the list reflects anything the realtor added
  // in the meantime. Chat-attachment rows aren't attachable (they're
  // conversation ephemera with their own retention rules) so we skip them.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFiles(null);
    setError(null);
    setSelected(new Set());
    setKind(defaultKind);
    (async () => {
      try {
        const res = await fetch('/api/files');
        if (!res.ok) throw new Error('Failed to load files');
        const data = (await res.json()) as { files: FileListRow[] };
        if (cancelled) return;
        setFiles((data.files ?? []).filter((f) => f.source === 'file'));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, defaultKind]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAttach() {
    if (selected.size === 0) return;
    setAttaching(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: Array.from(selected), kind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Couldn't attach those files. Try again.");
        return;
      }
      const attached: DealDocument[] = await res.json();
      onAttached(attached);
      toast.success(
        attached.length === 1 ? 'Attached 1 file.' : `Attached ${attached.length} files.`,
      );
      onOpenChange(false);
    } catch {
      toast.error("Couldn't attach those files. Try again.");
    } finally {
      setAttaching(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach from files</DialogTitle>
          <DialogDescription>
            Reference an existing file without re-uploading it. You can reclassify each one after.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="attach-kind">
              Document type
            </label>
            <select
              id="attach-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as DealDocumentKind)}
              className="text-xs border border-border rounded px-2 py-1.5 bg-card"
              disabled={attaching}
            >
              {sortedKinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {selected.size} selected
          </p>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/70">
          {error ? (
            <p className="text-sm text-destructive px-4 py-6 text-center">{error}</p>
          ) : files === null ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">One moment.</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">
              Nothing in your files yet. Upload something first.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {files.map((f) => {
                const isSelected = selected.has(f.id);
                const Icon = CATEGORY_FALLBACK_ICON[f.category] ?? FileText;
                return (
                  <li key={f.id}>
                    <label
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                        isSelected ? 'bg-muted/50' : 'hover:bg-muted/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(f.id)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <div className="flex-shrink-0 w-10 h-10 rounded-md bg-muted/40 overflow-hidden flex items-center justify-center">
                        {f.previewUrl && f.category === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Icon size={16} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {formatFileSize(f.sizeBytes)}
                          {' · '}
                          {new Date(f.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={attaching}
            className="inline-flex items-center justify-center h-9 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={attaching || selected.size === 0}
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-foreground text-background px-4 text-sm font-medium disabled:opacity-50"
          >
            {attaching ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
            Attach{selected.size > 0 ? ` ${selected.size}` : ''}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
