import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EstimatesPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const ESTIMATES_RESPONSE = {
  data: [
    {
      id: 'e1',
      number: 'EST-001',
      date: '2026-04-01',
      total: 1500,
      currency: 'USD',
      status: 'sent',
      client: { id: 'c1', company: 'Acme Co' },
    },
    {
      id: 'e2',
      number: 'EST-002',
      date: '2026-04-05',
      total: 2400,
      currency: 'USD',
      status: 'accepted',
      client: { id: 'c2', company: 'Globex' },
    },
  ],
  total: 2,
  page: 1,
  limit: 15,
  totalPages: 1,
};

const STATS = { draft: 1, sent: 5, accepted: 3, declined: 2, total: 11 };

function setupFetchMock(body: unknown = ESTIMATES_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/estimates/stats')) {
      return { ok: true, status: 200, json: async () => STATS } as unknown as Response;
    }
    if (u.includes('/api/v1/estimates')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk({}));
}

describe('Estimates page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page heading', async () => {
    render(<EstimatesPage />);
    expect(
      await screen.findByRole('heading', { name: /^estimates$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Estimate" CTA pointing at /estimates/new', async () => {
    render(<EstimatesPage />);
    const link = await screen.findByRole('link', { name: /new estimate/i });
    expect(link).toHaveAttribute('href', '/estimates/new');
  });

  it('renders rows for each estimate number returned by the API', async () => {
    render(<EstimatesPage />);
    expect((await screen.findAllByText('EST-001')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('EST-002')).length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are zero estimates', async () => {
    setupFetchMock({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
    render(<EstimatesPage />);
    expect(await screen.findByText(/no estimates yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /create your first estimate/i }),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<EstimatesPage />);
    await screen.findByText('EST-001');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
