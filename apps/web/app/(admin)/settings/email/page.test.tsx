import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmailSettingsPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const SETTINGS = {
  provider: 'PLATFORM_DEFAULT',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpSecure: false,
  smtpPasswordSet: false,
  fromName: 'Acme',
  fromEmail: 'send@acme.com',
  replyToEmail: '',
  oauthConnected: false,
  oauthConnectedEmail: null,
  oauthConnectedAt: null,
  oauthTokenExpiresAt: null,
  updatedAt: null,
  imapEnabled: false,
  imapHost: '',
  imapPort: 993,
  imapUser: '',
  imapPasswordSet: false,
  imapTls: true,
};

const OAUTH_CONFIG = { google: true, microsoft: false };

function setupApiMock() {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/email-settings/oauth/config')) return jsonOk(OAUTH_CONFIG);
    if (url.includes('/email-settings')) return jsonOk(SETTINGS);
    return jsonOk({});
  });
}

describe('Email settings page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupApiMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Email / SMTP heading', async () => {
    render(<EmailSettingsPage />);
    expect(
      await screen.findByRole('heading', { name: /email \/ smtp/i }),
    ).toBeInTheDocument();
  });

  it('renders the provider radio options', async () => {
    render(<EmailSettingsPage />);
    // "platform default" also appears in description copy on the page;
    // assert >0 matches.
    expect((await screen.findAllByText(/platform default/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/custom smtp/i)).toBeInTheDocument();
    expect(screen.getByText(/gmail \/ google workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/microsoft 365/i)).toBeInTheDocument();
  });

  it('renders the IMAP section header', async () => {
    render(<EmailSettingsPage />);
    expect(await screen.findByText(/inbound \(imap\)/i)).toBeInTheDocument();
  });

  it('renders the Sender section', async () => {
    render(<EmailSettingsPage />);
    expect(await screen.findByText(/^sender$/i)).toBeInTheDocument();
  });

  it('renders the back link to /settings', async () => {
    render(<EmailSettingsPage />);
    const back = await screen.findByRole('link', { name: /settings/i });
    expect(back).toHaveAttribute('href', '/settings');
  });

  it('does not surface React render errors', async () => {
    render(<EmailSettingsPage />);
    await screen.findAllByText(/platform default/i);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
