'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Upload, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';

// ---------------------------------------------------------------------------
//  Wave H3 — "Bulk Imports" list page
//
//  Lists past `BulkOperation` rows for the current org. Drives the
//  "Show me my recent imports" workflow. Each row links to a detail
//  page with the per-row error sample.
// ---------------------------------------------------------------------------

interface BulkOperation {
  id: string;
  organizationId: string;
  type: 'bulk_create' | 'bulk_update' | 'bulk_delete' | 'csv_import';
  entityType: 'client' | 'lead' | 'opportunity' | 'task';
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  status: 'processing' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  createdById: string | null;
}

interface ListResponse {
  data: BulkOperation[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TYPE_LABELS: Record<BulkOperation['type'], string> = {
  bulk_create: 'Bulk create',
  bulk_update: 'Bulk update',
  bulk_delete: 'Bulk delete',
  csv_import: 'CSV import',
};

const ENTITY_LABELS: Record<BulkOperation['entityType'], string> = {
  client: 'Clients',
  lead: 'Leads',
  opportunity: 'Opportunities',
  task: 'Tasks',
};

function StatusBadge({ status }: { status: BulkOperation['status'] }) {
  const variant: 'success' | 'error' | 'muted' =
    status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'muted';
  return <Badge variant={variant}>{status}</Badge>;
}

export default function BulkImportsPage() {
  const [rows, setRows] = useState<BulkOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [entityType, setEntityType] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (entityType) params.set('entity_type', entityType);
      params.set('page', String(page));
      params.set('limit', '20');
      const res = await apiFetch(`/api/v1/bulk/operations?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data: ListResponse = await res.json();
      setRows(data.data);
      setTotalPages(data.totalPages);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load bulk operations');
    } finally {
      setLoading(false);
    }
  }, [page, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ListPageLayout
      title="Bulk Imports"
      subtitle="Past bulk-create / update / delete and CSV-import runs."
      primaryAction={{
        label: 'New CSV import',
        href: '/bulk/csv-import',
        icon: <Upload className="w-4 h-4" />,
      }}
    >
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-3">
          <label className="text-sm text-muted-foreground">Filter by entity:</label>
          <select
            value={entityType}
            onChange={(e) => {
              setPage(1);
              setEntityType(e.target.value);
            }}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            <option value="">All</option>
            <option value="client">Clients</option>
            <option value="lead">Leads</option>
            <option value="opportunity">Opportunities</option>
            <option value="task">Tasks</option>
          </select>
        </div>

        {error && <ErrorBanner message={error} />}

        {loading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8 text-muted-foreground" />}
            title="No bulk operations yet"
            description="Upload a CSV to see your first import here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">OK</th>
                <th className="px-4 py-2 text-right">Failed</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{TYPE_LABELS[r.type]}</td>
                  <td className="px-4 py-2">{ENTITY_LABELS[r.entityType]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.totalRows}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-600">
                    {r.succeededRows}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600">
                    {r.failedRows}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/bulk/imports/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="px-4 py-3 flex items-center justify-between border-t">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </ListPageLayout>
  );
}
