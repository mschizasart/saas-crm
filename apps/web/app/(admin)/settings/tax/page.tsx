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

type Provider = 'NONE' | 'TAXJAR' | 'AVALARA';

interface OriginAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

interface TaxSettings {
  provider: Provider;
  apiKeySet: boolean;
  avalaraAccountId: string | null;
  avalaraCompanyCode: string | null;
  originAddress: OriginAddress | null;
  enabled: boolean;
  autoApply: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  updatedAt: string | null;
}

interface FormState {
  provider: Provider;
  apiKeySet: boolean;
  /** Write-only — blank means "keep the existing key". */
  apiKey: string;
  avalaraAccountId: string;
  avalaraCompanyCode: string;
  originStreet: string;
  originCity: string;
  originState: string;
  originZip: string;
  originCountry: string;
  enabled: boolean;
  autoApply: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
}

const DEFAULT_FORM: FormState = {
  provider: 'NONE',
  apiKeySet: false,
  apiKey: '',
  avalaraAccountId: '',
  avalaraCompanyCode: '',
  originStreet: '',
  originCity: '',
  originState: '',
  originZip: '',
  originCountry: '',
  enabled: false,
  autoApply: false,
  lastTestedAt: null,
  lastTestError: null,
};

function toForm(data: TaxSettings): FormState {
  const o = data.originAddress;
  return {
    provider: data.provider,
    apiKeySet: data.apiKeySet,
    apiKey: '',
    avalaraAccountId: data.avalaraAccountId ?? '',
    avalaraCompanyCode: data.avalaraCompanyCode ?? '',
    originStreet: o?.street ?? '',
    originCity: o?.city ?? '',
    originState: o?.state ?? '',
    originZip: o?.zip ?? '',
    originCountry: o?.country ?? '',
    enabled: data.enabled,
    autoApply: data.autoApply,
    lastTestedAt: data.lastTestedAt,
    lastTestError: data.lastTestError,
  };
}

