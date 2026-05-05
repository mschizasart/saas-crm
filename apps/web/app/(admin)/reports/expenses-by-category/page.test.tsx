import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExpensesByCategoryReportPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const REPORT = {
  grandTotal: 5500,
  uncategorizedTotal: 100,
  uncategorizedCount: 1,
  categoryCount: 3,
  hasMixedCurrency: false,
  defaultCurrency: { code: 'USD', symbol: '$', name: 'US Dollar' },
  byCategory: [
    {
      categoryId: 'cat1',
      categoryName: 'Travel',
      categoryColor: '#FF8800',
      count: 4,
      total: 2500,
      percentage: 45.4,
      hasMixedCurrency: false,
      byCurrency: [{ currencyId: null, currency: 'USD', count: 4, total: 2500 }],
    },
    {
      categoryId: 'cat2',
      categoryName: 'Hosting',
      categoryColor: '#00AA88',
      count: 6,
      total: 3000,
      percentage: 54.6,
      hasMixedCurrency: false,
      byCurrency: [{ currencyId: null, currency: 'USD', count: 6, total: 3000 }],
    },
  ],
};

const CLIENTS = { data: [{ id: 'c1', company: 'Acme Co' }] };

beforeEach(() => {
  // Recharts uses ResizeObserver; jsdom doesn't ship one.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver;
  }
});

function setupApiMock(report: unknown = REPORT) {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/clients')) return jsonOk(CLIENTS);
    if (url.includes('/reports/expenses-by-category')) return jsonOk(report);
    return jsonOk({});
  });
}

describe('Expenses by Category report page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Recharts logs warnings about missing dimensions in jsdom — silence
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupApiMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the heading and subtitle', async () => {
    render(<ExpensesByCategoryReportPage />);
    expect(
      await screen.findByRole('heading', { name: /expenses by category/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/spend grouped by expense category/i)).toBeInTheDocument();
  });

  it('renders the filter controls (billable + clients dropdown + export)', async () => {
    render(<ExpensesByCategoryReportPage />);
    expect(await screen.findByLabelText(/billable only/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
  });

  it('renders the summary strip with the total + categories + uncategorized labels', async () => {
    render(<ExpensesByCategoryReportPage />);
    // "Total" also shows up as the per-category table column header — assert
    // at least one match.
    expect((await screen.findAllByText(/^total$/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/categories/i)).toBeInTheDocument();
    expect(screen.getByText(/uncategorized/i)).toBeInTheDocument();
  });

  it('renders one row per category', async () => {
    render(<ExpensesByCategoryReportPage />);
    expect(await screen.findByText('Travel')).toBeInTheDocument();
    expect(screen.getByText('Hosting')).toBeInTheDocument();
  });

  it('renders the empty state when there are no expenses', async () => {
    setupApiMock({
      grandTotal: 0,
      uncategorizedTotal: 0,
      uncategorizedCount: 0,
      categoryCount: 0,
      hasMixedCurrency: false,
      defaultCurrency: null,
      byCategory: [],
    });
    render(<ExpensesByCategoryReportPage />);
    // The empty state renders in both the chart card and the table card.
    expect(
      (await screen.findAllByText(/no expenses/i)).length,
    ).toBeGreaterThan(0);
  });
});
