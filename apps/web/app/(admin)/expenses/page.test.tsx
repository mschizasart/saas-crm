import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExpensesPage from './page';

const EXPENSES_RESPONSE = {
  data: [
    {
      id: 'ex1',
      name: 'Office supplies',
      amount: 125.5,
      date: '2026-04-01',
      billable: false,
      category: { id: 'cat1', name: 'Office' },
      client: null,
    },
    {
      id: 'ex2',
      name: 'Cloud hosting',
      amount: 450,
      date: '2026-04-03',
      billable: true,
      category: { id: 'cat2', name: 'Hosting' },
      client: { id: 'c1', company: 'Acme Co' },
    },
  ],
};

const STATS = { total: 575.5, billable: 450, reimbursed: 0 };
const CATEGORIES = [{ id: 'cat1', name: 'Office' }, { id: 'cat2', name: 'Hosting' }];
const CLIENTS = { data: [{ id: 'c1', company: 'Acme Co' }] };

function setupFetchMock(body: unknown = EXPENSES_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/expenses/categories')) {
      return { ok: true, status: 200, json: async () => CATEGORIES } as unknown as Response;
    }
    if (u.includes('/expenses/stats')) {
      return { ok: true, status: 200, json: async () => STATS } as unknown as Response;
    }
    if (u.includes('/clients')) {
      return { ok: true, status: 200, json: async () => CLIENTS } as unknown as Response;
    }
    if (u.includes('/api/v1/expenses')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Expenses page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Expenses heading', async () => {
    render(<ExpensesPage />);
    expect(
      await screen.findByRole('heading', { name: /^expenses$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Expense" CTA pointing at /expenses/new', async () => {
    render(<ExpensesPage />);
    const link = await screen.findByRole('link', { name: /new expense/i });
    expect(link).toHaveAttribute('href', '/expenses/new');
  });

  it('renders the filter dropdowns + date inputs', async () => {
    render(<ExpensesPage />);
    expect(await screen.findByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it('renders one row per expense', async () => {
    render(<ExpensesPage />);
    expect((await screen.findAllByText('Office supplies')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Cloud hosting')).length).toBeGreaterThan(0);
  });

  it('does not surface React render errors', async () => {
    render(<ExpensesPage />);
    await screen.findByText('Office supplies');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
