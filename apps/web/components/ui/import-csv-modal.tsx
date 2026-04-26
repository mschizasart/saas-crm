'use client';

/**
 * Reusable CSV import modal.
 *
 * Consumes a `multipart/form-data` endpoint that accepts a single `file` field
 * and returns `{ imported, skipped: [{row, reason}], errors: [{row, field, message}] }`.
 *
 * The same shape is produced by the clients and leads import endpoints
 * (`POST /api/v1/clients/import`, `POST /api/v1/leads/import`).
 *
 * UX:
 * - Drag-and-drop OR click-to-select a .csv file.
 * - First 3 data rows are previewed before upload.
 * - "Download template" link hits `<endpoint>/template` to grab the header row.
 * - Results panel shows counts + details after the response lands.
 */

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, FileText, X, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api';

export interface ImportResult {
  imported: number;
  skipped: Array<{ row: number; reason: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
}

export interface ImportCsvModalProps {
  open: boolean;
  onClose: () => void;
  /** Display title — e.g. "Import Clients" */
  title: string;
  /** API path for the upload endpoint, e.g. "/api/v1/clients/import" */
  endpoint: string;
  /** API path for the template download, e.g. "/api/v1/clients/import/template" */
  templatePath?: string;
  /** Static CSV template fallback (served from /public), e.g. "/templates/clients-import.csv" */
  staticTemplateHref?: string;
  /** Called after a successful import — the list page should refresh. */
  onImported?: (result: ImportResult) => void;
  /** Human-readable column hint shown at the top of the modal. */
  columnsHint?: string;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches API limit

function parseFirstRows(text: string, rowCount: number): string[][] {
  // Lightweight preview parser — doesn't need csv-parse round-trip on the server.
  // Handles quoted fields with embedded commas, but not newlines inside quotes
  // (preview only; the server parser is authoritative).
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  const out: string[][] = [];
  for (const line of lines.slice(0, rowCount + 1)) {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    out.push(fields.map((f) => f.trim()));
  }
  return out;
}

export function ImportCsvModal({
  open,
  onClose,
  title,
  endpoint,
  templatePath,
  staticTemplateHref,
  onImported,
  columnsHint,
}: ImportCsvModalProps) {
  const containerRef = useModalA11y(open, onClose);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPreview([]);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const ingestFile = useCallback((f: File) => {
    setError(null);
    setResult(null);

    if (f.size > MAX_BYTES) {
      setError(`File is too large (max 5MB). This file is ${(f.size / 1024 / 1024).toFixed(2)}MB.`);
      return;
    }
    const name = f.name.toLowerCase();
    if (!name.endsWith('.csv') && f.type !== 'text/csv' && f.type !== 'application/vnd.ms-excel') {
      setError('Please select a .csv file.');
      return;
    }

    setFile(f);

    // Read first ~64KB for preview to keep it snappy on large files.
    const slice = f.slice(0, 64 * 1024);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? '';
      setPreview(parseFirstRows(text, 3));
    };
    reader.readAsText(slice);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) ingestFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) ingestFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(endpoint, { method: 'POST', body: form });
      if (!res.ok) {
        let msg = `Server returned ${res.status}`;
        try {
          const body = await res.json();
          if (body?.message) msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const json: ImportResult = await res.json();
      setResult(json);
      if (json.imported > 0) {
        toast.success(
          `Imported ${json.imported} row${json.imported === 1 ? '' : 's'}` +
            (json.skipped.length ? ` • ${json.skipped.length} skipped` : '') +
            (json.errors.length ? ` • ${json.errors.length} errors` : ''),
        );
      } else {
        toast.message('Nothing imported', {
          description: `${json.skipped.length} skipped • ${json.errors.length} errors`,
        });
      }
      onImported?.(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      setError(msg);
      toast.error('Import failed', { description: msg });
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = async () => {
    if (templatePath) {
      // Authenticated download via fetch so the JWT is attached.
      try {
        const res = await apiFetch(templatePath);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = templatePath.split('/').pop() ?? 'template.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return;
      } catch {
        // fall through to static fallback
      }
    }
    if (staticTemplateHref) {
      const a = document.createElement('a');
      a.href = staticTemplateHref;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-csv-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 id="import-csv-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {columnsHint && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong className="text-gray-700 dark:text-gray-300">Columns:</strong> {columnsHint}
            </p>
          )}

          {/* Download template */}
          {(templatePath || staticTemplateHref) && (
            <div>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download template
              </button>
            </div>
          )}

          {/* Drop zone / file picker */}
          {!result && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFileInput}
                className="hidden"
                aria-label="CSV file"
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{file.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      reset();
                    }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 mt-1"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium text-primary">Click to select</span> or drag a CSV file here
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Up to 5MB</div>
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {!result && preview.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Preview (first {preview.length - 1} row{preview.length - 1 === 1 ? '' : 's'})
              </h3>
              <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900">
                      {preview[0]?.map((header, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap"
                        >
                          {header || <span className="text-gray-300 dark:text-gray-600">col {i + 1}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(1).map((row, ri) => (
                      <tr key={ri} className="border-t border-gray-100 dark:border-gray-800">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[200px] truncate"
                          >
                            {cell || <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-900">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">{result.imported}</p>
                  <p className="text-xs text-green-700/70 dark:text-green-400/70">Imported</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900">
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{result.skipped.length}</p>
                  <p className="text-xs text-amber-700/70 dark:text-amber-400/70">Skipped</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900">
                  <p className="text-2xl font-bold text-red-700 dark:text-red-300">{result.errors.length}</p>
                  <p className="text-xs text-red-700/70 dark:text-red-400/70">Errors</p>
                </div>
              </div>

              {result.skipped.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-gray-600 dark:text-gray-400 py-1">
                    Skipped rows ({result.skipped.length})
                  </summary>
                  <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-gray-600 dark:text-gray-400">
                    {result.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-mono text-gray-500 dark:text-gray-500">row {s.row}:</span> {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {result.errors.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer font-semibold text-red-700 dark:text-red-400 py-1">
                    Errors ({result.errors.length})
                  </summary>
                  <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-red-700 dark:text-red-400">
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">row {e.row}</span> · <strong>{e.field}</strong>:{' '}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {result.imported > 0 && (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Import complete — the list has been refreshed.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          {result ? (
            <>
              <Button variant="secondary" size="sm" onClick={reset}>
                Import another
              </Button>
              <Button variant="primary" size="sm" onClick={handleClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={handleClose} disabled={uploading}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleUpload}
                disabled={!file || uploading}
                loading={uploading}
              >
                Import
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportCsvModal;

// Re-exported for callers that want to build the URL via API_BASE without
// going through apiFetch (e.g. for opening in a new tab).
export { API_BASE, getAccessToken };
