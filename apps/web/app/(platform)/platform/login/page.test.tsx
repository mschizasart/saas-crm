import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlatformLoginPage from './page';

describe('Platform admin login page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Platform Admin heading', () => {
    render(<PlatformLoginPage />);
    expect(screen.getByRole('heading', { name: /platform admin/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to manage all organizations/i)).toBeInTheDocument();
  });

  it('renders email + password fields and the Sign In button', () => {
    render(<PlatformLoginPage />);
    expect(screen.getByPlaceholderText(/admin@platform\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('shows "Invalid credentials" on a 401 response', async () => {
    global.fetch = vi.fn(async () =>
      ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PlatformLoginPage />);
    await user.type(screen.getByPlaceholderText(/admin@platform\.com/i), 'a@b.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('persists the platform token + admin and routes to /platform on success', async () => {
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'plat-tok',
          admin: { id: 'a1', email: 'admin@platform.com' },
        }),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PlatformLoginPage />);
    await user.type(screen.getByPlaceholderText(/admin@platform\.com/i), 'admin@platform.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pwd');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(localStorage.getItem('platform_token')).toBe('plat-tok');
      expect(globalThis.mockRouter.replace).toHaveBeenCalledWith('/platform');
    });
  });

  it('renders the 2FA prompt when the API returns requires2fa', async () => {
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          requires2fa: true,
          twoFactorToken: 'tok-2fa',
        }),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PlatformLoginPage />);
    await user.type(screen.getByPlaceholderText(/admin@platform\.com/i), 'admin@platform.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pwd');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByRole('heading', { name: /two-factor authentication/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use a recovery code/i })).toBeInTheDocument();
  });
});
