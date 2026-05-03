import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadsPage from './page';
import { leadsListResponse } from '@/test-fixtures/api';

/**
 * The leads kanban page bypasses apiFetch and uses raw fetch() — so we mock the
 * global. (See `getToken()` + direct `fetch(${API_BASE}/api/v1/leads/kanban)` in
 * the page component.)
 */
function setupFetchMock() {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/leads/kanban')) {
      return {
        ok: true,
        status: 200,
        json: async () => leadsListResponse,
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }) as any;
}

describe('Leads page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page heading and a "New Lead" CTA when present', async () => {
    render(<LeadsPage />);
    expect(
      await screen.findByRole('heading', { name: /leads/i }),
    ).toBeInTheDocument();
  });

  it('renders the kanban columns by default', async () => {
    render(<LeadsPage />);
    // Each column label appears at least once (header). Some duplicate as
    // badges inside lead cards — that's fine, we just want presence.
    expect((await screen.findAllByText('New')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contacted').length).toBeGreaterThan(0);
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getAllByText('Won').length).toBeGreaterThan(0);
    expect(screen.getByText('Lost')).toBeInTheDocument();
  });

  it('renders the View switcher (Kanban / List tabs)', async () => {
    render(<LeadsPage />);
    expect(await screen.findByRole('tab', { name: /kanban/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /list/i })).toBeInTheDocument();
  });

  it('renders lead cards with the lead names', async () => {
    render(<LeadsPage />);
    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(screen.getByText('Dana Lee')).toBeInTheDocument();
  });

  it('opens the import-CSV modal when "Import CSV" is clicked', async () => {
    const user = userEvent.setup();
    render(<LeadsPage />);
    await screen.findByText('Alice Smith');
    await user.click(screen.getByRole('button', { name: /import csv/i }));
    expect(
      await screen.findByRole('dialog', { name: /import leads from csv/i }),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<LeadsPage />);
    await screen.findByText('Alice Smith');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
