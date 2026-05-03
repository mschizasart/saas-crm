import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InboxPage from './page';
import { inboxMessageResponse, jsonOk } from '@/test-fixtures/api';

function setupApi() {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/inbox?')) {
      return jsonOk(inboxMessageResponse);
    }
    if (url.startsWith('/api/v1/inbox/')) {
      // Single-message GET when an id is selected.
      return jsonOk(inboxMessageResponse.data[0]);
    }
    return jsonOk({});
  });
}

describe('Inbox page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page heading + Sync button', async () => {
    setupApi();
    render(<InboxPage />);
    expect(
      await screen.findByRole('heading', { name: /inbox/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sync inbox/i }),
    ).toBeInTheDocument();
  });

  it('renders the filter tabs (All / Starred / Unmatched / Archived)', async () => {
    setupApi();
    render(<InboxPage />);
    expect(await screen.findByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^starred$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unmatched$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^archived$/i })).toBeInTheDocument();
  });

  it('fetches /api/v1/inbox on mount', async () => {
    setupApi();
    render(<InboxPage />);
    await waitFor(() => {
      expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/inbox?'),
      );
    });
  });

  it('renders message senders + subjects from the fixture', async () => {
    setupApi();
    render(<InboxPage />);
    expect(await screen.findByText(/jane sender/i)).toBeInTheDocument();
    expect(screen.getByText(/hello there/i)).toBeInTheDocument();
    expect(screen.getByText(/invoice 1234 paid/i)).toBeInTheDocument();
  });

  it('navigates to ?id= when a message row is clicked', async () => {
    setupApi();
    const user = userEvent.setup();
    render(<InboxPage />);
    const subject = await screen.findByText(/hello there/i);
    await user.click(subject);
    await waitFor(() => {
      // useRouter().replace called with /inbox?id=m1 (or similar)
      const calls = globalThis.mockRouter.replace.mock.calls;
      const matched = calls.some(([href]) => /id=m1/.test(String(href)));
      expect(matched).toBe(true);
    });
  });

  it('does not surface React render errors during render', async () => {
    setupApi();
    render(<InboxPage />);
    await screen.findByText(/jane sender/i);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
