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

interface DunningSettings {
  enabled: boolean;
  updatedAt: string | null;
}

interface DunningRule {
  id: string;
  name: string;
  offsetDays: number;
  subject: string;
  body: string;
  isActive: boolean;
}

interface RuleDraft {
  name: string;
  offsetDays: number;
  subject: string;
  body: string;
  isActive: boolean;
}

const PLACEHOLDERS = [
  '{{invoice_number}}',
  '{{amount}}',
  '{{due_date}}',
  '{{client_name}}',
];

const BLANK_DRAFT: RuleDraft = {
  name: '',
  offsetDays: 1,
  subject: 'Payment reminder for invoice {{invoice_number}}',
  body:
    '<p>Hi {{client_name}},</p>\n' +
    '<p>This is a reminder that invoice <strong>{{invoice_number}}</strong> for {{amount}} was due on {{due_date}}.</p>\n' +
    '<p>Please arrange payment at your earliest convenience.</p>',
  isActive: true,
};

/** Human-readable "X days before/after due" label for an offset. */
function offsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return 'on the due date';
  const abs = Math.abs(offsetDays);
  const unit = abs === 1 ? 'day' : 'days';
  return offsetDays < 0
    ? `${abs} ${unit} before due`
    : `${abs} ${unit} after due`;
}

export default function DunningSettingsPage() {
  const [settings, setSettings] = useState<DunningSettings>({
    enabled: false,
    updatedAt: null,
  });
  const [rules, setRules] = useState<DunningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);
  const [running, setRunning] = useState(false);

  // Editor state — `editing` holds the id being edited (or 'new').
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(BLANK_DRAFT);
  const [savingRule, setSavingRule] = useState(false);

  async function loadAll() {
    try {
      const [sRes, rRes] = await Promise.all([
        apiFetch('/api/v1/dunning/settings'),
        apiFetch('/api/v1/dunning/rules'),
      ]);
      if (sRes.ok) {
        const s = await sRes.json();
        setSettings({ enabled: !!s.enabled, updatedAt: s.updatedAt ?? null });
      }
      if (rRes.ok) {
        setRules(await rRes.json());
      }
    } catch {
      toast.error('Failed to load dunning settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function toggleEnabled(next: boolean) {
    setSavingToggle(true);
    // Optimistic.
    setSettings((s) => ({ ...s, enabled: next }));
    try {
      const res = await apiFetch('/api/v1/dunning/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const s = await res.json();
      setSettings({ enabled: !!s.enabled, updatedAt: s.updatedAt ?? null });
      toast.success(next ? 'Dunning enabled' : 'Dunning disabled');
    } catch (err) {
      setSettings((s) => ({ ...s, enabled: !next })); // revert
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingToggle(false);
    }
  }

  function startNew() {
    setDraft(BLANK_DRAFT);
    setEditing('new');
  }

  function startEdit(rule: DunningRule) {
    setDraft({
      name: rule.name,
      offsetDays: rule.offsetDays,
      subject: rule.subject,
      body: rule.body,
      isActive: rule.isActive,
    });
    setEditing(rule.id);
  }

  async function saveRule() {
    if (!draft.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!draft.subject.trim() || !draft.body.trim()) {
      toast.error('Subject and body are required');
      return;
    }
    setSavingRule(true);
    try {
      const isNew = editing === 'new';
      const res = await apiFetch(
        isNew ? '/api/v1/dunning/rules' : `/api/v1/dunning/rules/${editing}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: draft.name.trim(),
            offsetDays: Math.trunc(draft.offsetDays),
            subject: draft.subject,
            body: draft.body,
            isActive: draft.isActive,
          }),
        },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.message ?? `Save failed (${res.status})`);
      }
      toast.success(isNew ? 'Reminder rule created' : 'Reminder rule updated');
      setEditing(null);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this reminder rule?')) return;
    try {
      const res = await apiFetch(`/api/v1/dunning/rules/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success('Reminder rule deleted');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await apiFetch('/api/v1/dunning/run', { method: 'POST' });
      if (!res.ok) throw new Error(`Run failed (${res.status})`);
      toast.success(
        'Dunning pass queued. Reminders will send shortly in the background.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
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
      title="Payment reminders (Dunning)"
      description="Automatically email clients about overdue (and soon-due) invoices on a schedule you define. Each reminder fires at most once per invoice."
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
        title="Status"
        description="When enabled, a daily background job sends the reminders below for any unpaid invoice whose due date has reached a rule's offset. Paid or cancelled invoices are skipped automatically."
      >
        <div className="flex items-center justify-between gap-4">
          <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={savingToggle}
              onChange={(e) => toggleEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
            />
            <span>
              <span className="font-medium">Dunning enabled</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Reminders run daily at 08:00. Use “Run now” to send eligible
                reminders immediately.
              </span>
            </span>
          </label>
          <Button
            variant="secondary"
            onClick={runNow}
            loading={running}
            disabled={!settings.enabled}
          >
            Run now
          </Button>
        </div>
        {!settings.enabled && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Dunning is disabled — no reminders will be sent (manual or
            scheduled) until you enable it.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Reminder steps"
        description="Ordered by offset. Negative offsets send before the due date; positive offsets send after. Each step fires once per invoice."
      >
        {rules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No reminder steps yet. Add one to start sending payment reminders.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-start justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                      {rule.name}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {offsetLabel(rule.offsetDays)}
                    </span>
                    {!rule.isActive && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {rule.subject}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(rule)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteRule(rule.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <div className="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field
                label="Name"
                value={draft.name}
                onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
                placeholder="First reminder"
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  When to send
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={Math.abs(draft.offsetDays)}
                    min={0}
                    onChange={(e) => {
                      const mag = Math.max(
                        0,
                        Math.trunc(Number(e.target.value) || 0),
                      );
                      const sign = draft.offsetDays < 0 ? -1 : 1;
                      setDraft((d) => ({ ...d, offsetDays: sign * mag }));
                    }}
                    className="w-20 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <select
                    value={draft.offsetDays < 0 ? 'before' : 'after'}
                    onChange={(e) => {
                      const sign = e.target.value === 'before' ? -1 : 1;
                      const mag = Math.abs(draft.offsetDays);
                      setDraft((d) => ({ ...d, offsetDays: sign * mag }));
                    }}
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="before">days before due</option>
                    <option value="after">days after due</option>
                  </select>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {offsetLabel(draft.offsetDays)}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 sm:pt-6">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isActive: e.target.checked }))
                  }
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
                />
                Active
              </label>
            </div>

            <Field
              label="Subject"
              value={draft.subject}
              onChange={(v) => setDraft((d) => ({ ...d, subject: v }))}
              placeholder="Payment reminder for invoice {{invoice_number}}"
            />

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Body (HTML)
              </label>
              <textarea
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
                rows={6}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                Placeholders:{' '}
                {PLACEHOLDERS.map((p) => (
                  <code
                    key={p}
                    className="mx-0.5 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {p}
                  </code>
                ))}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setEditing(null)}
                disabled={savingRule}
              >
                Cancel
              </Button>
              <Button onClick={saveRule} loading={savingRule}>
                {editing === 'new' ? 'Add reminder' : 'Save reminder'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Button variant="secondary" onClick={startNew}>
              + Add reminder step
            </Button>
          </div>
        )}
      </SettingsSection>
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
