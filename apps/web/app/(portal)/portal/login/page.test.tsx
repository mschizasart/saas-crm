import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalLoginPage from './page';

describe('Portal login page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Client Portal heading + subtitle', () => {
    render(<PortalLoginPage />);
    expect(screen.getByRole('heading', { name: /client portal/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
  });

  it('renders email + password inputs and the submit button', () => {
    render(<PortalLoginPage />);
    expect(screen.getByPlaceholderText(/you@company\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('saves the access token + navigates to /portal/dashboard on success', async () => {
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-123' }),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PortalLoginPage />);
    await user.type(screen.getByPlaceholderText(/you@company\.com/i), 'client@example.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pwd123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(localStorage.getItem('access_token')).toBe('tok-123');
      expect(globalThis.mockRouter.push).toHaveBeenCalledWith('/portal/dashboard');
    });
  });

  it('shows an error banner when the API rejects the credentials', async () => {
    global.fetch = vi.fn(async () =>
      ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PortalLoginPage />);
    await user.type(screen.getByPlaceholderText(/you@company\.com/i), 'wrong@example.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'badpass');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it('disables the submit button while the request is in flight', async () => {
    global.fetch = vi.fn(
      () => new Promise(() => undefined) as unknown as Promise<Response>,
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PortalLoginPage />);
    await user.type(screen.getByPlaceholderText(/you@company\.com/i), 'a@b.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('button', { name: /signing in/i })).toBeDisabled();
  });
});
