import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ItemsReportPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const ITEM_ROWS = [
  {
    description: 'Hosting plan',
    totalQty: 10,
    totalRevenue: 9900,
    invoiceCount: 5,
    productId: 'pr1',
    sku: 'HST-1',
    stockQuantity: null,
    trackInventory: false,
  },
  {
    description: 'Widget',
    totalQty: 30,
    totalRevenue: 297,
    invoiceCount: 12,
    productId: 'pr2',
    sku: 'WDG-1',
    stockQuantity: 8,
    trackInventory: true,
  },
];

function setupApiMock(rows: unknown[] = ITEM_ROWS) {
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk(rows));
}

describe('Items report page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupApiMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Items Report heading and subtitle', async () => {
    render(<ItemsReportPage />);
    expect(
      await screen.findByRole('heading', { name: /items report/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/line items aggregated across invoices/i)).toBeInTheDocument();
  });

  it('renders the column headers', async () => {
    render(<ItemsReportPage />);
    expect(
      await screen.findByRole('columnheader', { name: /product \/ description/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /qty sold/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /revenue/i })).toBeInTheDocument();
  });

  it('renders one row per returned item', async () => {
    render(<ItemsReportPage />);
    expect(await screen.findByText('Hosting plan')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('renders the totals stat cards', async () => {
    render(<ItemsReportPage />);
    expect(await screen.findByText('Total revenue')).toBeInTheDocument();
    expect(screen.getByText('Total qty sold')).toBeInTheDocument();
    // "Invoices" is also a column header — assert at least one match (stat card).
    expect(screen.getAllByText('Invoices').length).toBeGreaterThan(0);
  });

  it('renders the empty state when the report returns no rows', async () => {
    setupApiMock([]);
    render(<ItemsReportPage />);
    expect(await screen.findByText(/^no data$/i)).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<ItemsReportPage />);
    await screen.findByText('Hosting plan');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
