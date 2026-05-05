import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/navigation');
  return {
    ...actual,
    useRouter: () => globalThis.mockRouter,
    useSearchParams: () => globalThis.mockSearchParams,
    usePathname: () => '/invoices/inv-1',
    useParams: () => ({ id: 'inv-1' }),
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});

import InvoiceDetailPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const INVOICE = {
  id: 'inv-1',
  number: 'INV-001',
  date: '2026-04-01',
  dueDate: '2026-04-15',
  status: 'sent',
  subTotal: 500,
  totalTax: 50,
  discount: 0,
  total: 550,
  notes: null,
  currency: 'USD',
  client: { id: 'c1', company: 'Acme Co' },
  items: [
    {
      id: 'it1',
      description: 'Hosting',
      qty: 1,
      rate: 500,
      tax1: null,
      tax2: null,
      total: 500,
      order: 0,
    },
  ],
  payments: [],
};

function setupFetchMock() {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/activity-log')) {
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }
    if (u.includes('/api/v1/invoices/inv-1')) {
      return { ok: true, status: 200, json: async () => INVOICE } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  // SentEmailsPanel uses apiFetch
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk({ data: [] }));
}

describe('Invoice detail page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the invoice number in the header', async () => {
    render(<InvoiceDetailPage />);
    expect(
      await screen.findByRole('heading', { name: /invoice INV-001/i }),
    ).toBeInTheDocument();
  });

  it('renders the breadcrumbs (Invoices → Invoice #INV-001)', async () => {
    render(<InvoiceDetailPage />);
    const crumb = await screen.findByRole('link', { name: /^invoices$/i });
    expect(crumb).toHaveAttribute('href', '/invoices');
  });

  it('renders the line items', async () => {
    render(<InvoiceDetailPage />);
    expect(await screen.findByText('Hosting')).toBeInTheDocument();
  });

  it('renders the client link to the client detail page', async () => {
    render(<InvoiceDetailPage />);
    const link = await screen.findByRole('link', { name: 'Acme Co' });
    expect(link).toHaveAttribute('href', '/clients/c1');
  });

  it('renders the "Mark as Paid" action when status is sent', async () => {
    render(<InvoiceDetailPage />);
    expect(
      await screen.findByRole('button', { name: /mark as paid/i }),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<InvoiceDetailPage />);
    await screen.findByText('Hosting');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
