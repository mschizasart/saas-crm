'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

interface SmsSettings {
  provider: 'TWILIO';
  accountSid: string | null;
  authTokenSet: boolean;
  fromNumber: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

interface FormState extends SmsSettings {
  /** Write-only — blank means "keep the existing token". */
  authToken: string;
}

const DEFAULT_FORM: FormState = {
  provider: 'TWILIO',
  accountSid: '',
  authToken: '',
  authTokenSet: false,
  fromNumber: '',
  enabled: false,
  updatedAt: null,
};

export default function SmsSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/sms/settings');
        if (res.ok) {
          const data: SmsSettings = await res.json();
          setForm({
            ...DEFAULT_FORM,
            ...data,
            accountSid: data.accountSid ?? '',
            fromNumber: data.fromNumber ?? '',
            authToken: '',
          });
        }
      } catch {
        toast.error('Failed to load SMS settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        provider: 'TWILIO',
        accountSid: form.accountSid || null,
        fromNumber: form.fromNumber || null,
        enabled: form.enabled,
      };
      // Only send the token when the user typed a new one — the server keeps
      // the existing encrypted value when authToken is omitted.
      if (form.authToken && form.authToken.length > 0) {
        body.authToken = form.authToken;
      }

      const res = await apiFetch('/api/v1/sms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Save failed (${res.status})`);
      }
      const data: SmsSettings = await res.json();
      setForm({
        ...DEFAULT_FORM,
        ...data,
        accountSid: data.accountSid ?? '',
        fromNumber: data.fromNumber ?? '',
        authToken: '',
      });
      toast.success('SMS settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      toast.error('Enter a phone number to send the test to');
      return;
    }
    setTesting(true);
    try {
      const body: Record<string, unknown> = { to: testTo.trim() };
      // Pass current form values so the user can test BEFORE saving. A blank
      // authToken tells the server to fall back to the saved encrypted token.
      if (form.accountSid) body.accountSid = form.accountSid;
      if (form.fromNumber) body.fromNumber = form.fromNumber;
      if (form.authToken) body.authToken = form.authToken;

      const res = await apiFetch('/api/v1/sms/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: { ok?: boolean; error?: string; sid?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(data.sid ? `Test SMS sent (${data.sid})` : 'Test SMS sent');
      } else {
        toast.error(`Test failed: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SMS test failed');
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
    );
  }

  return (
    <SettingsPageLayout
      title="SMS (Twilio)"
      description="Connect your own Twilio account to send and receive SMS from ticket and lead pages. Credentials are encrypted at rest and billed to your Twilio account."
    >
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>
          ← Settings
        </Link>
      </div>

      <SettingsSection
        title="Twilio credentials"
        description="Find your Account SID and Auth Token in the Twilio Console. Your Auth Token is encrypted at rest and never returned once saved."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Account SID"
            value={form.accountSid ?? ''}
            onChange={(v) => set('accountSid', v)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <Field
            label={
              form.authTokenSet && !form.authToken
                ? 'Auth Token (leave blank to keep current)'
                : 'Auth Token'
            }
            type="password"
            value={form.authToken}
            onChange={(v) => set('authToken', v)}
            placeholder={form.authTokenSet ? '•••••••••• (token is set)' : 'your Twilio auth token'}
          />
          <Field
            label="From number (E.164)"
            value={form.fromNumber ?? ''}
            onChange={(v) => set('fromNumber', v)}
            placeholder="+14155551234"
          />
          {form.authTokenSet && (
            <p className="sm:col-span-2 text-xs text-green-700 dark:text-green-400">
              An auth token is currently saved and encrypted. Leave the field blank
              to keep it, or type a new one to rotate it.
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Status"
        description="When disabled, sending SMS from ticket and lead pages is blocked for your organization."
      >
        <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
          />
          <span>
            <span className="font-medium">SMS enabled</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Requires Account SID, Auth Token and From number to be set.
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection
        title="Inbound webhook"
        description="To receive replies, set your Twilio number's Messaging webhook (HTTP POST) to the URL below. Inbound messages are validated against your Auth Token and logged to the matching lead/client."
      >
        <code className="block text-xs bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 break-all text-gray-700 dark:text-gray-300">
          {`{API origin}/api/v1/public/sms/webhook/{your-org-slug}`}
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Replace {'{your-org-slug}'} with your organization slug and {'{API origin}'}{' '}
          with your CRM API base URL.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Send a test SMS"
        description="Sends a one-off message using the credentials above (saved or just-typed). Standard Twilio charges apply."
      >
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Field
              label="Send test to (E.164)"
              value={testTo}
              onChange={setTestTo}
              placeholder="+14155551234"
            />
          </div>
          <Button variant="secondary" onClick={sendTest} loading={testing} disabled={saving}>
            Send test SMS
          </Button>
        </div>
      </SettingsSection>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>
    </SettingsPageLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value as string | number}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}
