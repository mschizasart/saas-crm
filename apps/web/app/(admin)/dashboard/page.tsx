'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useI18n } from '@/lib/i18n/use-i18n';

// ---------------------------------------------------------------------------
// Widget system types & constants
// ---------------------------------------------------------------------------

interface WidgetConfig {
  id: string;
  label: string;
  enabled: boolean;
}

const ALL_WIDGETS: WidgetConfig[] = [
  { id: 'smart-suggestions', label: 'Smart Suggestions', enabled: true },
  { id: 'revenue-chart', label: 'Revenue Chart', enabled: true },
  { id: 'recent-invoices', label: 'Recent Invoices', enabled: true },
  { id: 'recent-tickets', label: 'Recent Tickets', enabled: true },
  { id: 'leads-by-stage', label: 'Leads by Stage', enabled: true },
  { id: 'active-projects', label: 'Active Projects', enabled: true },
  { id: 'goals-progress', label: 'Goals Progress', enabled: true },
  { id: 'calendar-preview', label: 'Calendar Preview', enabled: true },
  { id: 'tasks-due-today', label: 'Tasks Due Today', enabled: true },
  { id: 'activity-feed', label: 'Recent Activity', enabled: true },
];

function DashboardWidget({
  id,
  widgets,
  children,
}: {
  id: string;
  widgets: WidgetConfig[];
  children: React.ReactNode;
}) {
  const widget = widgets.find((w) => w.id === id);
  if (widget && !widget.enabled) return null;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientsResponse {
  total: number;
}

interface InvoiceStats {
  totalOutstanding: number;
  totalOverdue: number;
  currency: string;
}

interface TicketStats {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
}

interface ProjectStats {
  byStatus: {
    in_progress: number;
    planning: number;
    completed: number;
    on_hold: number;
  };
}

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface RecentInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  total: number;
  currency: string;
  status: InvoiceStatus;
}

interface RecentInvoicesResponse {
  data: RecentInvoice[];
}

type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

interface RecentTicket {
  id: string;
  subject: string;
  priority: TicketPriority;
  client_name: string;
  status: string;
}

interface RecentTicketsResponse {
  data: RecentTicket[];
}

interface LeadCard {
  id: string;
  title: string;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: LeadCard[];
}

interface KanbanResponse {
  columns: KanbanColumn[];
}

