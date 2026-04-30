'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

type Provider =
  | 'SMTP'
  | 'PLATFORM_DEFAULT'
  | 'GMAIL_OAUTH'
  | 'MICROSOFT_OAUTH'
  | 'SENDGRID'
  | 'POSTMARK';

interface EmailSettings {
  provider: Provider;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpSecure: boolean;
  smtpPasswordSet: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
  oauthConnected: boolean;
  oauthConnectedEmail: string | null;
  oauthConnectedAt: string | null;
  oauthTokenExpiresAt: string | null;
  updatedAt: string | null;
  // ─── Inbound (IMAP) — added in 2026-04 IMAP inbox feature ─────
  imapEnabled?: boolean;
  imapHost?: string | null;
  imapPort?: number | null;
  imapUser?: string | null;
  imapPasswordSet?: boolean;
  imapTls?: boolean;
  imapLastSyncedAt?: string | null;
  imapLastError?: string | null;
}

interface OAuthConfigStatus {
  google: boolean;
  microsoft: boolean;
}

const DEFAULT_FORM: EmailSettings & {
  smtpPassword: string;
  imapPassword: string;
} = {
  provider: 'PLATFORM_DEFAULT',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpSecure: false,
  smtpPasswordSet: false,
  fromName: '',
  fromEmail: '',
  replyToEmail: '',
  oauthConnected: false,
  oauthConnectedEmail: null,
  oauthConnectedAt: null,
  oauthTokenExpiresAt: null,
  updatedAt: null,
  // IMAP defaults
  imapEnabled: false,
  imapHost: '',
  imapPort: 993,
  imapUser: '',
  imapPassword: '',
  imapPasswordSet: false,
  imapTls: true,
  imapLastSyncedAt: null,
  imapLastError: null,
};

