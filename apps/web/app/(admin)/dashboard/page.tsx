'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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
      label: 'Total Clients',
      value: totalClients !== null ? String(totalClients) : '—',
      accentClass: 'text-blue-600',
      href: '/clients',
      loading: loadingStats,
    },
    {
      label: 'Outstanding Invoices',
      value: invoiceStats ? formatCurrency(invoiceStats.totalOutstanding, statCurrency) : '—',
      accentClass: 'text-amber-600',
      href: '/invoices',
      loading: loadingStats,
    },
    {
      label: 'Overdue Invoices',
      value: invoiceStats ? formatCurrency(invoiceStats.totalOverdue, statCurrency) : '—',
      accentClass: 'text-red-600',
      href: '/invoices',
      loading: loadingStats,
    },
    {
      label: 'Open Tickets',
      value: ticketStats !== null ? String(ticketStats.open) : '—',
      accentClass: 'text-orange-600',
      href: '/tickets',
      loading: loadingStats,
    },
    {
      label: 'Active Projects',
      value: projectStats !== null ? String(projectStats.byStatus.in_progress) : '—',
      sub: 'in progress',
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back. Here&apos;s what&apos;s happening today.</p>
      </div>

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
      {/* Middle row: Recent Invoices + Recent Tickets                           */}
      {/* -------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Recent Invoices */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-1">
            <SectionHeader title="Recent Invoices" href="/invoices" linkLabel="View all" />
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
                  <EmptyRow cols={4} message="No invoices yet" />
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

        {/* Recent Tickets */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-1">
            <SectionHeader title="Open Tickets" href="/tickets" linkLabel="View all" />
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
                  <EmptyRow cols={3} message="No open tickets" />
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
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Leads by Stage                                                         */}
      {/* -------------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Leads by Stage" href="/leads" linkLabel="Open board" />

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
          <p className="text-sm text-gray-400 py-4 text-center">No lead stages configured.</p>
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
              {leadColumns.reduce((sum, col) => sum + col.cards.length, 0)} leads across{' '}
              {leadColumns.length} stage{leadColumns.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
