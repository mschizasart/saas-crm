import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SecuritySettingsPage from './page';
import { jsonOk } from '@/test-fixtures/api';

function setupApi(opts: { enabled?: boolean } = {}) {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/v1/auth/me') {
      return jsonOk({ id: 'u1', email: 'admin@example.com' });
    }
    if (url === '/api/v1/auth/2fa/status') {
      return jsonOk({ enabled: opts.enabled ?? false, enrolledAt: null });
    }
    if (url === '/api/v1/auth/2fa/setup') {
      return jsonOk({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/foo',
        qrDataUrl: 'data:image/png;base64,FAKE_QR',
      });
    }
    return jsonOk({});
  });
}

describe('Settings → Security page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the heading and section title', async () => {
    setupApi({ enabled: false });
    render(<SecuritySettingsPage />);
    expect(
      await screen.findByRole('heading', { name: /security/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /two-factor authentication/i }),
    ).toBeInTheDocument();
  });

  it('shows the disabled state with an "Enable 2FA" CTA when 2FA is off', async () => {
    setupApi({ enabled: false });
    render(<SecuritySettingsPage />);
    expect(
      await screen.findByText(/2fa is not enabled/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /enable 2fa/i }),
    ).toBeInTheDocument();
  });

  it('shows the enabled state with disable + regenerate buttons when 2FA is on', async () => {
    setupApi({ enabled: true });
    render(<SecuritySettingsPage />);
    expect(await screen.findByText(/2fa is enabled/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /disable 2fa/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /regenerate recovery codes/i }),
    ).toBeInTheDocument();
  });

  it('opens the setup wizard when "Enable 2FA" is clicked', async () => {
    setupApi({ enabled: false });
    const user = userEvent.setup();
    render(<SecuritySettingsPage />);
    const cta = await screen.findByRole('button', { name: /enable 2fa/i });
    await user.click(cta);

    await waitFor(() => {
      expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/auth/2fa/setup',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Wizard heading is "Enable two-factor authentication"
    expect(
      await screen.findByRole('heading', {
        name: /enable two-factor authentication/i,
      }),
    ).toBeInTheDocument();
    // QR image is rendered
    expect(screen.getByAltText(/2fa qr code/i)).toBeInTheDocument();
    // Manual key shown
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
  });

  it('does not surface React render errors during render', async () => {
    setupApi({ enabled: false });
    render(<SecuritySettingsPage />);
    await screen.findByText(/2fa is not enabled/i);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