export default function EmailSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImap, setTestingImap] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [oauthConfig, setOAuthConfig] = useState<OAuthConfigStatus>({
    google: false,
    microsoft: false,
  });

  // ─── Load settings + OAuth server-side configuration status ──────────
  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, cfgRes] = await Promise.all([
          apiFetch('/api/v1/email-settings'),
          apiFetch('/api/v1/email-settings/oauth/config'),
        ]);
        if (settingsRes.ok) {
          const data: EmailSettings = await settingsRes.json();
          setForm({ ...DEFAULT_FORM, ...data, smtpPassword: '', imapPassword: '' });
        }
        if (cfgRes.ok) {
          const cfg: OAuthConfigStatus = await cfgRes.json();
          setOAuthConfig(cfg);
        }
      } catch {
        toast.error('Failed to load email settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ─── Handle redirect-back from OAuth consent ─────────────────────────
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('oauth_error');
    const providerParam = searchParams.get('provider');
    const emailParam = searchParams.get('email');

    if (connected === '1') {
      toast.success(
        emailParam
          ? `Connected ${providerParam ?? 'mailbox'}: ${emailParam}`
          : `${providerParam ?? 'Mailbox'} connected`,
      );
      // Remove the query params from the URL so a refresh doesn't retrigger.
      router.replace('/settings/email');
    } else if (oauthError) {
      toast.error(`OAuth failed: ${oauthError}`);
      router.replace('/settings/email');
    }
    // We only want this to fire on mount / when the query string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isSmtp = form.provider === 'SMTP';
  const isGmail = form.provider === 'GMAIL_OAUTH';
  const isMicrosoft = form.provider === 'MICROSOFT_OAUTH';
  const isOAuth = isGmail || isMicrosoft;

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        provider: form.provider,
        smtpHost: form.smtpHost || null,
        smtpPort: form.smtpPort ? Number(form.smtpPort) : null,
        smtpUser: form.smtpUser || null,
        smtpSecure: !!form.smtpSecure,
        fromName: form.fromName || null,
        fromEmail: form.fromEmail || null,
        replyToEmail: form.replyToEmail || null,
        // ─── Inbound (IMAP) ─────────────────────────────────────
        imapEnabled: !!form.imapEnabled,
        imapHost: form.imapHost || null,
        imapPort: form.imapPort ? Number(form.imapPort) : null,
        imapUser: form.imapUser || null,
        imapTls: form.imapTls !== false,
      };
      if (form.smtpPassword && form.smtpPassword.length > 0) {
        body.smtpPassword = form.smtpPassword;
      }
      // Only include the IMAP password if the user typed a new one — the server
      // keeps the existing encrypted value when this key is omitted.
      if (form.imapPassword && form.imapPassword.length > 0) {
        body.imapPassword = form.imapPassword;
      }

      const res = await apiFetch('/api/v1/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data: EmailSettings = await res.json();
      setForm((f) => ({ ...DEFAULT_FORM, ...data, smtpPassword: '', imapPassword: '' }));
      toast.success('Email settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const to = window.prompt(
      'Send a test email to which address?',
      form.fromEmail ?? form.oauthConnectedEmail ?? '',
    );
    if (!to) return;
    setTesting(true);
    try {
      const res = await apiFetch('/api/v1/email-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const data: { ok: boolean; error?: string } = await res.json();
      if (data.ok) toast.success(`Test email sent to ${to}`);
      else toast.error(data.error ?? 'Test failed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  /**
   * Probe the IMAP connection. Sends the form's current values as an override
   * so the user can test before saving. Empty body falls back to the saved row.
   */
  async function testImap() {
    setTestingImap(true);
    try {
      const useOverride =
        !!form.imapHost ||
        !!form.imapUser ||
        (form.imapPassword && form.imapPassword.length > 0);
      const body: Record<string, unknown> = useOverride
        ? {
            host: form.imapHost || undefined,
            port: form.imapPort ? Number(form.imapPort) : undefined,
            user: form.imapUser || undefined,
            password: form.imapPassword || undefined,
            tls: form.imapTls !== false,
          }
        : {};
      const res = await apiFetch('/api/v1/email-settings/imap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: { ok?: boolean; count?: number; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(`Connected — INBOX has ${data.count ?? 0} messages`);
      } else {
        toast.error(`Failed: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'IMAP test failed');
    } finally {
      setTestingImap(false);
    }
  }

  async function connectOAuth(provider: 'google' | 'microsoft') {
    try {
      // Fetch the provider's consent URL via the API (requires auth + settings.edit).
      const res = await apiFetch(
        `/api/v1/email-settings/oauth/${provider}/start`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Start failed (${res.status})`);
      }
      const data: { authUrl: string } = await res.json();
      // Full-page redirect — consent screens don't reliably work in a popup
      // with Google's X-Frame-Options and some work-account policies.
      window.location.href = data.authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start OAuth');
    }
  }

  async function disconnectOAuth() {
    if (
      !window.confirm(
        'Disconnect the connected mailbox? Email will fall back to the platform default until you reconnect or configure SMTP.',
      )
    )
      return;
    setDisconnecting(true);
    try {
      const res = await apiFetch('/api/v1/email-settings/oauth', {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Disconnect failed (${res.status})`);
      }
      // Reload settings to reflect the cleared state.
      const settingsRes = await apiFetch('/api/v1/email-settings');
      if (settingsRes.ok) {
        const data: EmailSettings = await settingsRes.json();
        setForm({ ...DEFAULT_FORM, ...data, smtpPassword: '', imapPassword: '' });
      }
      toast.success('Mailbox disconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <SettingsPageLayout
      title="Email / SMTP"
      description="Configure how your organization sends email. Choose the platform default, plug in your own SMTP server, or connect a Google / Microsoft mailbox via OAuth."
    >
      <div className="mb-[-0.5rem]">
        <Link
          href="/settings"
          className={`${typography.bodyMuted} hover:text-primary`}
        >
          ← Settings
        </Link>
      </div>

      <SettingsSection
        title="Provider"
        description="Modern deliverability prefers OAuth. Password-based SMTP still works for self-hosted or legacy providers."
      >
        <div className="space-y-3">
          <ProviderRadio
            current={form.provider}
            value="PLATFORM_DEFAULT"
            label="Platform default"
            desc="Send through the CRM's built-in SMTP. Nothing to configure."
            onChange={(v) => set('provider', v)}
          />
          <ProviderRadio
            current={form.provider}
            value="SMTP"
            label="Custom SMTP"
            desc="Use your own SMTP host / credentials. Recommended for white-label."
            onChange={(v) => set('provider', v)}
          />
          <ProviderRadio
            current={form.provider}
            value="GMAIL_OAUTH"
            label="Gmail / Google Workspace (OAuth)"
            desc={
              oauthConfig.google
                ? 'Connect a Google mailbox — recommended for Gmail and Workspace tenants.'
                : 'Not configured on this server — ask your administrator to set GOOGLE_OAUTH_* env vars.'
            }
            onChange={(v) => set('provider', v)}
            disabled={!oauthConfig.google}
          />
          <ProviderRadio
            current={form.provider}
            value="MICROSOFT_OAUTH"
            label="Microsoft 365 / Outlook (OAuth)"
            desc={
              oauthConfig.microsoft
                ? 'Connect an Outlook or Microsoft 365 mailbox via OAuth.'
                : 'Not configured on this server — ask your administrator to set MICROSOFT_OAUTH_* env vars.'
            }
            onChange={(v) => set('provider', v)}
            disabled={!oauthConfig.microsoft}
          />
        </div>
      </SettingsSection>

      {isOAuth && (
        <SettingsSection
          title={isGmail ? 'Google connection' : 'Microsoft connection'}
          description="OAuth keeps long-lived credentials off our servers — only a refresh token is stored, encrypted at rest."
        >
          {form.oauthConnected ? (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="text-sm font-semibold text-green-900 dark:text-green-200">
                Connected as{' '}
                {form.oauthConnectedEmail ?? '(email not resolved)'}
              </div>
              <div className="text-xs text-green-800/80 dark:text-green-300/80 mt-1 space-y-0.5">
                {form.oauthConnectedAt && (
                  <div>
                    Connected{' '}
                    {new Date(form.oauthConnectedAt).toLocaleString()}
                  </div>
                )}
                {form.oauthTokenExpiresAt && (
                  <div>
                    Access token refreshes next at{' '}
                    {new Date(form.oauthTokenExpiresAt).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    connectOAuth(isGmail ? 'google' : 'microsoft')
                  }
                >
                  Reconnect
                </Button>
                <Button
                  variant="destructive"
                  onClick={disconnectOAuth}
                  loading={disconnecting}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                No mailbox connected yet. Click below and grant the CRM
                permission to send on your behalf.
              </p>
              <Button
                onClick={() => connectOAuth(isGmail ? 'google' : 'microsoft')}
              >
                Connect with {isGmail ? 'Google' : 'Microsoft'}
              </Button>
            </div>
          )}
        </SettingsSection>
      )}

      {isSmtp && (
        <SettingsSection
          title="SMTP server"
          description="Only used when provider is set to Custom SMTP."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Host *"
              value={form.smtpHost ?? ''}
              onChange={(v) => set('smtpHost', v)}
              placeholder="smtp.example.com"
            />
            <Field
              label="Port *"
              type="number"
              value={form.smtpPort ?? ''}
              onChange={(v) =>
                set('smtpPort', (v === '' ? null : Number(v)) as any)
              }
              placeholder="587"
            />
            <Field
              label="Username"
              value={form.smtpUser ?? ''}
              onChange={(v) => set('smtpUser', v)}
              placeholder="you@example.com"
            />
            <Field
              label={
                form.smtpPasswordSet && !form.smtpPassword
                  ? 'Password (leave blank to keep current)'
                  : 'Password'
              }
              type="password"
              value={form.smtpPassword}
              onChange={(v) => set('smtpPassword', v)}
              placeholder={form.smtpPasswordSet ? '••••••••' : ''}
            />
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.smtpSecure}
                onChange={(e) => set('smtpSecure', e.target.checked)}
                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
              />
              Use TLS / SSL (secure connection — required for port 465)
            </label>
          </div>
        </SettingsSection>
      )}

      {/* ─── Inbound (IMAP) ─────────────────────────────────────── */}
      <SettingsSection
        title="Inbound (IMAP)"
        description="Pull inbound email into the CRM Inbox. Messages are auto-routed to the matching lead, client, ticket, invoice or estimate based on participants and quoted IDs."
      >
        <ImapPanel
          form={form}
          set={set}
          isOAuth={isOAuth}
          oauthConnected={form.oauthConnected}
          testing={testingImap}
          onTest={testImap}
        />
      </SettingsSection>

      <SettingsSection
        title="Sender"
        description="Applied to every outgoing email regardless of transport. Leave blank to use the platform default."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="From name"
            value={form.fromName ?? ''}
            onChange={(v) => set('fromName', v)}
            placeholder="Acme Support"
          />
          <Field
            label="From email"
            type="email"
            value={form.fromEmail ?? ''}
            onChange={(v) => set('fromEmail', v)}
            placeholder={
              isOAuth && form.oauthConnectedEmail
                ? form.oauthConnectedEmail
                : 'no-reply@acme.com'
            }
          />
          <Field
            label="Reply-to email"
            type="email"
            value={form.replyToEmail ?? ''}
            onChange={(v) => set('replyToEmail', v)}
            placeholder="support@acme.com"
          />
        </div>
        {isOAuth && form.fromEmail && form.oauthConnectedEmail &&
          form.fromEmail.toLowerCase() !==
            form.oauthConnectedEmail.toLowerCase() && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Note: the From email differs from the connected mailbox — most
              providers require a verified alias, otherwise the message may
              be rejected or rewritten.
            </p>
          )}
      </SettingsSection>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={sendTest}
          loading={testing}
          disabled={saving}
        >
          Send test email
        </Button>
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>
    </SettingsPageLayout>
  );
}

function ProviderRadio({
  current,
  value,
  label,
  desc,
  onChange,
  disabled,
}: {
  current: Provider;
  value: Provider;
  label: string;
  desc: string;
  onChange: (v: Provider) => void;
  disabled?: boolean;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(value)}
      disabled={disabled}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border-2 transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
          selected ? 'border-primary bg-primary' : 'border-gray-300'
        }`}
        aria-hidden="true"
      />
      <div>
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {label}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {desc}
        </p>
      </div>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value as any}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400"
      />
    </div>
  );
}

/**
 * Inbound IMAP configuration panel — surgical addition for the IMAP inbox feature.
 * When the provider is GMAIL_OAUTH or MICROSOFT_OAUTH, IMAP credentials are
 * inherited from the OAuth refresh token and the host/port/user/password
 * fields are disabled with an explanatory note.
 */
function ImapPanel({
  form,
  set,
  isOAuth,
  oauthConnected,
  testing,
  onTest,
}: {
  form: typeof DEFAULT_FORM;
  set: <K extends keyof typeof DEFAULT_FORM>(
    key: K,
    value: (typeof DEFAULT_FORM)[K],
  ) => void;
  isOAuth: boolean;
  oauthConnected: boolean;
  testing: boolean;
  onTest: () => void;
}) {
  const credsDisabled = isOAuth;

  return (
    <div className="space-y-4">
      {/* Enabled toggle */}
      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={!!form.imapEnabled}
          onChange={(e) => set('imapEnabled', e.target.checked)}
          className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
        />
        <span>
          <span className="font-medium">Enable IMAP sync</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            When on, the scheduler polls your INBOX every few minutes and stores
            new messages in the CRM inbox.
          </span>
        </span>
      </label>

      {isOAuth && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          IMAP credentials inherited from your OAuth connection.
          {!oauthConnected && (
            <span className="block mt-1 text-amber-700 dark:text-amber-400">
              You haven't completed the OAuth consent yet — connect the mailbox
              above before enabling IMAP.
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Host"
          value={form.imapHost ?? ''}
          onChange={(v) => set('imapHost', v)}
          placeholder="imap.example.com"
          disabled={credsDisabled}
        />
        <Field
          label="Port"
          type="number"
          value={form.imapPort ?? ''}
          onChange={(v) =>
            set('imapPort', (v === '' ? null : Number(v)) as any)
          }
          placeholder="993"
          disabled={credsDisabled}
        />
        <Field
          label="Username"
          value={form.imapUser ?? ''}
          onChange={(v) => set('imapUser', v)}
          placeholder="you@example.com"
          disabled={credsDisabled}
        />
        <Field
          label={
            form.imapPasswordSet && !form.imapPassword
              ? 'Password (leave blank to keep current)'
              : 'Password'
          }
          type="password"
          value={form.imapPassword}
          onChange={(v) => set('imapPassword', v)}
          placeholder={form.imapPasswordSet ? '••••••••' : ''}
          disabled={credsDisabled}
        />
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.imapTls !== false}
            onChange={(e) => set('imapTls', e.target.checked)}
            disabled={credsDisabled}
            className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30 disabled:opacity-50"
          />
          Use TLS / SSL (recommended — required for port 993)
        </label>
      </div>

      {/* Status row */}
      <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 px-3 py-2 text-xs space-y-1">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Last synced:</span>{' '}
          <span className="text-gray-700 dark:text-gray-300">
            {form.imapLastSyncedAt
              ? `${new Date(form.imapLastSyncedAt).toLocaleString()} (${relativeFromNow(form.imapLastSyncedAt)})`
              : 'never'}
          </span>
        </div>
        {form.imapLastError && (
          <div className="text-red-600 dark:text-red-400">
            <span className="font-medium">Last error:</span> {form.imapLastError}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          variant="secondary"
          onClick={onTest}
          loading={testing}
          disabled={credsDisabled && !oauthConnected}
        >
          Test connection
        </Button>
      </div>
    </div>
  );
}

/** Tiny inlined relative-time helper — avoids pulling date-fns into this page. */
function relativeFromNow(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diffSec);
  const fmt = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'} ${diffSec >= 0 ? 'ago' : 'from now'}`;
  if (abs < 60) return fmt(abs, 'second');
  if (abs < 3600) return fmt(Math.round(abs / 60), 'minute');
  if (abs < 86400) return fmt(Math.round(abs / 3600), 'hour');
  return fmt(Math.round(abs / 86400), 'day');
}
