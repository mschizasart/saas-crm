import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketsPage from './page';

const TICKETS_RESPONSE = {
  data: [
    {
      id: 't1',
      subject: 'Cannot login',
      client: { id: 'c1', company: 'Acme Co' },
      clientId: 'c1',
      priority: 'urgent',
      status: 'open',
      assignedTo: 'u1',
      lastReplyAt: '2026-04-01T10:00:00Z',
    },
    {
      id: 't2',
      subject: 'Feature request: dark mode',
      client: { id: 'c2', company: 'Globex' },
      clientId: 'c2',
      priority: 'low',
      status: 'in_progress',
      assignedTo: null,
      lastReplyAt: '2026-04-02T14:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const STATS = { open: 5, urgent: 1, answered: 8, closed: 22 };

function setupFetchMock(body: unknown = TICKETS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/tickets/stats')) {
      return { ok: true, status: 200, json: async () => STATS } as unknown as Response;
    }
    if (u.includes('/api/v1/tickets')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Tickets page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Support Tickets heading', async () => {
    render(<TicketsPage />);
    expect(
      await screen.findByRole('heading', { name: /support tickets/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Ticket" CTA pointing at /tickets/new', async () => {
    render(<TicketsPage />);
    const link = await screen.findByRole('link', { name: /new ticket/i });
    expect(link).toHaveAttribute('href', '/tickets/new');
  });

  it('renders rows for each ticket subject', async () => {
    render(<TicketsPage />);
    expect((await screen.findAllByText('Cannot login')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Feature request: dark mode')).length).toBeGreaterThan(0);
  });

  it('renders the status filter chips', async () => {
    render(<TicketsPage />);
    // filter buttons all share the role of button
    expect(await screen.findByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^open$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /closed/i })).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<TicketsPage />);
    await screen.findAllByText('Cannot login');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