export default function TaxSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/tax/settings');
        if (res.ok) {
          const data: TaxSettings = await res.json();
          setForm(toForm(data));
        }
      } catch {
        toast.error('Failed to load tax settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isNone = form.provider === 'NONE';
  const isTaxjar = form.provider === 'TAXJAR';
  const isAvalara = form.provider === 'AVALARA';

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      provider: form.provider,
      enabled: form.enabled,
      autoApply: form.autoApply,
      avalaraAccountId: isAvalara ? form.avalaraAccountId || null : null,
      avalaraCompanyCode: isAvalara ? form.avalaraCompanyCode || null : null,
      originAddress: {
        street: form.originStreet || null,
        city: form.originCity || null,
        state: form.originState || null,
        zip: form.originZip || null,
        country: form.originCountry || null,
      },
    };
    // Only send the key when the user typed a new one — the server keeps the
    // existing encrypted value when omitted.
    if (!isNone && form.apiKey && form.apiKey.length > 0) {
      body.apiKey = form.apiKey;
    }
    return body;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/tax/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Save failed (${res.status})`);
      }
      const data: TaxSettings = await res.json();
      setForm(toForm(data));
      toast.success('Tax settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      // Send the current form values so the user can test before saving.
      const body: Record<string, unknown> = isNone
        ? { provider: 'NONE' }
        : {
            provider: form.provider,
            // Blank apiKey → server falls back to the saved encrypted key.
            apiKey: form.apiKey || undefined,
            avalaraAccountId: isAvalara
              ? form.avalaraAccountId || undefined
              : undefined,
            avalaraCompanyCode: isAvalara
              ? form.avalaraCompanyCode || undefined
              : undefined,
          };
      const res = await apiFetch('/api/v1/tax/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: { ok?: boolean; error?: string; sampleTax?: number; rate?: number } =
        await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(
          typeof data.sampleTax === 'number'
            ? `Tax connection OK (sample tax $${data.sampleTax.toFixed(2)}${
                data.rate ? `, ~${data.rate}%` : ''
              })`
            : 'Tax connection OK',
        );
      } else {
        toast.error(`Test failed: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tax test failed');
    } finally {
      setTesting(false);
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
      title="Tax Automation"
      description="Auto-calculate sales tax / VAT on invoices via TaxJar or Avalara, instead of manual tax rates. This is optional — your existing manual tax rates keep working when this is off."
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
        description="Pick a tax engine, or keep manual rates. TaxJar and Avalara are billed directly to the account behind the key you provide."
      >
        <div className="space-y-3">
          <ProviderRadio
            current={form.provider}
            value="NONE"
            label="Manual tax rates (default)"
            desc="No automatic calculation. Invoices use the manual tax rates you assign per line item."
            onChange={(p) => set('provider', p)}
          />
          <ProviderRadio
            current={form.provider}
            value="TAXJAR"
            label="TaxJar"
            desc="Calculate tax via your TaxJar account. Provide your TaxJar API token below."
            onChange={(p) => set('provider', p)}
          />
          <ProviderRadio
            current={form.provider}
            value="AVALARA"
            label="Avalara AvaTax"
            desc="Calculate tax via your Avalara AvaTax account. Needs account id, license key and company code."
            onChange={(p) => set('provider', p)}
          />
        </div>
      </SettingsSection>

      {!isNone && (
        <SettingsSection
          title="Credentials"
          description="Your API key/license is encrypted at rest and never returned once saved."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label={
                form.apiKeySet && !form.apiKey
                  ? isTaxjar
                    ? 'API token (leave blank to keep current)'
                    : 'License key (leave blank to keep current)'
                  : isTaxjar
                    ? 'TaxJar API token'
                    : 'Avalara license key'
              }
              type="password"
              value={form.apiKey}
              onChange={(v) => set('apiKey', v)}
              placeholder={
                form.apiKeySet ? '•••••••••• (key is set)' : 'Paste your key'
              }
            />
            {isAvalara && (
              <>
                <Field
                  label="Avalara account id"
                  value={form.avalaraAccountId}
                  onChange={(v) => set('avalaraAccountId', v)}
                  placeholder="e.g. 1100012345"
                />
                <Field
                  label="Avalara company code"
                  value={form.avalaraCompanyCode}
                  onChange={(v) => set('avalaraCompanyCode', v)}
                  placeholder="e.g. DEFAULT"
                />
              </>
            )}
            {form.apiKeySet && (
              <p className="sm:col-span-2 text-xs text-green-700 dark:text-green-400">
                A key is currently saved and encrypted. Leave the field blank to
                keep it, or type a new one to rotate it.
              </p>
            )}
          </div>
        </SettingsSection>
      )}

      {!isNone && (
        <SettingsSection
          title="Origin address"
          description="The address you ship/bill from (your nexus). Used as the 'from' address for tax calculation. Falls back to your organization address when left blank."
        >
          <div className="space-y-3">
            <Field
              label="Street"
              value={form.originStreet}
              onChange={(v) => set('originStreet', v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="City"
                value={form.originCity}
                onChange={(v) => set('originCity', v)}
              />
              <Field
                label="State / region"
                value={form.originState}
                onChange={(v) => set('originState', v)}
                placeholder="e.g. CA"
              />
              <Field
                label="ZIP / postal code"
                value={form.originZip}
                onChange={(v) => set('originZip', v)}
              />
              <Field
                label="Country (ISO 2)"
                value={form.originCountry}
                onChange={(v) => set('originCountry', v)}
                placeholder="e.g. US"
              />
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Behaviour"
        description="When enabled, automatic tax takes precedence over manual tax1/tax2 for the invoice total. Manual tax ids stay on line items but are ignored for the computed total."
      >
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={isNone}
              onChange={(e) => set('enabled', e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30 disabled:opacity-40"
            />
            <span>
              <span className="font-medium">Enable automatic tax</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Master switch. When off, the provider is never called and manual
                rates apply.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.autoApply}
              disabled={isNone || !form.enabled}
              onChange={(e) => set('autoApply', e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30 disabled:opacity-40"
            />
            <span>
              <span className="font-medium">Auto-apply on every invoice save</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                When on, tax is recomputed and applied automatically each time an
                invoice is created or updated. When off, use the "Calculate tax"
                button on an invoice to apply it manually.
              </span>
            </span>
          </label>

          {form.lastTestedAt && (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 px-3 py-2 text-xs space-y-1">
              <div>
                <span className="text-gray-500 dark:text-gray-400">
                  Last tested:
                </span>{' '}
                <span className="text-gray-700 dark:text-gray-300">
                  {new Date(form.lastTestedAt).toLocaleString()}
                </span>
              </div>
              {form.lastTestError ? (
                <div className="text-red-600 dark:text-red-400">
                  <span className="font-medium">Last error:</span>{' '}
                  {form.lastTestError}
                </div>
              ) : (
                <div className="text-green-700 dark:text-green-400">
                  Connection OK
                </div>
              )}
            </div>
          )}
        </div>
      </SettingsSection>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={testConnection}
          loading={testing}
          disabled={saving || isNone}
        >
          Test connection
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
}: {
  current: Provider;
  value: Provider;
  label: string;
  desc: string;
  onChange: (v: Provider) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border-2 transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      }`}
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
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
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
        value={value as string | number}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400"
      />
    </div>
  );
}
