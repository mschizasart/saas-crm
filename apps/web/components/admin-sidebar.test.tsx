import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock i18n — return the key so we can search by literal label text
vi.mock('@/lib/i18n/use-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'en', setLang: vi.fn() }),
}));

// Mock theme so the sidebar renders deterministically
vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn(), dark: false }),
}));

// Mock socket layer so the bell hook doesn't try to open a websocket
vi.mock('@/lib/socket', () => ({
  getSocket: () => null,
  disconnectSocket: vi.fn(),
}));

// Sidebar uses raw `fetch` for its notification + inbox unread counts —
// mock fetch globally to keep the component happy.
beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ count: 0, data: [] }), { status: 200 }),
  ) as unknown as typeof fetch;
});

import { AdminSidebar } from './admin-sidebar';

describe('AdminSidebar component', () => {
  it('renders the AppoinlyCRM brand', async () => {
    render(<AdminSidebar />);
    expect(await screen.findByText('AppoinlyCRM')).toBeInTheDocument();
  });

  it('renders the dashboard nav link with the right href', async () => {
    render(<AdminSidebar />);
    const dash = await screen.findByRole('link', { name: /dashboard/i });
    expect(dash).toHaveAttribute('href', '/dashboard');
  });

  it('renders the inbox nav link', async () => {
    render(<AdminSidebar />);
    expect(await screen.findByRole('link', { name: /inbox/i })).toBeInTheDocument();
  });

  it('marks the active item via the current pathname', async () => {
    globalThis.setMockPathname('/clients');
    render(<AdminSidebar />);
    // The Sales group auto-opens because the active path matches one of its
    // children. So the Clients link is mounted without us clicking the parent.
    const link = await screen.findByRole('link', { name: /nav.clients/i });
    await waitFor(() => expect(link.className).toContain('bg-sidebar-primary'));
  });

  it('renders the search-palette trigger with a kbd hint', async () => {
    render(<AdminSidebar />);
    const search = await screen.findByRole('button', { name: /search/i });
    expect(search).toBeInTheDocument();
    // kbd shows 'K'
    expect(search.textContent).toMatch(/K/);
  });

  it('expands a collapsible group when clicked', async () => {
    const user = userEvent.setup();
    render(<AdminSidebar />);
    // 'nav.sales' is a group header (button), it lazily reveals child links
    const group = await screen.findByRole('button', { name: /nav.sales/i });
    await user.click(group);
    expect(await screen.findByRole('link', { name: /nav.clients/i })).toBeInTheDocument();
  });

  it('fires onClose when the mobile close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminSidebar onClose={onClose} />);
    const closeBtn = await screen.findByRole('button', { name: /close menu/i });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the Upgrade Now CTA in the trial banner', async () => {
    render(<AdminSidebar />);
    expect(await screen.findByRole('link', { name: /trial.upgradeNow/i })).toHaveAttribute('href', '/billing');
  });
});
