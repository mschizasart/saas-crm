'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { API_BASE, getAccessToken } from '@/lib/api';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';

// ---------------------------------------------------------------------------
//  Wave H3 — CSV import upload form
//
//  Flow:
//    1. User selects entity type + file.
//    2. We render a client-side preview (first 5 rows) — no server
//       round trip. This is a sanity check only; the server re-parses
//       the file and validates columns on submit.
//    3. User clicks "Import"; we POST multipart to
//       `/api/v1/bulk/<entity>/import-csv` and navigate to the
//       resulting operation detail page.
//
//  Server still enforces:
//    - Column allow-list (rejects unknown headers).
//    - Row cap of 1000.
//    - Per-row DTO validation, with per-row error isolation.
// ---------------------------------------------------------------------------

type EntityType = 'client' | 'lead' | 'opportunity' | 'task';

const ENTITY_OPTIONS: { value: EntityType; label: string }[] = [
  { value: 'client', label: 'Clients' },
  { value: 'lead', label: 'Leads' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'task', label: 'Tasks' },
];

const PREVIEW_ROWS = 5;

// Minimal, quote-aware CSV row splitter — JUST for the client-side
// preview. The server re-parses the file with `csv-parse/sync` so any
// edge cases (escaped quotes, multi-line cells) get handled correctly
// there. This is purely a UX teaser; never the source of truth.
function previewSplit(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

interface ParsedPreview {
  header: string[];
  rows: string[][];
  totalLines: number;
}

function parsePreview(text: string): ParsedPreview {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [], totalLines: 0 };
  const header = previewSplit(lines[0]);
  const rows = lines
    .slice(1, 1 + PREVIEW_ROWS)
    .map((l) => previewSplit(l));
  return { header, rows, totalLines: lines.length };
}

export default function BulkCsvImportPage() {
  const router = useRouter();
  const [entityType, setEntityType] = useState<EntityType>('client');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string; total: number; ok: number; failed: number } | null>(null);

  async function handleFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setError(null);
    setSuccess(null);
    if (!f) return;
    try {
      const text = await f.text();
      setPreview(parsePreview(text));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to read file');
    }
  }

  async function handleSubmit() {
    if (!file) {
      setError('Please select a CSV file first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getAccessToken();
      const res = await fetch(
        `${API_BASE}/api/v1/bulk/${entityType}/import-csv`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: fd,
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.message ?? `Import failed (${res.status})`,
        );
      }
      setSuccess({
        id: body.operationId,
        total: body.total ?? 0,
        ok: body.succeeded?.length ?? 0,
        failed: body.failed?.length ?? 0,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ListPageLayout
      title="CSV Import"
      subtitle="Bulk-create records from a CSV file. Preview first 5 rows, then import up to 1000 rows per file."
      secondaryActions={[
        {
          label: 'Past imports',
          href: '/bulk/imports',
          icon: <FileText className="w-4 h-4" />,
        },
      ]}
    >
      <Card className="p-6 max-w-3xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Entity type</label>
            <select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value as EntityType);
                setSuccess(null);
              }}
              className="border rounded px-2 py-2 text-sm bg-background w-full max-w-xs"
            >
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              CSV column headers must match the entity DTO field names
              (e.g. <code>company,phone,city</code> for clients). Unknown
              columns are rejected.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border rounded px-2 py-2 bg-background"
            />
            {file && (
              <p className="text-xs text-muted-foreground mt-1">
                {file.name} — {(file.size / 1024).toFixed(1)} kB
              </p>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          {preview && preview.rows.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">
                Preview (first {Math.min(PREVIEW_ROWS, preview.rows.length)} of{' '}
                {Math.max(0, preview.totalLines - 1)} data rows)
              </div>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      {preview.header.map((h, i) => (
                        <th key={i} className="px-3 py-2 font-mono">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri} className="border-t">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 font-mono">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Preview is best-effort — server re-parses the file on import.
              </p>
            </div>
          )}

          {success && (
            <div className="border rounded p-4 bg-green-50 dark:bg-green-950/30 text-sm">
              <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-300">
                <CheckCircle2 className="w-4 h-4" />
                Import finished
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Total:</span>{' '}
                  <span className="tabular-nums">{success.total}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Succeeded:</span>{' '}
                  <span className="tabular-nums text-green-600">
                    {success.ok}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Failed:</span>{' '}
                  <span className="tabular-nums text-red-600">{success.failed}</span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/bulk/imports/${success.id}`)}
                >
                  View details
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSuccess(null);
                    setFile(null);
                    setPreview(null);
                  }}
                >
                  Import another
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <Button
              onClick={handleSubmit}
              disabled={!file || submitting || !!success}
            >
              <Upload className="w-4 h-4 mr-2" />
              {submitting ? 'Importing…' : 'Import'}
            </Button>
            <Link href="/bulk/imports">
              <Button variant="outline">Cancel</Button>
            </Link>
          </div>
        </div>
      </Card>
    </ListPageLayout>
  );
}
