import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContractsPage from './page';

const CONTRACTS_RESPONSE = {
  data: [
    {
      id: 'k1',
      subject: 'Maintenance retainer',
      type: 'service',
      value: 5000,
      currency: 'USD',
      status: 'signed',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      client: { id: 'c1', company: 'Acme Co' },
    },
    {
      id: 'k2',
      subject: 'Consulting agreement',
      type: 'consulting',
      value: 12000,
      currency: 'USD',
      status: 'sent',
      startDate: '2026-04-01',
      endDate: '2026-09-30',
      client: { id: 'c2', company: 'Globex' },
    },
  ],
  total: 2,
  page: 1,
  limit: 15,
  totalPages: 1,
};

function setupFetchMock(body: unknown = CONTRACTS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/api/v1/contracts')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Contracts page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Contracts heading', async () => {
    render(<ContractsPage />);
    expect(
      await screen.findByRole('heading', { name: /^contracts$/i }),
    ).toBeInTheDocument();
  });

  it('renders a "New Contract" CTA pointing at /contracts/new', async () => {
    render(<ContractsPage />);
    const link = await screen.findByRole('link', { name: /new contract/i });
    expect(link).toHaveAttribute('href', '/contracts/new');
  });

  it('renders the column headers', async () => {
    render(<ContractsPage />);
    expect(await screen.findByRole('columnheader', { name: /subject/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /client/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /value/i })).toBeInTheDocument();
  });

  it('renders one row per contract', async () => {
    render(<ContractsPage />);
    expect(await screen.findByText('Maintenance retainer')).toBeInTheDocument();
    expect(screen.getByText('Consulting agreement')).toBeInTheDocument();
  });

  it('renders the empty state when there are zero contracts', async () => {
    setupFetchMock({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
    render(<ContractsPage />);
    expect(await screen.findByText(/no contracts yet/i)).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<ContractsPage />);
    await screen.findByText('Maintenance retainer');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
