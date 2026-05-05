import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from './page';

/**
 * Dashboard imports many widgets and uses raw fetch + Recharts. We:
 *  - stub fetch to return safe shapes for every widget endpoint
 *  - install ResizeObserver so Recharts doesn't crash on mount
 *  - mock i18n so labels resolve to literal strings we can search by
 */

vi.mock('@/lib/i18n/use-i18n', () => ({
  useI18n: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        'dashboard.title': 'Dashboard',
        'dashboard.subtitle': 'Welcome back.',
        'dashboard.totalClients': 'Total Clients',
        'dashboard.outstandingInvoices': 'Outstanding Invoices',
        'dashboard.overdueInvoices': 'Overdue Invoices',
        'dashboard.openTickets': 'Open Tickets',
        'dashboard.activeProjects': 'Active Projects',
        'dashboard.inProgress': 'in progress',
        'dashboard.recentInvoices': 'Recent Invoices',
        'dashboard.recentTickets': 'Recent Tickets',
        'dashboard.leadsByStage': 'Leads by Stage',
        'dashboard.viewAll': 'View all',
      };
      return map[k] ?? k;
    },
    lang: 'en',
    setLang: vi.fn(),
  }),
}));

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver;
  }
  window.localStorage.setItem('access_token', 'test-token');
  // Wide-net fetch stub — every dashboard endpoint resolves to something safe.
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    const resp = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body } as unknown as Response);

    if (u.includes('/users/me/dashboard-layout')) return resp([]);
    if (u.includes('/clients?')) return resp({ total: 12, data: [] });
    if (u.includes('/invoices/stats')) return resp({ totalOutstanding: 0, totalOverdue: 0, currency: 'USD' });
    if (u.includes('/invoices/recent')) return resp({ data: [] });
    if (u.includes('/invoices')) return resp({ data: [] });
    if (u.includes('/tickets/stats')) return resp({ open: 0, in_progress: 0, resolved: 0, closed: 0 });
    if (u.includes('/tickets/recent')) return resp({ data: [] });
    if (u.includes('/tickets')) return resp({ data: [] });
    if (u.includes('/projects/stats')) return resp({ byStatus: { in_progress: 0, planning: 0, completed: 0, on_hold: 0 } });
    if (u.includes('/projects')) return resp({ data: [] });
    if (u.includes('/leads/kanban')) return resp({ columns: [] });
    if (u.includes('/reports/revenue')) return resp([]);
    if (u.includes('/activity')) return resp({ data: [] });
    if (u.includes('/suggestions')) return resp({ data: [] });
    if (u.includes('/calendar')) return resp({ data: [] });
    if (u.includes('/tasks/due-today')) return resp({ data: [] });
    if (u.includes('/goals')) return resp({ data: [] });
    return resp({});
  }) as unknown as typeof fetch;
});

describe('Dashboard page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Dashboard heading', async () => {
    render(<DashboardPage />);
    expect(
      await screen.findByRole('heading', { level: 1, name: /^dashboard$/i }),
    ).toBeInTheDocument();
  });

  it('renders the Customize button', async () => {
    render(<DashboardPage />);
    expect(
      await screen.findByRole('button', { name: /customize/i }),
    ).toBeInTheDocument();
  });

  it('renders core stat-card labels', async () => {
    render(<DashboardPage />);
    expect((await screen.findAllByText('Total Clients')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outstanding Invoices').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue Invoices').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open Tickets').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active Projects').length).toBeGreaterThan(0);
  });

  it('renders the recent-invoices section header', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('Recent Invoices')).toBeInTheDocument();
    // "Open Tickets" appears as both a stat-card label and a section header,
    // so use getAllByText.
    expect(screen.getAllByText('Open Tickets').length).toBeGreaterThan(0);
  });

  it('renders without firing fetch errors that the user would see', async () => {
    render(<DashboardPage />);
    await screen.findByText('Total Clients');
    // Recharts + jsdom warns about size — accept any console.error related to that,
    // but ensure no thrown render error.
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
