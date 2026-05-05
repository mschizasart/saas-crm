import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentsListPage from './page';

const PAYMENTS_RESPONSE = {
  data: [
    {
      id: 'pay1',
      amount: 250,
      currency: 'USD',
      paymentDate: '2026-04-01T00:00:00Z',
      note: null,
      invoice: { id: 'inv1', number: 'INV-001', total: 500, status: 'partial' },
      client: { id: 'c1', company: 'Acme Co' },
      paymentMode: { id: 'pm1', name: 'Bank transfer' },
    },
    {
      id: 'pay2',
      amount: 1200,
      currency: 'USD',
      paymentDate: '2026-04-04T00:00:00Z',
      note: 'Stripe charge',
      invoice: { id: 'inv2', number: 'INV-002', total: 1200, status: 'paid' },
      client: { id: 'c2', company: 'Globex' },
      paymentMode: null,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

function setupFetchMock(body: unknown = PAYMENTS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async () =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response),
  ) as unknown as typeof fetch;
}

describe('Payments page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Payments heading', async () => {
    render(<PaymentsListPage />);
    expect(
      await screen.findByRole('heading', { name: /^payments$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "Batch record" CTA pointing at /payments/batch', async () => {
    render(<PaymentsListPage />);
    const link = await screen.findByRole('link', { name: /batch record/i });
    expect(link).toHaveAttribute('href', '/payments/batch');
  });

  it('renders rows for each payment', async () => {
    render(<PaymentsListPage />);
    expect((await screen.findAllByText('INV-001')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('INV-002')).length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are zero payments', async () => {
    setupFetchMock({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    render(<PaymentsListPage />);
    expect(await screen.findByText(/no payments yet/i)).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<PaymentsListPage />);
    await screen.findByText('INV-001');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
