'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api';
import { exportCsv } from '@/lib/export-csv';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';
import { ImportCsvModal } from '@/components/ui/import-csv-modal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: string;
  company: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  active: boolean;
}

interface HealthScore {
  clientId: string;
  company: string;
  score: number;
  grade: string;
}

const HEALTH_COLORS: Record<string, string> = {
  excellent: 'bg-green-500',
  good: 'bg-blue-500',
  at_risk: 'bg-orange-500',
  critical: 'bg-red-500',
};

const HEALTH_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  at_risk: 'At Risk',
  critical: 'Critical',
};

interface ClientsResponse {
  data: Client[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'success' : 'muted'}>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function HealthDot({ grade, score }: { grade: string; score: number }) {
  const color = HEALTH_COLORS[grade] ?? 'bg-gray-400';
  const label = HEALTH_LABELS[grade] ?? grade;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`}
      title={`Health: ${label} (${score}/100)`}
    />
  );
}

export default function ClientsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [healthScores, setHealthScores] = useState<Map<string, HealthScore>>(new Map());
  const [importOpen, setImportOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 350);

  // Fetch health scores once on mount
  useEffect(() => {
    apiFetch('/api/v1/clients/health-scores')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: HealthScore[]) => {
        if (Array.isArray(data)) {
          const map = new Map<string, HealthScore>();
          for (const hs of data) map.set(hs.clientId, hs);
          setHealthScores(map);
        }
      })
      .catch(() => {});
  }, []);

  // Reset to page 1 whenever the search term changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await apiFetch(`/api/v1/clients?${params.toString()}`);

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: ClientsResponse = await res.json();
      setClients(json.data ?? []);
      setMeta({ total: json.total ?? 0, totalPages: json.totalPages ?? 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients');
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const totalPages = meta?.totalPages ?? 1;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === clients.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(clients.map((c) => c.id)));
    }
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} client(s)?`)) return;
    setBulkLoading(true);
    for (const id of selected) {
      await apiFetch(`/api/v1/clients/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchClients();
  };

  const bulkToggleActive = async () => {
    setBulkLoading(true);
    for (const id of selected) {
      const client = clients.find((c) => c.id === id);
      if (!client) continue;
      await apiFetch(`/api/v1/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !client.active }),
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchClients();
  };

  const bulkExport = () => {
    const token = getAccessToken();
    const ids = Array.from(selected).join(',');
    window.open(`${API_BASE}/api/v1/exports/clients?format=xlsx&ids=${ids}&token=${token}`, '_blank');
  };

  const filtersNode = (
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" aria-hidden="true" />
      <input
        type="text"
        placeholder="Search clients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search clients"
        className={`${inputClass} pl-9`}
      />
    </div>
  );

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.total} client{meta.total !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Clients"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (debouncedSearch) params.set('search', debouncedSearch);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/clients/export${qs ? `?${qs}` : ''}`,
              `clients-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'clients' },
            );
          },
        },
        { label: 'Import CSV', onClick: () => setImportOpen(true) },
      ]}
      primaryAction={{ label: 'New Client', href: '/clients/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && (
          <ErrorBanner message={error} onRetry={fetchClients} />
        )}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))
        ) : clients.length === 0 ? (
          <EmptyState
            icon={<Users className="w-10 h-10" />}
            title={search ? `No clients match "${search}"` : 'No clients found'}
            action={!search ? { label: 'Add your first client', href: '/clients/new' } : undefined}
          />
        ) : (
          clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`} className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-gray-200 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                    {healthScores.get(client.id) && (
                      <HealthDot grade={healthScores.get(client.id)!.grade} score={healthScores.get(client.id)!.score} />
                    )}
                    {client.company}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{client.phone ?? 'No phone'}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {[client.city, client.country].filter(Boolean).join(', ') || 'No location'}
                  </p>
                </div>
                <ActiveBadge active={client.active} />
              </div>
            </Link>
          ))
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card (desktop)                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card className="hidden md:block">
        {error && (
          <div className="border-b border-red-100">
            <ErrorBanner message={error} onRetry={fetchClients} className="rounded-none border-0 border-b border-red-100" />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={clients.length > 0 && selected.size === clients.length}
                    onChange={toggleAll}
                    aria-label="Select all clients"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3 hidden lg:table-cell">Health</th>
                <th className="px-4 py-3 hidden lg:table-cell">Phone</th>
                <th className="px-4 py-3 hidden lg:table-cell">Website</th>
                <th className="px-4 py-3 hidden lg:table-cell">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={8} columns={8} columnWidths={['16px', '40%', '20%', '25%', '25%', '30%', '20%', '15%']} />
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <EmptyState
                      icon={<Users className="w-10 h-10" />}
                      title={search ? `No clients match "${search}"` : 'No clients found'}
                      action={!search ? { label: 'Add your first client', href: '/clients/new' } : undefined}
                    />
                  </td>
                </tr>
              ) : (
                clients.map((client) => (
                  <tr
                    key={client.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(client.id)}
                        onChange={() => toggleSelect(client.id)}
                        aria-label={`Select ${client.company}`}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {client.company}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {healthScores.get(client.id) ? (
                        <span className="flex items-center gap-1.5">
                          <HealthDot
                            grade={healthScores.get(client.id)!.grade}
                            score={healthScores.get(client.id)!.score}
                          />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {healthScores.get(client.id)!.score}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {client.phone ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {client.website ? (
                        <a
                          href={client.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline truncate max-w-[160px] block"
                        >
                          {client.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {[client.city, client.country].filter(Boolean).join(', ') || (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ActiveBadge active={client.active} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/clients/${client.id}`}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors"
                        >
                          View
                        </Link>
                        <Link
                          href={`/clients/${client.id}/edit`}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors"
                        >
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </Card>

      {/* CSV import modal */}
      <ImportCsvModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Clients from CSV"
        endpoint="/api/v1/clients/import"
        templatePath="/api/v1/clients/import/template"
        staticTemplateHref="/templates/clients-import.csv"
        columnsHint="company (required), email, phone, website, address, city, country, vatNumber, currency, notes"
        onImported={(r) => {
          if (r.imported > 0) fetchClients();
        }}
      />

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkLoading}>
            Delete
          </Button>
          <button
            onClick={bulkToggleActive}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Toggle Active
          </button>
          <button
            onClick={bulkExport}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Export
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-2 text-gray-400 dark:text-gray-500 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </ListPageLayout>
  );
}
