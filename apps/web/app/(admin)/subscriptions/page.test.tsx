import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubscriptionsPage from './page';

const SUBS_RESPONSE = {
  data: [
    {
      id: 's1',
      name: 'Pro plan',
      unitPrice: 99,
      quantity: 1,
      total: 99,
      currency: 'USD',
      status: 'active',
      nextDueDate: '2026-05-01',
      interval: 'month',
      intervalCount: 1,
      client: { id: 'c1', company: 'Acme Co' },
    },
    {
      id: 's2',
      name: 'Enterprise plan',
      unitPrice: 999,
      quantity: 1,
      total: 999,
      currency: 'USD',
      status: 'paused',
      nextDueDate: null,
      interval: 'year',
      intervalCount: 1,
      client: null,
    },
  ],
};

function setupFetchMock(body: unknown = SUBS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async () =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response),
  ) as unknown as typeof fetch;
}

describe('Subscriptions page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Subscriptions heading', async () => {
    render(<SubscriptionsPage />);
    expect(
      await screen.findByRole('heading', { name: /^subscriptions$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Subscription" CTA pointing at /subscriptions/new', async () => {
    render(<SubscriptionsPage />);
    const link = await screen.findByRole('link', { name: /new subscription/i });
    expect(link).toHaveAttribute('href', '/subscriptions/new');
  });

  it('renders the all/active/paused/cancelled status tabs', async () => {
    render(<SubscriptionsPage />);
    expect(await screen.findByRole('tab', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /paused/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /cancelled/i })).toBeInTheDocument();
  });

  it('renders one row per subscription', async () => {
    render(<SubscriptionsPage />);
    expect(await screen.findByText('Pro plan')).toBeInTheDocument();
    expect(screen.getByText('Enterprise plan')).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<SubscriptionsPage />);
    await screen.findByText('Pro plan');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
