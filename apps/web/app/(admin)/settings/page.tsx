'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/use-i18n';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/index';
import { useTheme } from '@/lib/theme';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

type TabKey = 'company' | 'email' | 'gateways' | 'taxes' | 'currencies' | 'appearance' | 'reports';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email (SMTP)' },
  { key: 'gateways', label: 'Gateways' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'currencies', label: 'Currencies' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'reports', label: 'Reports' },
];

interface Tax { id?: string; name: string; rate: number }
interface Currency { id?: string; code: string; symbol: string; name: string }

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (() => {
    const raw = searchParams?.get('tab');
    const valid = TABS.map((t) => t.key) as string[];
    // Accept "general" as an alias for "company" for back-compat with old links.
    if (raw === 'general') return 'company' as TabKey;
    if (raw && valid.includes(raw)) return raw as TabKey;
    return 'company' as TabKey;
  })();
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const setTab = (t: TabKey) => {
    setTabState(t);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', t);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };
  const [org, setOrg] = useState<any>(null);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/v1/organizations/current`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setOrg(data);
        setSettings((data.settings ?? {}) as Record<string, any>);
        setTaxes((data.settings?.taxes ?? []) as Tax[]);
        setCurrencies((data.settings?.currencies ?? []) as Currency[]);
      } catch {
        setMessage('Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setProfile = (k: string, v: any) => setOrg((o: any) => ({ ...o, [k]: v }));
  const setSetting = (k: string, v: any) => setSettings((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const token = getToken();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      // Profile fields
      await fetch(`${API_BASE}/api/v1/organizations/profile`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: org?.name,
          logo: org?.logo,
          address: org?.address,
          city: org?.city,
          state: org?.state,
          zipCode: org?.zipCode,
          country: org?.country,
          phone: org?.phone,
          website: org?.website,
          vatNumber: org?.vatNumber,
        }),
      });

      // Settings merged with taxes/currencies
      const payload = { ...settings, taxes, currencies };
      await fetch(`${API_BASE}/api/v1/organizations/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      });
      setMessage('Saved');
    } catch {
      setMessage('Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500 dark:text-gray-400 text-sm">Loading…</div>;

  const currentTabLabel = TABS.find((t) => t.key === tab)?.label ?? '';

  return (
    <SettingsPageLayout title="Settings" description="Configure your organization and global preferences">
      {message && (
        <div className="text-sm text-gray-700 dark:text-gray-300 bg-blue-50 border border-blue-100 rounded px-3 py-2">
          {message}
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SettingsSection
        title={currentTabLabel}
        footer={
          <button
            onClick={save}
            disabled={saving}
            className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      >
        {tab === 'company' && (
          <div className="space-y-4">
            <Field label="Company name" value={org?.name ?? ''} onChange={(v) => setProfile('name', v)} />
            <Field label="Logo URL" value={org?.logo ?? ''} onChange={(v) => setProfile('logo', v)} />
            <Field label="Address" value={org?.address ?? ''} onChange={(v) => setProfile('address', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" value={org?.city ?? ''} onChange={(v) => setProfile('city', v)} />
              <Field label="State" value={org?.state ?? ''} onChange={(v) => setProfile('state', v)} />
              <Field label="Zip" value={org?.zipCode ?? ''} onChange={(v) => setProfile('zipCode', v)} />
              <Field label="Country" value={org?.country ?? ''} onChange={(v) => setProfile('country', v)} />
            </div>
            <Field label="Phone" value={org?.phone ?? ''} onChange={(v) => setProfile('phone', v)} />
            <Field label="Email" value={settings.email ?? ''} onChange={(v) => setSetting('email', v)} />
            <Field label="Website" value={org?.website ?? ''} onChange={(v) => setProfile('website', v)} />
            <Field label="VAT Number" value={org?.vatNumber ?? ''} onChange={(v) => setProfile('vatNumber', v)} />
          </div>
        )}

        {tab === 'email' && (
          <div className="space-y-4">
            <Field label="SMTP Host" value={settings.smtpHost ?? ''} onChange={(v) => setSetting('smtpHost', v)} />
            <Field label="SMTP Port" value={settings.smtpPort ?? ''} onChange={(v) => setSetting('smtpPort', v)} />
            <Field label="SMTP User" value={settings.smtpUser ?? ''} onChange={(v) => setSetting('smtpUser', v)} />
            <Field label="SMTP Password" type="password" value={settings.smtpPass ?? ''} onChange={(v) => setSetting('smtpPass', v)} />
            <Field label="From Address" value={settings.smtpFrom ?? ''} onChange={(v) => setSetting('smtpFrom', v)} />
            <button
              type="button"
              onClick={() => setMessage('Test email queued (stub)')}
              className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Send test email
            </button>
          </div>
        )}

        {tab === 'gateways' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">Stripe</h2>
            <Field label="Publishable key" type="password" value={settings.stripePk ?? ''} onChange={(v) => setSetting('stripePk', v)} />
            <Field label="Secret key" type="password" value={settings.stripeSk ?? ''} onChange={(v) => setSetting('stripeSk', v)} />
            <h2 className="font-semibold text-gray-800 dark:text-gray-200 pt-4">PayPal</h2>
            <Field label="Client ID" type="password" value={settings.paypalClientId ?? ''} onChange={(v) => setSetting('paypalClientId', v)} />
            <Field label="Secret" type="password" value={settings.paypalSecret ?? ''} onChange={(v) => setSetting('paypalSecret', v)} />
          </div>
        )}

        {tab === 'taxes' && (
          <CrudList
            items={taxes}
            setItems={setTaxes}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'rate', label: 'Rate %', type: 'number' },
            ]}
            blank={{ name: '', rate: 0 }}
          />
        )}

        {tab === 'currencies' && (
          <CrudList
            items={currencies}
            setItems={setCurrencies}
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'symbol', label: 'Symbol' },
              { key: 'name', label: 'Name' },
            ]}
            blank={{ code: '', symbol: '', name: '' }}
          />
        )}

        {tab === 'appearance' && (
          <div className="space-y-4">
            <ThemeSelector />
            <LanguageSelector />
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Primary color</label>
              <input
                type="color"
                value={settings.primaryColor ?? '#2563eb'}
                onChange={(e) => setSetting('primaryColor', e.target.value)}
                className="h-10 w-20 rounded border border-gray-200 dark:border-gray-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date format</label>
              <select
                value={settings.dateFormat ?? 'YYYY-MM-DD'}
                onChange={(e) => setSetting('dateFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
              >
                <option>YYYY-MM-DD</option>
                <option>DD/MM/YYYY</option>
                <option>MM/DD/YYYY</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Time format</label>
              <select
                value={settings.timeFormat ?? '24h'}
                onChange={(e) => setSetting('timeFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
              >
                <option value="24h">24-hour</option>
                <option value="12h">12-hour</option>
              </select>
            </div>

            {/* Invoice PDF Template */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Invoice PDF Template</label>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { value: 'default', label: 'Default', desc: 'Blue header with modern layout, colored table headers, clean design.' },
                  { value: 'modern', label: 'Modern', desc: 'Minimal style with accent color bar on the left, large invoice number, alternating rows.' },
                  { value: 'classic', label: 'Classic', desc: 'Traditional business style with bordered tables, formal layout, bank details area.' },
                ] as const).map((tmpl) => (
                  <button
                    key={tmpl.value}
                    type="button"
                    onClick={() => setSetting('invoiceTemplate', tmpl.value)}
                    className={`text-left p-3 rounded-lg border-2 transition-colors ${
                      (settings.invoiceTemplate ?? 'default') === tmpl.value
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">{tmpl.label}</div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{tmpl.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Scheduled Report Emails</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Automatically send sales summary emails to all admin users in your organization.</p>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.reports?.weeklyEmail ?? false}
                    onChange={(e) => setSetting('reports', { ...(settings.reports ?? {}), weeklyEmail: e.target.checked })}
                    className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Send weekly sales summary email</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Sent every Monday at 8:00 AM to all admin users</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.reports?.monthlyEmail ?? false}
                    onChange={(e) => setSetting('reports', { ...(settings.reports ?? {}), monthlyEmail: e.target.checked })}
                    className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Send monthly report email</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Sent on the 1st of each month at 8:00 AM to all admin users</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Ticket Surveys</h3>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.ticketSatisfactionSurvey ?? false}
                  onChange={(e) => setSetting('ticketSatisfactionSurvey', e.target.checked)}
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Send satisfaction survey on ticket close</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Automatically email a satisfaction survey to the client contact when a ticket is closed</p>
                </div>
              </label>
            </div>
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}

function ThemeSelector() {
  const { dark, setMode } = useTheme();
  const current = (() => {
    if (typeof window === 'undefined') return 'system';
    const saved = localStorage.getItem('theme');
    if (!saved) return 'system';
    return saved;
  })();

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Theme</label>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Choose your preferred color scheme.</p>
      <div className="grid grid-cols-3 gap-3">
        {([
          { value: 'light', label: 'Light', desc: 'Clean, bright interface' },
          { value: 'dark', label: 'Dark', desc: 'Easy on the eyes' },
          { value: 'system', label: 'System', desc: 'Follow OS preference' },
        ] as const).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            className={`text-left p-3 rounded-lg border-2 transition-colors ${
              current === opt.value
                ? 'border-primary bg-primary/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">{opt.label}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function LanguageSelector() {
  const { t, lang, setLang } = useI18n();
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('settings.language')}</label>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('settings.languageDescription')}</p>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value as any}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}

function CrudList<T extends Record<string, any>>({
  items,
  setItems,
  columns,
  blank,
}: {
  items: T[];
  setItems: (v: T[]) => void;
  columns: { key: keyof T & string; label: string; type?: string }[];
  blank: T;
}) {
  const update = (i: number, key: string, val: any) => {
    const next = [...items];
    next[i] = { ...next[i], [key]: val };
    setItems(next);
  };
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">No items yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-end">
          {columns.map((c) => (
            <div key={c.key} className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{c.label}</label>
              <input
                type={c.type ?? 'text'}
                value={item[c.key] ?? ''}
                onChange={(e) =>
                  update(i, c.key, c.type === 'number' ? Number(e.target.value) : e.target.value)
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
              />
            </div>
          ))}
          <button
            onClick={() => setItems(items.filter((_, j) => j !== i))}
            className="text-xs text-red-600 hover:underline px-2 py-2"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() => setItems([...items, { ...blank }])}
        className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        + Add
      </button>
    </div>
  );
}
