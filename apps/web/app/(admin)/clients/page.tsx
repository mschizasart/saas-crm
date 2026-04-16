'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: string;
  company_name: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  is_active: boolean;
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
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

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
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        active
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-500',
      ].join(' ')}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center items-center py-16">
      <svg
        className="animate-spin h-7 w-7 text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: i === 0 ? '60%' : '40%' }} />
        </td>
      ))}
    </tr>
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
  const [meta, setMeta] = useState<ClientsResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [healthScores, setHealthScores] = useState<Map<string, HealthScore>>(new Map());

  const debouncedSearch = useDebounce(search, 350);

  // Fetch health scores once on mount
  useEffect(() => {
    const token = getToken();
    fetch(`${API_BASE}/api/v1/clients/health-scores`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
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
      const token = getToken();
      const params = new URLSearchParams({ page: String(page), per_page: '15' });
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`${API_BASE}/api/v1/clients?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: ClientsResponse = await res.json();
      setClients(json.data ?? []);
      setMeta(json.meta ?? null);
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

  const totalPages = meta?.total_pages ?? 1;

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
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/clients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchClients();
  };

  const bulkToggleActive = async () => {
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      const client = clients.find((c) => c.id === id);
      if (!client) continue;
      await fetch(`${API_BASE}/api/v1/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: !client.is_active }),
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchClients();
  };

  const bulkExport = () => {
    const token = getToken();
    const ids = Array.from(selected).join(',');
    window.open(`${API_BASE}/api/v1/exports/clients?format=xlsx&ids=${ids}&token=${token}`, '_blank');
  };

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/clients/import"
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Import CSV
          </Link>
          <Link
            href="/clients/new"
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            New Client
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Search                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">
            {error} — <button className="underline" onClick={fetchClients}>retry</button>
          </div>
        )}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))
        ) : clients.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? `No clients match "${search}"` : 'No clients found'}
          </div>
        ) : (
          clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`} className="block bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-gray-200 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate flex items-center gap-1.5">
                    {healthScores.get(client.id) && (
                      <HealthDot grade={healthScores.get(client.id)!.grade} score={healthScores.get(client.id)!.score} />
                    )}
                    {client.company_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{client.phone ?? 'No phone'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[client.city, client.country].filter(Boolean).join(', ') || 'No location'}
                  </p>
                </div>
                <ActiveBadge active={client.is_active} />
              </div>
            </Link>
          ))
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card (desktop)                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} —{' '}
            <button className="underline" onClick={fetchClients}>
              retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={clients.length > 0 && selected.size === clients.length}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Health</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <svg className="w-10 h-10 opacity-40" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15l-.75 12H5.25L4.5 3zm3.75 12V9m3.75 6V9m3.75 6V9" />
                      </svg>
                      <p className="text-sm font-medium">
                        {search ? `No clients match "${search}"` : 'No clients found'}
                      </p>
                      {!search && (
                        <Link href="/clients/new" className="text-sm text-primary hover:underline">
                          Add your first client
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                clients.map((client) => (
                  <tr
                    key={client.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(client.id)}
                        onChange={() => toggleSelect(client.id)}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {client.company_name}
                    </td>
                    <td className="px-4 py-3">
                      {healthScores.get(client.id) ? (
                        <span className="flex items-center gap-1.5">
                          <HealthDot
                            grade={healthScores.get(client.id)!.grade}
                            score={healthScores.get(client.id)!.score}
                          />
                          <span className="text-xs text-gray-500">
                            {healthScores.get(client.id)!.score}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-300">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {client.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
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
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {[client.city, client.country].filter(Boolean).join(', ') || (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ActiveBadge active={client.is_active} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/clients/${client.id}`}
                          className="text-xs text-gray-500 hover:text-primary font-medium transition-colors"
                        >
                          View
                        </Link>
                        <Link
                          href={`/clients/${client.id}/edit`}
                          className="text-xs text-gray-500 hover:text-primary font-medium transition-colors"
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

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                         */}
        {/* ---------------------------------------------------------------- */}
        {!loading && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">
              {meta.total} client{meta.total !== 1 ? 's' : ''} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 min-w-[80px] text-center">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={bulkDelete}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Delete
          </button>
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
            className="ml-2 text-gray-400 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
