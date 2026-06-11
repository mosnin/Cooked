'use client';

import { useState, useRef, useCallback } from 'react';
import { toastError } from '@/lib/toast-helpers';
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
  PRIMARY_PILL,
} from '@/lib/typography';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function ImportExportClient({ totalLeads }: { totalLeads: number }) {
  // Export state
  const [exporting, setExporting] = useState(false);

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/broker/leads/export');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      a.download = filenameMatch?.[1] ?? `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportError('Please select a CSV file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportError('File is too large. Maximum size is 5MB.');
      return;
    }
    setSelectedFile(file);
    setImportError(null);
    setImportResult(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleImport = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/broker/leads/import', {
        method: 'POST',
        body: formData,
      });

      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Import failed.');
      }

      setImportResult(body as ImportResult);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setImportError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const subtitle = totalLeads
    ? `${totalLeads.toLocaleString()} ${totalLeads === 1 ? 'lead' : 'leads'} across the brokerage.`
    : 'Bring leads in from a CSV, or take them out.';

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Import / export.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Move leads in and out
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      {/* ── Export ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="space-y-0.5">
          <p className={SECTION_LABEL}>Export</p>
          <p className={BODY_MUTED}>
            Download every lead as a CSV — name, contact, lead type, budget, score,
            status, address, notes, and assignment.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || totalLeads === 0}
            className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
          >
            {exporting ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Exporting…
              </>
            ) : (
              <>
                <Download size={13} /> Export all leads
              </>
            )}
          </button>
          {totalLeads === 0 && (
            <p className={cn(CAPTION, 'mt-2')}>Nothing to export yet.</p>
          )}
        </div>
      </section>

      {/* ── Import ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-10 border-t border-border/60">
        <div className="space-y-0.5">
          <p className={SECTION_LABEL}>Import</p>
          <p className={BODY_MUTED}>
            Upload a CSV — up to 5MB and 1,000 rows per file.
          </p>
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'relative flex flex-col items-center justify-center rounded-xl border border-dashed p-8 cursor-pointer transition-colors',
            dragOver
              ? 'border-foreground bg-foreground/[0.04]'
              : 'border-border/70 bg-muted/20 hover:border-border',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
          <FileSpreadsheet size={22} className="text-muted-foreground/60 mb-2" />
          {selectedFile ? (
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Drop a CSV here, or click to browse
              </p>
              <p className={cn(CAPTION, 'mt-1')}>Maximum 5MB, up to 1,000 rows.</p>
            </>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedFile || importing}
            className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
          >
            {importing ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Importing…
              </>
            ) : (
              <>
                <Upload size={13} /> Upload and import
              </>
            )}
          </button>
        </div>

        {importResult && (
          <div className="rounded-xl border border-border/70 bg-emerald-50/70 dark:bg-emerald-500/10 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Import complete.
              </p>
            </div>
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              <span className="font-semibold tabular-nums">{importResult.imported}</span> imported.{' '}
              <span className="font-semibold tabular-nums">{importResult.skipped}</span> skipped.
            </p>
            {importResult.errors.length > 0 && (
              <ul className="divide-y divide-border/60 max-h-40 overflow-y-auto">
                {importResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-amber-700 dark:text-amber-400 py-1.5">
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {importError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={13} className="text-destructive" />
              <p className="text-sm text-destructive">{importError}</p>
            </div>
          </div>
        )}
      </section>

      {/* ── CSV format ─────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-10 border-t border-border/60">
        <div className="space-y-0.5">
          <p className={SECTION_LABEL}>CSV format</p>
          <p className={BODY_MUTED}>
            Header row, then data rows. <span className="font-medium text-foreground">Name</span>{' '}
            is required, plus at least one of{' '}
            <span className="font-medium text-foreground">Email</span> or{' '}
            <span className="font-medium text-foreground">Phone</span>.
          </p>
        </div>

        <div className="rounded-md border border-border/70 bg-foreground/[0.02] px-3 py-2.5 overflow-x-auto">
          <p className={cn(CAPTION, 'mb-2 font-medium')}>Example</p>
          <pre className="text-xs leading-relaxed whitespace-pre font-mono text-foreground">
{`Name,Email,Phone,Lead Type,Budget,Property Address,Notes,Move-in Date,Assign To
John Smith,john@example.com,+15551234567,rental,2500,123 Main St,Looking for 2BR,2026-05-01,agent@example.com
Jane Doe,jane@example.com,+15559876543,buyer,350000,,,ASAP,`}
          </pre>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className={SECTION_LABEL}>Required</p>
            <ul className="divide-y divide-border/60">
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Name</span>
                <span className="text-muted-foreground"> — contact name</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Email</span>
                <span className="text-muted-foreground"> and/or </span>
                <span className="font-medium text-foreground">Phone</span>
              </li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <p className={SECTION_LABEL}>Optional</p>
            <ul className="divide-y divide-border/60">
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Lead Type</span>
                <span className="text-muted-foreground"> — &quot;rental&quot; (default) or &quot;buyer&quot;</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Budget</span>
                <span className="text-muted-foreground"> — numeric value</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Property Address</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Notes</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Move-in Date</span>
              </li>
              <li className="py-2 text-xs">
                <span className="font-medium text-foreground">Assign To</span>
                <span className="text-muted-foreground"> — member email address</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
