import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SentEmailsPanel } from './sent-emails-panel';

const fixture = [
  {
    id: 'om1',
    subject: 'Invoice 1234',
    recipientEmail: 'client@example.com',
    sentAt: new Date('2026-04-01T10:00:00Z').toISOString(),
    openedAt: new Date('2026-04-01T11:30:00Z').toISOString(),
    openCount: 3,
    lastOpenedAt: new Date('2026-04-01T12:00:00Z').toISOString(),
    clickedAt: new Date('2026-04-01T11:45:00Z').toISOString(),
    clickCount: 2,
    lastClickedAt: new Date('2026-04-01T12:05:00Z').toISOString(),
    clickedUrls: [
      {
        url: 'https://app.example.com/pay/abc',
        at: new Date('2026-04-01T11:45:00Z').toISOString(),
        ip: '1.2.3.4',
      },
    ],
    messageId: '<om1@example.com>',
  },
  {
    id: 'om2',
    subject: null,
    recipientEmail: null,
    sentAt: new Date('2026-04-02T10:00:00Z').toISOString(),
    openedAt: null,
    openCount: 0,
    lastOpenedAt: null,
    clickedAt: null,
    clickCount: 0,
    lastClickedAt: null,
    clickedUrls: [],
    messageId: null,
  },
];

beforeEach(() => {
  // Set a token so the auth header path is taken — value doesn't matter.
  window.localStorage.setItem('access_token', 'test-token');
  // Mock global fetch (this component bypasses apiFetch).
  global.fetch = vi.fn(async (_url: any) => ({
    ok: true,
    status: 200,
    json: async () => fixture,
  })) as any;
});

describe('SentEmailsPanel component', () => {
  it('renders the heading and a refresh button', async () => {
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    expect(screen.getByText(/sent emails/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /refresh|refreshing/i }),
    ).toBeInTheDocument();
  });

  it('fetches outbound messages with the right query string on mount', async () => {
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/outbound-messages?routedTo=invoice&routedToId=inv1'),
        expect.any(Object),
      );
    });
  });

  it('renders a row per outbound message with subject + recipient', async () => {
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    expect(await screen.findByText('client@example.com')).toBeInTheDocument();
    expect(screen.getByText('Invoice 1234')).toBeInTheDocument();
  });

  it('expands a row on click and shows the click log URLs', async () => {
    const user = userEvent.setup();
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    const recipient = await screen.findByText('client@example.com');

    await user.click(recipient);

    expect(await screen.findByText(/click log/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://app.example.com/pay/abc' }),
    ).toBeInTheDocument();
  });

  it('shows the empty-state message when no rows come back', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    expect(
      await screen.findByText(/no emails have been sent yet/i),
    ).toBeInTheDocument();
  });

  it('refetches when refreshKey changes', async () => {
    const { rerender } = render(
      <SentEmailsPanel routedTo="invoice" routedToId="inv1" refreshKey={1} />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    rerender(<SentEmailsPanel routedTo="invoice" routedToId="inv1" refreshKey={2} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('shows an error banner when fetch fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    render(<SentEmailsPanel routedTo="invoice" routedToId="inv1" />);
    expect(await screen.findByText(/failed/i)).toBeInTheDocument();
  });

  it('does not fetch when routedToId is falsy', async () => {
    render(<SentEmailsPanel routedTo="invoice" routedToId="" />);
    // Wait a tick — should still not call fetch.
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
