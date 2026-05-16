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

type Provider = 'PLATFORM_DEFAULT' | 'ANTHROPIC' | 'OPENAI';

interface AiSettings {
  provider: Provider;
  apiKeySet: boolean;
  model: string | null;
  enabled: boolean;
  monthlyTokenCap: number | null;
  tokensUsedThisMonth: number;
  usageResetAt: string | null;
  lastTestedAt: string | null;
  lastTestError: string | null;
  updatedAt: string | null;
}

interface FormState extends AiSettings {
  /** Write-only — blank means "keep the existing key". */
  apiKey: string;
}

const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast, cheap (default)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — higher quality' },
];
const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini — fast, cheap (default)' },
  { value: 'gpt-4o', label: 'GPT-4o — higher quality' },
];

const DEFAULT_FORM: FormState = {
  provider: 'PLATFORM_DEFAULT',
  apiKeySet: false,
  apiKey: '',
  model: null,
  enabled: true,
  monthlyTokenCap: null,
  tokensUsedThisMonth: 0,
  usageResetAt: null,
  lastTestedAt: null,
  lastTestError: null,
  updatedAt: null,
};

export default function AiSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/ai-settings');
        if (res.ok) {
          const data: AiSettings = await res.json();
          setForm({ ...DEFAULT_FORM, ...data, apiKey: '' });
        }
      } catch {
        toast.error('Failed to load AI settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isPlatform = form.provider === 'PLATFORM_DEFAULT';
  const isAnthropic = form.provider === 'ANTHROPIC';
  const isOpenAi = form.provider === 'OPENAI';
  const modelOptions = isOpenAi ? OPENAI_MODELS : ANTHROPIC_MODELS;

  // When the provider switches to a tenant-key provider, make sure a model
  // is selected — default to the provider's first (cheap) option.
  function changeProvider(p: Provider) {
    setForm((f) => {
      let model = f.model;
      if (p === 'ANTHROPIC' && !ANTHROPIC_MODELS.some((m) => m.value === model)) {
        model = ANTHROPIC_MODELS[0].value;
      } else if (p === 'OPENAI' && !OPENAI_MODELS.some((m) => m.value === model)) {
        model = OPENAI_MODELS[0].value;
      } else if (p === 'PLATFORM_DEFAULT') {
        model = null;
      }
      return { ...f, provider: p, model };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        provider: form.provider,
        enabled: form.enabled,
        monthlyTokenCap:
          form.monthlyTokenCap && form.monthlyTokenCap > 0
            ? Number(form.monthlyTokenCap)
            : null,
      };
      if (!isPlatform) {
        body.model = form.model || null;
        // Only send the key when the user typed a new one — the server keeps
        // the existing encrypted value when this key is omitted.
        if (form.apiKey && form.apiKey.length > 0) {
          body.apiKey = form.apiKey;
        }
      }

      const res = await apiFetch('/api/v1/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Save failed (${res.status})`);
      }
      const data: AiSettings = await res.json();
      setForm({ ...DEFAULT_FORM, ...data, apiKey: '' });
      toast.success('AI settings saved');
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
      // For PLATFORM_DEFAULT, an empty body tells the server to use the
      // resolved (saved) config.
      const body: Record<string, unknown> = isPlatform
        ? {}
        : {
            provider: form.provider,
            model: form.model || undefined,
            // Blank apiKey → server falls back to the saved encrypted key.
            apiKey: form.apiKey || undefined,
          };
      const res = await apiFetch('/api/v1/ai-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: { ok?: boolean; error?: string; model?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(
          data.model
            ? `AI connection OK (${data.model})`
            : 'AI connection OK',
        );
      } else {
        toast.error(`Test failed: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI test failed');
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

  const cap = form.monthlyTokenCap ?? 0;
  const used = form.tokensUsedThisMonth ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  return (
    <SettingsPageLayout
      title="AI Provider"
      description="Bring your own AI provider and API key so token costs are billed to you, not the platform. Or stay on the platform's shared AI."
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
        description="Anthropic and OpenAI are billed directly to the key you provide. The platform default uses the CRM's shared AI."
      >
        <div className="space-y-3">
          <ProviderRadio
            current={form.provider}
            value="PLATFORM_DEFAULT"
            label="Platform default"
            desc="Uses the platform's shared AI — subject to availability. Nothing to configure."
            onChange={changeProvider}
          />
          <ProviderRadio
            current={form.provider}
            value="ANTHROPIC"
            label="Anthropic (your key)"
            desc="Use your own Anthropic API key. Token costs are billed to your Anthropic account."
            onChange={changeProvider}
          />
          <ProviderRadio
            current={form.provider}
            value="OPENAI"
            label="OpenAI (your key)"
            desc="Use your own OpenAI API key. Token costs are billed to your OpenAI account."
            onChange={changeProvider}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Credentials & model"
        description={
          isPlatform
            ? "Disabled while Platform default is selected."
            : 'Your API key is encrypted at rest and never returned once saved.'
        }
      >
        {isPlatform ? (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
            Uses the platform's shared AI — subject to availability. Switch to
            Anthropic or OpenAI to plug in your own key and model.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label={
                form.apiKeySet && !form.apiKey
                  ? 'API key (leave blank to keep current)'
                  : 'API key'
              }
              type="password"
              value={form.apiKey}
              onChange={(v) => set('apiKey', v)}
              placeholder={
                form.apiKeySet
                  ? '•••••••••• (key is set)'
                  : isAnthropic
                    ? 'sk-ant-...'
                    : 'sk-...'
              }
            />
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Model
              </label>
              <select
                value={form.model ?? modelOptions[0].value}
                onChange={(e) => set('model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {form.apiKeySet && (
              <p className="sm:col-span-2 text-xs text-green-700 dark:text-green-400">
                A key is currently saved and encrypted. Leave the field blank to
                keep it, or type a new one to rotate it.
              </p>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Usage & limits"
        description="A soft monthly cap on tokens. It's checked before each AI call (not mid-stream); once reached, AI features pause until the window rolls over."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Monthly token cap (optional)"
              type="number"
              value={form.monthlyTokenCap ?? ''}
              onChange={(v) =>
                set(
                  'monthlyTokenCap',
                  (v === '' ? null : Number(v)) as FormState['monthlyTokenCap'],
                )
              }
              placeholder="e.g. 1000000 — leave blank for no cap"
            />
          </div>

          <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 px-3 py-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">
                Used this month
              </span>
              <span className="text-gray-700 dark:text-gray-300 font-medium">
                {used.toLocaleString()}
                {cap > 0 ? ` / ${cap.toLocaleString()} tokens` : ' tokens'}
              </span>
            </div>
            {cap > 0 && (
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    pct >= 100
                      ? 'bg-red-500'
                      : pct >= 80
                        ? 'bg-amber-500'
                        : 'bg-primary'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            {form.usageResetAt && (
              <div className="text-gray-500 dark:text-gray-400">
                Window started{' '}
                {new Date(form.usageResetAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Status"
        description="Turning AI off disables every AI feature for your organization — tone rewrites, inbox summaries/drafts, and the AI half of lead scoring."
      >
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
            />
            <span>
              <span className="font-medium">AI features enabled</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                When off, AI endpoints return a clean "disabled" message and
                lead scoring falls back to its heuristic-only score.
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
          disabled={saving}
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
        value={value as string | number}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400"
      />
    </div>
  );
}