interface Suggestion {
  id: string;
  type: 'follow_up' | 'overdue' | 'expiring' | 'stale_lead' | 'unassigned';
  title: string;
  description: string;
  actionUrl: string;
  actionLabel: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  partial:   'bg-orange-100 text-orange-700',
  paid:      'bg-green-100 text-green-700',
  overdue:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

const TICKET_PRIORITY_BADGE: Record<TicketPriority, string> = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-yellow-100 text-yellow-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const LEAD_STAGE_COLORS: string[] = [
  'bg-blue-400',
  'bg-violet-400',
  'bg-amber-400',
  'bg-emerald-400',
  'bg-rose-400',
  'bg-cyan-400',
  'bg-indigo-400',
  'bg-teal-400',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Skeleton primitives
// ---------------------------------------------------------------------------

function SkeletonBox({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
      <SkeletonBox className="h-3 w-1/2 mb-3" />
      <SkeletonBox className="h-7 w-2/3 mb-1" />
      <SkeletonBox className="h-3 w-1/3" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  accentClass,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  accentClass: string;
  href?: string;
}) {
  const content = (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 h-full">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-bold ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full hover:opacity-90 transition-opacity">
        {content}
      </Link>
    );
  }
  return content;
}

// ---------------------------------------------------------------------------
// Invoice status badge
// ---------------------------------------------------------------------------

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        INVOICE_STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500',
      ].join(' ')}
    >
      {capitalize(status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ticket priority badge
// ---------------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        TICKET_PRIORITY_BADGE[priority] ?? 'bg-gray-100 text-gray-500',
      ].join(' ')}
    >
      {capitalize(priority)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-semibold text-gray-900 text-base">{title}</h2>
      <Link
        href={href}
        className="text-xs font-medium text-primary hover:underline"
      >
        {linkLabel} →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini table row skeletons
// ---------------------------------------------------------------------------

function MiniRowSkeleton({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonBox className={`h-4 ${i === 0 ? 'w-4/5' : 'w-1/2'}`} />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-gray-400">
        {message}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { t } = useI18n();

  // -- Stats state --
  const [totalClients, setTotalClients] = useState<number | null>(null);
  const [invoiceStats, setInvoiceStats] = useState<InvoiceStats | null>(null);
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // -- Recent invoices state --
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);

  // -- Recent tickets state --
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  // -- Leads kanban state --
  const [leadColumns, setLeadColumns] = useState<KanbanColumn[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);

  // -- Mini revenue chart (last 6 months) --
  const [revenueSeries, setRevenueSeries] = useState<
    Array<{ period: string; revenue: number }>
  >([]);
  const [loadingRevenue, setLoadingRevenue] = useState(true);

  // -- Activity feed --
  const [activityItems, setActivityItems] = useState<
    Array<{ id: string; description?: string; action?: string; createdAt: string }>
  >([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  // -- Smart suggestions --
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  // -- Widget customization --
  const [widgets, setWidgets] = useState<WidgetConfig[]>(ALL_WIDGETS.map((w) => ({ ...w })));
  const [showCustomize, setShowCustomize] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);

  // Load saved widget layout
  useEffect(() => {
    const headers = authHeaders();
    fetch(`${API_BASE}/api/v1/users/me/dashboard-layout`, { headers })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            // Merge saved config with defaults (in case new widgets were added)
            const savedMap = new Map(data.map((w: WidgetConfig) => [w.id, w]));
            setWidgets(
              ALL_WIDGETS.map((def) => {
                const saved = savedMap.get(def.id);
                return saved ? { ...def, enabled: saved.enabled } : { ...def };
              }),
            );
          }
        }
      })
      .catch(() => {});
  }, []);

  const saveLayout = useCallback(async (newWidgets: WidgetConfig[]) => {
    setSavingLayout(true);
    try {
      await fetch(`${API_BASE}/api/v1/users/me/dashboard-layout`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: newWidgets }),
      });
    } catch { /* silent */ }
    finally { setSavingLayout(false); }
  }, []);

  function toggleWidget(id: string) {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)),
    );
  }

  function moveWidget(idx: number, direction: 'up' | 'down') {
    setWidgets((prev) => {
      const arr = [...prev];
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return arr;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }

  function handleSaveLayout() {
    saveLayout(widgets);
    setShowCustomize(false);
  }

  // ---------------------------------------------------------------------------
  // Fetch everything in parallel on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const headers = authHeaders();

    // ---- Stats (4 parallel requests) ----
    Promise.allSettled([
      fetch(`${API_BASE}/api/v1/clients?limit=1`, { headers }),
      fetch(`${API_BASE}/api/v1/invoices/stats`, { headers }),
      fetch(`${API_BASE}/api/v1/tickets/stats`, { headers }),
      fetch(`${API_BASE}/api/v1/projects/stats`, { headers }),
    ])
      .then(async ([clientsRes, invoiceStatsRes, ticketStatsRes, projectStatsRes]) => {
        if (clientsRes.status === 'fulfilled' && clientsRes.value.ok) {
          const json = await clientsRes.value.json();
          // API may return { total } at top-level or inside { meta: { total } }
          setTotalClients(json.total ?? json.meta?.total ?? null);
        }
        if (invoiceStatsRes.status === 'fulfilled' && invoiceStatsRes.value.ok) {
          setInvoiceStats(await invoiceStatsRes.value.json());
        }
        if (ticketStatsRes.status === 'fulfilled' && ticketStatsRes.value.ok) {
          setTicketStats(await ticketStatsRes.value.json());
        }
        if (projectStatsRes.status === 'fulfilled' && projectStatsRes.value.ok) {
          setProjectStats(await projectStatsRes.value.json());
        }
      })
      .finally(() => setLoadingStats(false));

    // ---- Recent invoices ----
    fetch(`${API_BASE}/api/v1/invoices?limit=5`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const json: RecentInvoicesResponse = await res.json();
        setRecentInvoices(json.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingInvoices(false));

    // ---- Recent open tickets ----
    fetch(`${API_BASE}/api/v1/tickets?status=open&limit=5`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const json: RecentTicketsResponse = await res.json();
        setRecentTickets(json.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingTickets(false));

    // ---- Last 6 months revenue ----
    {
      const to = new Date();
      const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
      const qs = new URLSearchParams({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      fetch(`${API_BASE}/api/v1/reports/sales?${qs}`, { headers })
        .then(async (res) => {
          if (!res.ok) return;
          const json = await res.json();
          setRevenueSeries(json.byMonth ?? []);
        })
        .catch(() => {})
        .finally(() => setLoadingRevenue(false));
    }

    // ---- Activity feed ----
    fetch(`${API_BASE}/api/v1/activity-log?limit=10`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        setActivityItems(json.data ?? json ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingActivity(false));

    // ---- Smart suggestions ----
    fetch(`${API_BASE}/api/v1/suggestions`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        setSuggestions(Array.isArray(json) ? json : []);
      })
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false));

    // ---- Leads kanban ----
    fetch(`${API_BASE}/api/v1/leads/kanban`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const json: KanbanResponse = await res.json();
        setLeadColumns(json.columns ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingLeads(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const statCurrency = invoiceStats?.currency ?? 'USD';

  const statsCards: {
    label: string;
    value: string;
    sub?: string;
    accentClass: string;
    href?: string;
    loading: boolean;
  }[] = [
    {
      label: t('dashboard.totalClients'),
      value: totalClients !== null ? String(totalClients) : '—',
      accentClass: 'text-blue-600',
      href: '/clients',
      loading: loadingStats,
    },
    {
      label: t('dashboard.outstandingInvoices'),
      value: invoiceStats ? formatCurrency(invoiceStats.totalOutstanding, statCurrency) : '—',
      accentClass: 'text-amber-600',
      href: '/invoices',
      loading: loadingStats,
    },
    {
      label: t('dashboard.overdueInvoices'),
      value: invoiceStats ? formatCurrency(invoiceStats.totalOverdue, statCurrency) : '—',
      accentClass: 'text-red-600',
      href: '/invoices',
      loading: loadingStats,
    },
    {
      label: t('dashboard.openTickets'),
      value: ticketStats !== null ? String(ticketStats.open) : '—',
      accentClass: 'text-orange-600',
      href: '/tickets',
      loading: loadingStats,
    },
    {
      label: t('dashboard.activeProjects'),
      value: projectStats !== null ? String(projectStats.byStatus.in_progress) : '—',
      sub: t('dashboard.inProgress'),
      accentClass: 'text-green-600',
      href: '/projects',
      loading: loadingStats,
    },
  ];

  // Leads bar chart derived data
  const maxLeadCount = leadColumns.reduce((max, col) => Math.max(max, col.cards.length), 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* -------------------------------------------------------------------- */}
      {/* Page header                                                            */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCustomize(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Customize
        </button>
      </div>

      {/* Widget Customization Modal */}
      {showCustomize && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCustomize(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Customize Dashboard</h2>
              <p className="text-xs text-gray-500 mt-1">Toggle widgets on/off and reorder with arrows</p>
            </div>
            <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
              {widgets.map((w, idx) => (
                <div key={w.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => toggleWidget(w.id)}
                    className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors relative ${
                      w.enabled ? 'bg-primary' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        w.enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                  <span className={`flex-1 text-sm ${w.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                    {w.label}
                  </span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveWidget(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move up"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveWidget(idx, 'down')}
                      disabled={idx === widgets.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move down"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowCustomize(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLayout}
                disabled={savingLayout}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {savingLayout ? 'Saving...' : 'Save Layout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Stats row                                                              */}
      {/* -------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {statsCards.map((card) =>
          card.loading ? (
            <StatCardSkeleton key={card.label} />
          ) : (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              sub={card.sub}
              accentClass={card.accentClass}
              href={card.href}
            />
          )
        )}
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Smart Suggestions                                                      */}
      {/* -------------------------------------------------------------------- */}
      <DashboardWidget id="smart-suggestions" widgets={widgets}>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-base flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5.002 5.002 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Smart Suggestions
            </h2>
            {suggestions.length > 5 && (
              <button
                onClick={() => setSuggestionsExpanded((prev) => !prev)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {suggestionsExpanded ? 'Show less' : `Show all (${suggestions.length})`}
              </button>
            )}
          </div>

          {loadingSuggestions ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <SkeletonBox className="h-8 w-8 rounded-lg flex-shrink-0" />
                  <div className="flex-1">
                    <SkeletonBox className="h-4 w-3/4 mb-1" />
                    <SkeletonBox className="h-3 w-1/2" />
                  </div>
                  <SkeletonBox className="h-7 w-20 rounded-md" />
                </div>
              ))}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500">No suggestions — you&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(suggestionsExpanded ? suggestions : suggestions.slice(0, 5)).map((s) => {
                const iconMap: Record<string, string> = {
                  overdue: 'text-red-500 bg-red-50',
                  stale_lead: 'text-amber-500 bg-amber-50',
                  expiring: 'text-blue-500 bg-blue-50',
                  unassigned: 'text-violet-500 bg-violet-50',
                  follow_up: 'text-green-500 bg-green-50',
                };
                const svgMap: Record<string, React.ReactNode> = {
                  overdue: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  stale_lead: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                    </svg>
                  ),
                  expiring: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  ),
                  unassigned: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                    </svg>
                  ),
                  follow_up: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  ),
                };
                const colorClass = iconMap[s.type] ?? 'text-gray-500 bg-gray-50';
                const priorityClass =
                  s.priority === 'high'
                    ? 'bg-red-100 text-red-700'
                    : s.priority === 'medium'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-500';

                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                      {svgMap[s.type] ?? svgMap.follow_up}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.title}</p>
                      <p className="text-xs text-gray-400 truncate">{s.description}</p>
                    </div>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase flex-shrink-0 ${priorityClass}`}>
                      {s.priority}
                    </span>
                    <Link
                      href={s.actionUrl}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-primary border border-primary/20 rounded-md hover:bg-primary/5 transition-colors flex-shrink-0"
                    >
                      {s.actionLabel}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DashboardWidget>

      {/* -------------------------------------------------------------------- */}
      {/* Middle row: Recent Invoices + Recent Tickets                           */}
      {/* -------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Recent Invoices */}
        <DashboardWidget id="recent-invoices" widgets={widgets}>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-1">
            <SectionHeader title={t('dashboard.recentInvoices')} href="/invoices" linkLabel={t('dashboard.viewAll')} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-y border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-2.5">Invoice #</th>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingInvoices ? (
                  Array.from({ length: 5 }).map((_, i) => <MiniRowSkeleton key={i} cols={4} />)
                ) : recentInvoices.length === 0 ? (
                  <EmptyRow cols={4} message={t('dashboard.noInvoices')} />
                ) : (
                  recentInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[140px] truncate">
                        {inv.client_name}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">
                        {formatCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        </DashboardWidget>

        {/* Recent Tickets */}
        <DashboardWidget id="recent-tickets" widgets={widgets}>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-1">
            <SectionHeader title={t('dashboard.openTickets')} href="/tickets" linkLabel={t('dashboard.viewAll')} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-y border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Client</th>
                </tr>
              </thead>
              <tbody>
                {loadingTickets ? (
                  Array.from({ length: 5 }).map((_, i) => <MiniRowSkeleton key={i} cols={3} />)
                ) : recentTickets.length === 0 ? (
                  <EmptyRow cols={3} message={t('dashboard.noTickets')} />
                ) : (
                  recentTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-800 max-w-[200px] truncate">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="hover:text-primary transition-colors font-medium"
                        >
                          {ticket.subject}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate">
                        {ticket.client_name}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </DashboardWidget>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Revenue chart + Activity feed                                          */}
      {/* -------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <DashboardWidget id="revenue-chart" widgets={widgets}>
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title={t('dashboard.revenue')} href="/reports/sales" linkLabel={t('dashboard.fullReport')} />
          <div style={{ width: '100%', height: 220 }}>
            {loadingRevenue ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : revenueSeries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('dashboard.noRevenue')}</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        </DashboardWidget>

        <DashboardWidget id="activity-feed" widgets={widgets}>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title={t('dashboard.recentActivity')} href="/activity" linkLabel={t('dashboard.viewAll')} />
          {loadingActivity ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-6 bg-gray-50 rounded animate-pulse" />
              ))}
            </div>
          ) : activityItems.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noActivity')}</p>
          ) : (
            <ul className="space-y-2">
              {activityItems.map((a) => (
                <li key={a.id} className="text-sm border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <p className="text-gray-700 truncate">
                    {a.description ?? a.action ?? 'Activity'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(a.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        </DashboardWidget>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Leads by Stage                                                         */}
      {/* -------------------------------------------------------------------- */}
      <DashboardWidget id="leads-by-stage" widgets={widgets}>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title={t('dashboard.leadsByStage')} href="/leads" linkLabel={t('dashboard.openBoard')} />

        {loadingLeads ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <SkeletonBox className="h-4 w-28 flex-shrink-0" />
                <SkeletonBox className="h-5 rounded-full" style={{ width: `${30 + i * 15}%` } as React.CSSProperties} />
                <SkeletonBox className="h-4 w-6 flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : leadColumns.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noLeadStages')}</p>
        ) : (
          <div className="space-y-3">
            {leadColumns.map((col, idx) => {
              const count = col.cards.length;
              const pct = maxLeadCount > 0 ? Math.round((count / maxLeadCount) * 100) : 0;
              const colorClass = LEAD_STAGE_COLORS[idx % LEAD_STAGE_COLORS.length];

              return (
                <div key={col.id} className="flex items-center gap-3">
                  {/* Stage label */}
                  <span className="text-sm text-gray-600 w-32 flex-shrink-0 truncate" title={col.title}>
                    {col.title}
                  </span>

                  {/* Bar track */}
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                      style={{ width: count === 0 ? '2px' : `${Math.max(pct, 2)}%` }}
                    />
                  </div>

                  {/* Count */}
                  <span className="text-sm font-semibold text-gray-700 w-6 text-right flex-shrink-0">
                    {count}
                  </span>
                </div>
              );
            })}

            {/* Legend: total leads */}
            <p className="text-xs text-gray-400 pt-1">
              {leadColumns.reduce((sum, col) => sum + col.cards.length, 0)} {t('dashboard.leadsAcross')}{' '}
              {leadColumns.length} {leadColumns.length !== 1 ? t('dashboard.stages') : t('dashboard.stage')}
            </p>
          </div>
        )}
      </div>
      </DashboardWidget>
    </div>
  );
}
