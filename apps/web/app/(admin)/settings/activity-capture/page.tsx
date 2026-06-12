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

/**
 * Einstein Activity Capture settings (Wave H2).
 *
 * Three per-org toggles + a one-shot backfill button. The toggles
 * are persisted server-side; the backfill scans the last N days of
 * messaging rows and runs them through the same capture pipeline
 * (so all the same gates apply — settings, dedup, internal-email
 * carve-out).
 */
interface ActivityCaptureSettings {
  emailCaptureEnabled: boolean;
  smsCaptureEnabled: boolean;
  captureInternalEmails: boolean;
  updatedAt: string | null;
}

interface BackfillSummary {
  sinceDays: number;
  since: string;
  outboundEmail: { scanned: number };
  inboundEmail: { scanned: number };
  outboundSms: { scanned: number };
  inboundSms: { scanned: number };
}

const DEFAULT_SETTINGS: ActivityCaptureSettings = {
  emailCaptureEnabled: true,
  smsCaptureEnabled: true,
  captureInternalEmails: false,
  updatedAt: null,
};

export default function ActivityCaptureSettingsPage() {
  const [form, setForm] = useState<ActivityCaptureSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillDays, setBackfillDays] = useState(30);
  const [lastBackfill, setLastBackfill] = useState<BackfillSummary | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/activity-capture/settings');
        if (res.ok) {
          const data: ActivityCaptureSettings = await res.json();
          setForm({
            emailCaptureEnabled: !!data.emailCaptureEnabled,
            smsCaptureEnabled: !!data.smsCaptureEnabled,
            captureInternalEmails: !!data.captureInternalEmails,
            updatedAt: data.updatedAt ?? null,
          });
        }
      } catch {
        toast.error('Failed to load Activity Capture settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof ActivityCaptureSettings>(
    key: K,
    value: ActivityCaptureSettings[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/activity-capture/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailCaptureEnabled: form.emailCaptureEnabled,
          smsCaptureEnabled: form.smsCaptureEnabled,
          captureInternalEmails: form.captureInternalEmails,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Save failed (${res.status})`);
      }
      const data: ActivityCaptureSettings = await res.json();
      setForm({
        emailCaptureEnabled: !!data.emailCaptureEnabled,
        smsCaptureEnabled: !!data.smsCaptureEnabled,
        captureInternalEmails: !!data.captureInternalEmails,
        updatedAt: data.updatedAt ?? null,
      });
      toast.success('Activity Capture settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function runBackfill() {
    const days = Math.max(1, Math.min(365, Math.floor(backfillDays)));
    setBackfilling(true);
    setLastBackfill(null);
    try {
      const res = await apiFetch(
        `/api/v1/activity-capture/backfill?sinceDays=${days}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Backfill failed (${res.status})`);
      }
      const data: BackfillSummary = await res.json();
      setLastBackfill(data);
      const total =
        data.outboundEmail.scanned +
        data.inboundEmail.scanned +
        data.outboundSms.scanned +
        data.inboundSms.scanned;
      toast.success(`Backfill complete — scanned ${total} rows`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
    );
  }

  return (
    <SettingsPageLayout
      title="Activity Capture"
      description="Automatically log every email and SMS to the matching customer's timeline. Salesforce-style Einstein Activity Capture — reps stop having to log each interaction manually."
    >
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>
          ← Settings
        </Link>
      </div>

      <SettingsSection
        title="Channels"
        description="Choose which channels are auto-logged. Disabling a channel writes an audit row but skips creating Activity rows; the message itself is still sent / received as normal."
      >
        <div className="space-y-3">
          <Toggle
            label="Capture emails"
            description="Outbound and inbound email messages are matched against your contacts and logged on the customer's timeline."
            checked={form.emailCaptureEnabled}
            onChange={(v) => set('emailCaptureEnabled', v)}
          />
          <Toggle
            label="Capture SMS"
            description="Outbound and inbound SMS messages are matched by phone number and logged on the customer's timeline."
            checked={form.smsCaptureEnabled}
            onChange={(v) => set('smsCaptureEnabled', v)}
          />
          <Toggle
            label="Capture internal emails"
            description="When OFF (default), emails between your own staff are skipped so internal back-and-forth doesn't pollute customer timelines. Turn ON if you want a complete trail."
            checked={form.captureInternalEmails}
            onChange={(v) => set('captureInternalEmails', v)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Backfill"
        description="One-shot sweep over the last N days of messaging rows so the timeline isn't empty after enabling capture. Hard-capped at 10,000 rows per channel. Runs the same matching pipeline as live capture — already-captured rows are skipped."
      >
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Look back (days)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={backfillDays}
              onChange={(e) => setBackfillDays(Number(e.target.value) || 30)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button
            variant="secondary"
            onClick={runBackfill}
            loading={backfilling}
            disabled={saving}
          >
            Run backfill
          </Button>
        </div>

        {lastBackfill && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat
              label="Outbound email"
              value={lastBackfill.outboundEmail.scanned}
            />
            <Stat
              label="Inbound email"
              value={lastBackfill.inboundEmail.scanned}
            />
            <Stat
              label="Outbound SMS"
              value={lastBackfill.outboundSms.scanned}
            />
            <Stat label="Inbound SMS" value={lastBackfill.inboundSms.scanned} />
          </div>
        )}
      </SettingsSection>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>
    </SettingsPageLayout>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </span>
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50/40 dark:bg-gray-900/40">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400">scanned</div>
    </div>
  );
}
