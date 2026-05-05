import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/i18n/use-i18n', () => ({
  useI18n: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        'auth.login': 'Sign In',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.forgotPassword': 'Forgot password?',
        'auth.welcomeBack': 'Welcome back',
        'auth.signInToAccount': 'Sign in to your account',
        'auth.newUser': 'New to AppoinlyCRM?',
        'auth.startTrial': 'Start your free trial',
        'auth.twoFactor': 'Two-Factor Authentication',
        'auth.twoFactorPrompt': 'Enter the 6-digit code from your authenticator app.',
        'auth.verify': 'Verify',
        'auth.backToLogin': 'Back to login',
      };
      return map[k] ?? k;
    },
    lang: 'en',
    setLang: vi.fn(),
  }),
}));

import LoginPage from './page';

function mockLoginFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) =>
    handler(String(url), init),
  ) as unknown as typeof fetch;
}

describe('Login page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the email + password fields and the submit button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/you@company\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('toggles password visibility when the eye icon is clicked', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const pw = screen.getByPlaceholderText(/••••••••/) as HTMLInputElement;
    expect(pw.type).toBe('password');
    // The eye icon is the only unlabelled <button type=button> inside the form
    const eye = pw.parentElement?.querySelector('button[type="button"]') as HTMLButtonElement;
    await user.click(eye);
    expect(pw.type).toBe('text');
  });

  it('shows a validation error when submitting an invalid email', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByPlaceholderText(/you@company\.com/i) as HTMLInputElement;
    await user.type(emailInput, 'not-an-email');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'pwd');
    // Bypass HTML5 :invalid blocking submit on the type="email" input —
    // we want React Hook Form + zod's "Invalid email address" message,
    // which is what the user actually sees once the input loses :invalid
    // (e.g. on real browsers the field is still submitted via a click
    // because RHF runs its own validation on the synthetic submit event).
    const form = emailInput.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByText(/invalid email address/i)).toBeInTheDocument();
  });

  it('renders the 2FA prompt when the API returns requires2fa', async () => {
    mockLoginFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        requires2fa: true,
        twoFactorToken: 'tok-abc',
      }),
    } as unknown as Response));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText(/you@company\.com/i), 'user@example.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'password1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByRole('heading', { name: /two-factor authentication/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  it('returns to the login form when "Back to login" is clicked from the 2FA prompt', async () => {
    mockLoginFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        requires2fa: true,
        twoFactorToken: 'tok-abc',
      }),
    } as unknown as Response));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText(/you@company\.com/i), 'user@example.com');
    await user.type(screen.getByPlaceholderText(/••••••••/), 'password1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByRole('heading', { name: /two-factor authentication/i });

    await user.click(screen.getByRole('button', { name: /back to login/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument(),
    );
  });

  it('renders a link to the trial signup', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /start your free trial/i });
    expect(link).toHaveAttribute('href', '/register');
  });
});
