'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

interface FxCurrency {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
}

interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  date: string;
  source: 'manual' | 'ecb' | 'openexchange';
  createdAt: string;
}

interface RatesResponse {
  data: ExchangeRate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ConvertResponse {
  from: string;
  to: string;
  amount: string;
  rate: string;
  converted: string;
  asOfDate: string;
}

// Default top-20 list used for the "today's rates" snapshot.
const TOP_CURRENCIES = [
  'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL',
  'MXN', 'KRW', 'SGD', 'HKD', 'NZD', 'NOK', 'SEK', 'DKK', 'ZAR', 'TRY',
];

export default function FxSettingsPage() {
  const [currencies, setCurrencies] = useState<FxCurrency[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [snapshot, setSnapshot] = useState<
    Array<{ code: string; rate: string | null; error: string | null }>
  >([]);
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRate, setSavingRate] = useState(false);

  // Manual override form state.
  const [form, setForm] = useState({
    from: 'EUR',
    to: 'USD',
    rate: '',
    date: new Date().toISOString().slice(0, 10),
  });

  async function loadCurrencies() {
    try {
      const res = await apiFetch('/api/v1/fx/currencies');
      if (res.ok) {
        const data = await res.json();
        setCurrencies(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore — UI degrades to defaults */
    }
  }

  async function loadRates() {
    try {
      const res = await apiFetch('/api/v1/fx/rates?limit=50');
      if (res.ok) {
        const data: RatesResponse = await res.json();
        setRates(data.data ?? []);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * For each top-20 currency, ask the server to convert
   * 1 baseCurrency → that currency. Builds the "today's rates"
   * snapshot table without needing a dedicated endpoint.
   */
  async function loadSnapshot(base: string) {
    const results: Array<{
      code: string;
      rate: string | null;
      error: string | null;
    }> = [];

    await Promise.all(
      TOP_CURRENCIES.filter((c) => c !== base).map(async (code) => {
        try {
          const res = await apiFetch(
            `/api/v1/fx/convert?from=${base}&to=${code}&amount=1`,
          );
          if (res.ok) {
            const data: ConvertResponse = await res.json();
            results.push({ code, rate: data.rate, error: null });
          } else {
            results.push({ code, rate: null, error: `HTTP ${res.status}` });
          }
        } catch (err) {
          results.push({
            code,
            rate: null,
            error: (err as Error).message ?? 'fetch failed',
          });
        }
      }),
    );

    // Sort alphabetically so the table is stable across reloads.
    results.sort((a, b) => a.code.localeCompare(b.code));
    setSnapshot(results);
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadCurrencies(), loadRates()]);
    await loadSnapshot(baseCurrency);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await apiFetch('/api/v1/fx/refresh-now', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Refreshed ${data.inserted} rates from ECB`);
        await loadRates();
        await loadSnapshot(baseCurrency);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.message ?? `Refresh failed (HTTP ${res.status})`);
      }
    } catch (e) {
      toast.error((e as Error).message ?? 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.from || !form.to || !form.rate || !form.date) {
      toast.error('All fields are required');
      return;
    }
    const rate = Number(form.rate);
    if (!isFinite(rate) || rate <= 0) {
      toast.error('Rate must be a positive number');
      return;
    }
    if (form.from === form.to) {
      toast.error('from and to must differ');
      return;
    }
    setSavingRate(true);
    try {
      const res = await apiFetch('/api/v1/fx/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          rate,
          date: form.date,
          source: 'manual',
        }),
      });
      if (res.ok) {
        toast.success(`Manual rate ${form.from}→${form.to} saved`);
        setForm({ ...form, rate: '' });
        await loadRates();
        await loadSnapshot(baseCurrency);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.message ?? `Save failed (HTTP ${res.status})`);
      }
    } catch (e) {
      toast.error((e as Error).message ?? 'Save failed');
    } finally {
      setSavingRate(false);
    }
  }

  return (
    <SettingsPageLayout
      title="Currencies & FX"
      description="ISO 4217 currencies, daily exchange rates from the European Central Bank, and manual rate overrides."
    >
      {/* ─── Base currency ─────────────────────────────────────── */}
      <SettingsSection
        title="Base currency"
        description="Reporting and forecast totals roll up into this currency."
      >
        <div className="flex items-center gap-3">
          <span className={typography.body}>
            {baseCurrency}
            <span className="text-gray-500 dark:text-gray-400 ml-2">
              (default — set per-organization in a follow-up)
            </span>
          </span>
        </div>
      </SettingsSection>

      {/* ─── Today's rates ─────────────────────────────────────── */}
      <SettingsSection
        title={`Today's rates (1 ${baseCurrency} → ...)`}
        description="Live conversion against each of the top 20 currencies."
        footer={
          <Button onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh from ECB now'}
          </Button>
        }
      >
        {loading ? (
          <p className={typography.bodyMuted}>Loading...</p>
        ) : snapshot.length === 0 ? (
          <p className={typography.bodyMuted}>
            No rates yet — click "Refresh from ECB now" to pull today's feed.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Rate</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.map((row) => {
                  const meta = currencies.find((c) => c.code === row.code);
                  return (
                    <tr
                      key={row.code}
                      className="border-b border-gray-50 dark:border-gray-900"
                    >
                      <td className="py-1.5 pr-4 font-mono">{row.code}</td>
                      <td className="py-1.5 pr-4">{meta?.name ?? '—'}</td>
                      <td className="py-1.5 pr-4 font-mono">
                        {row.rate
                          ? Number(row.rate).toFixed(4)
                          : <span className="text-gray-400">{row.error ?? '—'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {/* ─── Manual override ───────────────────────────────────── */}
      <SettingsSection
        title="Manual rate override"
        description="Pin a specific from→to rate for a date. Manual rates win over ECB-pulled rates on the same day."
        footer={
          <Button
            type="submit"
            form="fx-manual-form"
            disabled={savingRate}
          >
            {savingRate ? 'Saving...' : 'Save override'}
          </Button>
        }
      >
        <form
          id="fx-manual-form"
          onSubmit={handleSaveRate}
          className="grid grid-cols-1 md:grid-cols-4 gap-3"
        >
          <label className="text-sm">
            <span className="block mb-1 text-gray-700 dark:text-gray-300">From</span>
            <select
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-700 dark:text-gray-300">To</span>
            <select
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-700 dark:text-gray-300">Rate</span>
            <input
              type="number"
              step="0.000001"
              min="0"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900 font-mono"
              placeholder="e.g. 1.0852"
              required
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-gray-700 dark:text-gray-300">Date</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
              required
            />
          </label>
        </form>
      </SettingsSection>

      {/* ─── Stored rates ──────────────────────────────────────── */}
      <SettingsSection
        title="Recent stored rates"
        description="Most recent 50 rate rows for this organization — both ECB-pulled and manual overrides."
      >
        {loading ? (
          <p className={typography.bodyMuted}>Loading...</p>
        ) : rates.length === 0 ? (
          <p className={typography.bodyMuted}>
            No rates stored yet. The daily cron refreshes at 06:00 Athens time.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">From</th>
                  <th className="py-2 pr-4">To</th>
                  <th className="py-2 pr-4">Rate</th>
                  <th className="py-2 pr-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 dark:border-gray-900"
                  >
                    <td className="py-1.5 pr-4 font-mono">
                      {r.date.slice(0, 10)}
                    </td>
                    <td className="py-1.5 pr-4 font-mono">{r.fromCurrency}</td>
                    <td className="py-1.5 pr-4 font-mono">{r.toCurrency}</td>
                    <td className="py-1.5 pr-4 font-mono">
                      {Number(r.rate).toFixed(6)}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span
                        className={
                          r.source === 'manual'
                            ? 'inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'inline-block px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                        }
                      >
                        {r.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
