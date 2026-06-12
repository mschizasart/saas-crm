'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';

// ---------------------------------------------------------------------------
//  Wave H3 — Bulk operation detail page
//
//  Shows the run header + the (capped) per-row error sample.
//  The sample is at most 50 rows — surfaced clearly in the UI so the
//  user knows when there are more failures than displayed.
// ---------------------------------------------------------------------------

interface RowError {
  index: number;
  error: string;
}

interface BulkOperationDetail {
  id: string;
  organizationId: string;
  type: 'bulk_create' | 'bulk_update' | 'bulk_delete' | 'csv_import';
  entityType: 'client' | 'lead' | 'opportunity' | 'task';
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  errorsJson: RowError[];
  status: 'processing' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  createdById: string | null;
}

const ERROR_SAMPLE_CAP = 50;

const TYPE_LABELS: Record<BulkOperationDetail['type'], string> = {
  bulk_create: 'Bulk create',
  bulk_update: 'Bulk update',
  bulk_delete: 'Bulk delete',
  csv_import: 'CSV import',
};

const ENTITY_LABELS: Record<BulkOperationDetail['entityType'], string> = {
  client: 'Clients',
  lead: 'Leads',
  opportunity: 'Opportunities',
  task: 'Tasks',
};

function StatusBadge({ status }: { status: BulkOperationDetail['status'] }) {
  const variant: 'success' | 'error' | 'muted' =
    status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'muted';
  return <Badge variant={variant}>{status}</Badge>;
}

export default function BulkOperationDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [op, setOp] = useState<BulkOperationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/bulk/operations/${id}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data: BulkOperationDetail = await res.json();
      // Defend against `errorsJson` arriving as `null` from older rows.
      if (!Array.isArray(data.errorsJson)) data.errorsJson = [];
      setOp(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load bulk operation');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  if (loading) {
    return (
      <ListPageLayout title="Bulk operation" subtitle="Loading…">
        <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
      </ListPageLayout>
    );
  }

  if (error || !op) {
    return (
      <ListPageLayout title="Bulk operation">
        <ErrorBanner message={error ?? 'Not found'} />
        <Link href="/bulk/imports">
          <Button variant="outline" className="mt-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to list
          </Button>
        </Link>
      </ListPageLayout>
    );
  }

  const errorsTruncated = op.failedRows > op.errorsJson.length;
  const durationMs = op.completedAt
    ? new Date(op.completedAt).getTime() - new Date(op.startedAt).getTime()
    : null;

  return (
    <ListPageLayout
      title={`${TYPE_LABELS[op.type]} — ${ENTITY_LABELS[op.entityType]}`}
      subtitle={`Run started ${new Date(op.startedAt).toLocaleString()}`}
      secondaryActions={[
        {
          label: 'Back to list',
          href: '/bulk/imports',
          icon: <ArrowLeft className="w-4 h-4" />,
        },
      ]}
    >
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4 mb-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Status
          </div>
          <div className="mt-1">
            <StatusBadge status={op.status} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total rows
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{op.totalRows}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Succeeded
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-green-600">
            {op.succeededRows}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Failed
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-600">
            {op.failedRows}
          </div>
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3 text-sm">
          <div>
            <div className="text-muted-foreground">Started</div>
            <div>{new Date(op.startedAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Completed</div>
            <div>
              {op.completedAt ? new Date(op.completedAt).toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Duration</div>
            <div>
              {durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '—'}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="font-medium">Row errors</span>
          <span className="text-sm text-muted-foreground">
            ({op.errorsJson.length} shown
            {errorsTruncated ? `, truncated to first ${ERROR_SAMPLE_CAP}` : ''})
          </span>
        </div>
        {op.errorsJson.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No row errors recorded.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-2 w-24">Row index</th>
                <th className="px-4 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {op.errorsJson.map((e, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="px-4 py-2 tabular-nums">{e.index}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </ListPageLayout>
  );
}
