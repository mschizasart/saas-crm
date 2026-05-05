import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProposalsPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const PROPOSALS_RESPONSE = {
  data: [
    {
      id: 'p1',
      subject: 'Website redesign',
      total: 25000,
      currency: 'USD',
      status: 'sent',
      createdAt: '2026-04-01T00:00:00Z',
      client: { id: 'c1', company: 'Acme Co' },
    },
    {
      id: 'p2',
      subject: 'API integration',
      total: 15000,
      currency: 'USD',
      status: 'accepted',
      createdAt: '2026-04-04T00:00:00Z',
      client: { id: 'c2', company: 'Globex' },
    },
  ],
  total: 2,
  page: 1,
  limit: 15,
  totalPages: 1,
};

function setupFetchMock(body: unknown = PROPOSALS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/api/v1/proposals')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk({}));
}

describe('Proposals page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Proposals heading', async () => {
    render(<ProposalsPage />);
    expect(
      await screen.findByRole('heading', { name: /^proposals$/i }),
    ).toBeInTheDocument();
  });

  it('renders a "New Proposal" CTA pointing at /proposals/new', async () => {
    render(<ProposalsPage />);
    const link = await screen.findByRole('link', { name: /new proposal/i });
    expect(link).toHaveAttribute('href', '/proposals/new');
  });

  it('renders the proposal subjects returned by the API', async () => {
    render(<ProposalsPage />);
    expect((await screen.findAllByText('Website redesign')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('API integration')).length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are zero proposals', async () => {
    setupFetchMock({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
    render(<ProposalsPage />);
    expect(await screen.findByText(/no proposals yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /create your first proposal/i }),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<ProposalsPage />);
    await screen.findByText('Website redesign');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
