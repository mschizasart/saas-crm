import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientsPage from './page';
import { clientsListResponse, emptyListResponse, jsonOk } from '@/test-fixtures/api';

/**
 * Helper — the page makes (1) a health-scores call and (2) a paginated list call
 * on mount. We mock apiFetch to dispatch by URL so the order is robust regardless
 * of which mounts first.
 */
function setupApiMock(listBody = clientsListResponse) {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/health-scores')) return jsonOk([]);
    if (url.startsWith('/api/v1/clients')) return jsonOk(listBody);
    return jsonOk({});
  });
}

describe('Clients page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page header and primary "New Client" CTA', async () => {
    setupApiMock();
    render(<ClientsPage />);
    expect(
      await screen.findByRole('heading', { name: /clients/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /new client/i }),
    ).toHaveAttribute('href', '/clients/new');
  });

  it('renders the table headers (desktop view)', async () => {
    setupApiMock();
    render(<ClientsPage />);
    expect(
      await screen.findByRole('columnheader', { name: /company/i }),
    ).toBeInTheDocument();
  });

  it('renders one row per client returned by the API', async () => {
    setupApiMock();
    render(<ClientsPage />);
    expect(await screen.findAllByText('Acme Industries')).not.toHaveLength(0);
    expect(await screen.findAllByText('Globex Corp')).not.toHaveLength(0);
    expect(await screen.findAllByText('Initech')).not.toHaveLength(0);
  });

  it('shows the empty state when no clients are returned', async () => {
    setupApiMock(emptyListResponse as any);
    render(<ClientsPage />);
    expect(
      await screen.findByText(/no clients found/i),
    ).toBeInTheDocument();
  });

  it('renders the search input and pagination controls', async () => {
    setupApiMock();
    render(<ClientsPage />);
    expect(await screen.findByLabelText(/search clients/i)).toBeInTheDocument();
    // pagination renders only when meta.total > 0
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('opens the import-CSV modal when "Import CSV" is clicked', async () => {
    setupApiMock();
    const user = userEvent.setup();
    render(<ClientsPage />);
    await screen.findAllByText('Acme Industries');
    const importBtn = screen.getByRole('button', { name: /import csv/i });
    await user.click(importBtn);
    expect(
      await screen.findByRole('dialog', { name: /import clients from csv/i }),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors during render', async () => {
    setupApiMock();
    render(<ClientsPage />);
    await waitFor(() => expect(globalThis.mockApiFetch).toHaveBeenCalled());
    await screen.findAllByText('Acme Industries');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
