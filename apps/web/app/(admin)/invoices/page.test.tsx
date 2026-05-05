import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvoicesPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const STATS = { outstanding: 1500, overdue: 200, paid_this_month: 7800, currency: 'USD' };

const INVOICES_RESPONSE = {
  data: [
    {
      id: 'inv1',
      number: 'INV-001',
      client: { id: 'c1', company: 'Acme Co' },
      date: '2026-04-01',
      dueDate: '2026-04-15',
      total: 500,
      currency: 'USD',
      status: 'sent',
    },
    {
      id: 'inv2',
      number: 'INV-002',
      client: { id: 'c2', company: 'Globex' },
      date: '2026-04-02',
      dueDate: '2026-04-20',
      total: 1200,
      currency: 'USD',
      status: 'paid',
    },
  ],
  total: 2,
  page: 1,
  limit: 15,
  totalPages: 1,
};

function setupFetchMock(body: unknown = INVOICES_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/invoices/stats')) {
      return { ok: true, status: 200, json: async () => STATS } as unknown as Response;
    }
    if (u.includes('/api/v1/invoices')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk({}));
}

describe('Invoices page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page heading', async () => {
    render(<InvoicesPage />);
    expect(
      await screen.findByRole('heading', { name: /^invoices$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Invoice" CTA pointing at /invoices/new', async () => {
    render(<InvoicesPage />);
    const link = await screen.findByRole('link', { name: /new invoice/i });
    expect(link).toHaveAttribute('href', '/invoices/new');
  });

  it('renders the status filter tabs', async () => {
    render(<InvoicesPage />);
    expect(await screen.findByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^draft$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sent$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^paid$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
  });

  it('renders a row per invoice number returned by the API', async () => {
    render(<InvoicesPage />);
    expect((await screen.findAllByText('INV-001')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('INV-002')).length).toBeGreaterThan(0);
  });

  it('renders the Outstanding / Overdue / Paid This Month stat cards', async () => {
    render(<InvoicesPage />);
    expect(await screen.findByText('Outstanding')).toBeInTheDocument();
    // "Overdue" also appears as a status filter tab — assert presence rather
    // than strict singularity.
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getByText('Paid This Month')).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<InvoicesPage />);
    // Mobile + desktop both render the invoice number — wait for at least one.
    await screen.findAllByText('INV-001');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
