import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CreditNotesPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const CN_RESPONSE = {
  data: [
    {
      id: 'cn1',
      number: 'CN-001',
      date: '2026-04-01',
      total: 250,
      status: 'open',
      client: { id: 'c1', company: 'Acme Co' },
      invoice: { id: 'inv1', number: 'INV-005' },
      invoiceId: 'inv1',
    },
    {
      id: 'cn2',
      number: 'CN-002',
      date: '2026-04-02',
      total: 75,
      status: 'applied',
      client: { id: 'c2', company: 'Globex' },
      invoice: null,
      invoiceId: null,
    },
  ],
  meta: { page: 1, total: 2, totalPages: 1 },
};

function setupFetchMock(body: unknown = CN_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async () =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response),
  ) as unknown as typeof fetch;
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk({}));
}

describe('Credit notes page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Credit Notes heading', async () => {
    render(<CreditNotesPage />);
    expect(
      await screen.findByRole('heading', { name: /credit notes/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Credit Note" CTA pointing at /credit-notes/new', async () => {
    render(<CreditNotesPage />);
    const link = await screen.findByRole('link', { name: /new credit note/i });
    expect(link).toHaveAttribute('href', '/credit-notes/new');
  });

  it('renders one row per credit note', async () => {
    render(<CreditNotesPage />);
    expect((await screen.findAllByText('CN-001')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('CN-002')).length).toBeGreaterThan(0);
  });

  it('does not surface React render errors', async () => {
    render(<CreditNotesPage />);
    await screen.findByText('CN-001');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('handles an empty list without crashing', async () => {
    setupFetchMock({ data: [], meta: { page: 1, total: 0, totalPages: 0 } });
    expect(() => render(<CreditNotesPage />)).not.toThrow();
    expect(
      await screen.findByRole('heading', { name: /credit notes/i }),
    ).toBeInTheDocument();
  });
});
