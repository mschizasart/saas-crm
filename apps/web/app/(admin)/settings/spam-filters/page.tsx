'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ShieldX } from 'lucide-react';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { typography } from '@/lib/ui-tokens';
import { apiFetch } from '@/lib/api';

type Field = 'subject' | 'fromEmail' | 'body' | 'fromDomain';
type Operator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';
type Action = 'mark_spam' | 'auto_close' | 'reject';

interface SpamFilter {
  id: string;
  name: string;
  field: Field;
  operator: Operator;
  pattern: string;
  caseSensitive: boolean;
  action: Action;
  isActive: boolean;
  priority: number;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  field: Field;
  operator: Operator;
  pattern: string;
  caseSensitive: boolean;
  action: Action;
  isActive: boolean;
  priority: number;
}

const FIELD_LABELS: Record<Field, string> = {
  subject: 'Subject',
  fromEmail: 'From email',
  body: 'Body',
  fromDomain: 'From domain',
};
const OPERATOR_LABELS: Record<Operator, string> = {
  contains: 'contains',
  equals: 'equals',
  startsWith: 'starts with',
  endsWith: 'ends with',
  regex: 'matches regex',
};
const ACTION_LABELS: Record<Action, string> = {
  mark_spam: 'Mark as spam',
  auto_close: 'Auto-close',
  reject: 'Reject (drop)',
};
const ACTION_BADGE: Record<Action, string> = {
  mark_spam:
    'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  auto_close:
    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  reject: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const EMPTY_FORM: FormState = {
  name: '',
  field: 'subject',
  operator: 'contains',
  pattern: '',
  caseSensitive: false,
  action: 'mark_spam',
  isActive: true,
  priority: 0,
};

export default function SpamFiltersPage() {
  const [filters, setFilters] = useState<SpamFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SpamFilter | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Test panel state
  const [testSubject, setTestSubject] = useState('');
  const [testFromEmail, setTestFromEmail] = useState('');
  const [testBody, setTestBody] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMatches, setTestMatches] = useState<
    | Array<{
        id: string;
        name: string;
        field: Field;
        operator: Operator;
        action: Action;
        priority: number;
      }>
    | null
  >(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/ticket-spam-filters');
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setFilters(Array.isArray(data) ? data : (data.data ?? []));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load filters');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(f: SpamFilter) {
    setEditing(f);
    setForm({
      name: f.name,
      field: f.field,
      operator: f.operator,
      pattern: f.pattern,
      caseSensitive: f.caseSensitive,
      action: f.action,
      isActive: f.isActive,
      priority: f.priority,
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!form.pattern) {
      toast.error('Pattern is required');
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `/api/v1/ticket-spam-filters/${editing.id}`
        : '/api/v1/ticket-spam-filters';
      const method = editing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? `Failed (${res.status})`);
      }
      toast.success(editing ? 'Filter updated' : 'Filter created');
      closeForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(f: SpamFilter) {
    try {
      const res = await apiFetch(`/api/v1/ticket-spam-filters/${f.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !f.isActive }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function remove(f: SpamFilter) {
    if (!confirm(`Delete spam filter "${f.name}"?`)) return;
    try {
      const res = await apiFetch(`/api/v1/ticket-spam-filters/${f.id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204)
        throw new Error(`Failed (${res.status})`);
      toast.success('Filter deleted');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function runTest() {
    setTesting(true);
    setTestMatches(null);
    try {
      const res = await apiFetch('/api/v1/ticket-spam-filters/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: testSubject,
          fromEmail: testFromEmail,
          body: testBody,
        }),
      });
      if (!res.ok) throw new Error(`Test failed (${res.status})`);
      const data = await res.json();
      setTestMatches(data.matchedFilters ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsPageLayout
      title="Spam filters"
      description="Tenant-defined rules that auto-mark inbound email tickets as spam, auto-close them, or drop them entirely."
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
        title="Rules"
        description="Rules are evaluated in priority order (lowest first). The first match wins."
      >
        <div className="flex items-center justify-end mb-4">
          <Button
            variant="primary"
            icon={<ShieldX className="w-4 h-4" />}
            onClick={startNew}
          >
            New rule
          </Button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading…
          </div>
        ) : filters.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No spam filters yet. Create one to start filtering inbound email
            tickets.
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Operator</th>
                  <th className="px-3 py-2 font-medium">Pattern</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium text-center">Active</th>
                  <th className="px-3 py-2 font-medium text-right">Matches</th>
                  <th className="px-3 py-2 font-medium text-right">Priority</th>
                  <th className="px-3 py-2 font-medium text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filters.map((f) => (
                  <tr
                    key={f.id}
                    className="hover:bg-gray-50/50 dark:hover:bg-gray-900/40"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                      {f.name}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {FIELD_LABELS[f.field]}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {OPERATOR_LABELS[f.operator]}
                      {f.caseSensitive ? ' (cs)' : ''}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-mono text-xs max-w-xs truncate">
                      {f.pattern}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${ACTION_BADGE[f.action]}`}
                      >
                        {ACTION_LABELS[f.action]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleActive(f)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          f.isActive
                            ? 'bg-primary'
                            : 'bg-gray-300 dark:bg-gray-700'
                        }`}
                        aria-label={
                          f.isActive ? 'Disable filter' : 'Enable filter'
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            f.isActive ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {f.matchCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {f.priority}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => startEdit(f)}
                          className="text-xs text-primary hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(f)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <TestPanel
        subject={testSubject}
        fromEmail={testFromEmail}
        body={testBody}
        onSubject={setTestSubject}
        onFromEmail={setTestFromEmail}
        onBody={setTestBody}
        onRun={runTest}
        running={testing}
        matches={testMatches}
      />

      {showForm && (
        <FilterFormModal
          editing={editing}
          form={form}
          onChange={setForm}
          onSave={save}
          onClose={closeForm}
          saving={saving}
        />
      )}
    </SettingsPageLayout>
  );
}

// ─── Test panel ─────────────────────────────────────────────────────────────

function TestPanel({
  subject,
  fromEmail,
  body,
  onSubject,
  onFromEmail,
  onBody,
  onRun,
  running,
  matches,
}: {
  subject: string;
  fromEmail: string;
  body: string;
  onSubject: (v: string) => void;
  onFromEmail: (v: string) => void;
  onBody: (v: string) => void;
  onRun: () => void;
  running: boolean;
  matches:
    | Array<{
        id: string;
        name: string;
        field: Field;
        operator: Operator;
        action: Action;
        priority: number;
      }>
    | null;
}) {
  const winning = useMemo(() => {
    if (!matches || matches.length === 0) return null;
    // Server already returns sorted by priority ASC; first is the one that
    // would actually fire on a real inbound mail.
    return matches[0];
  }, [matches]);

  return (
    <SettingsSection
      title="Test rules"
      description="Paste a sample inbound email and see which active rules would match. The first match (lowest priority number) is the rule that would actually fire."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={`${typography.caption} block mb-1`}>From email</label>
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => onFromEmail(e.target.value)}
            placeholder="spammer@example.com"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className={`${typography.caption} block mb-1`}>Subject</label>
          <input
            value={subject}
            onChange={(e) => onSubject(e.target.value)}
            placeholder="You won a prize!!!"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          />
        </div>
        <div className="md:col-span-2">
          <label className={`${typography.caption} block mb-1`}>Body</label>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => onBody(e.target.value)}
            placeholder="Click here to claim your reward…"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 font-mono"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={onRun} loading={running} disabled={running}>
          {running ? 'Testing…' : 'Test'}
        </Button>
        {matches !== null && (
          <span className={typography.bodyMuted}>
            {matches.length === 0
              ? 'No rules matched.'
              : `${matches.length} rule${matches.length === 1 ? '' : 's'} matched.`}
          </span>
        )}
      </div>

      {matches && matches.length > 0 && (
        <div className="mt-4 space-y-2">
          {matches.map((m) => (
            <div
              key={m.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                winning && winning.id === m.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-gray-100 dark:border-gray-800'
              }`}
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {m.name}
              </span>
              <span className={typography.caption}>
                ({FIELD_LABELS[m.field]} {OPERATOR_LABELS[m.operator]})
              </span>
              <span
                className={`ml-auto px-2 py-0.5 text-xs rounded-full ${ACTION_BADGE[m.action]}`}
              >
                {ACTION_LABELS[m.action]}
              </span>
              {winning && winning.id === m.id && (
                <span className="text-xs text-primary font-medium">
                  would fire
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

// ─── Form modal ─────────────────────────────────────────────────────────────

function FilterFormModal({
  editing,
  form,
  onChange,
  onSave,
  onClose,
  saving,
}: {
  editing: SpamFilter | null;
  form: FormState;
  onChange: (f: FormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const containerRef = useModalA11y(true, onClose);
  const titleId = 'spam-filter-modal-title';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 id={titleId} className={typography.h3}>
            {editing ? 'Edit spam rule' : 'New spam rule'}
          </h2>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className={`${typography.caption} block mb-1`}>Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              placeholder="Block 'lottery' subjects"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`${typography.caption} block mb-1`}>Field</label>
              <select
                value={form.field}
                onChange={(e) =>
                  onChange({ ...form, field: e.target.value as Field })
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`${typography.caption} block mb-1`}>
                Operator
              </label>
              <select
                value={form.operator}
                onChange={(e) =>
                  onChange({ ...form, operator: e.target.value as Operator })
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                {(Object.keys(OPERATOR_LABELS) as Operator[]).map((o) => (
                  <option key={o} value={o}>
                    {OPERATOR_LABELS[o]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={`${typography.caption} block mb-1`}>
              Pattern *
            </label>
            <input
              value={form.pattern}
              onChange={(e) => onChange({ ...form, pattern: e.target.value })}
              placeholder={
                form.operator === 'regex'
                  ? '^.*\\b(viagra|lottery)\\b.*$'
                  : 'lottery'
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cs"
              type="checkbox"
              checked={form.caseSensitive}
              onChange={(e) =>
                onChange({ ...form, caseSensitive: e.target.checked })
              }
            />
            <label htmlFor="cs" className="text-sm text-gray-700 dark:text-gray-300">
              Case sensitive
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`${typography.caption} block mb-1`}>
                Action
              </label>
              <select
                value={form.action}
                onChange={(e) =>
                  onChange({ ...form, action: e.target.value as Action })
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`${typography.caption} block mb-1`}>
                Priority
              </label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) =>
                  onChange({
                    ...form,
                    priority: Number.isFinite(Number(e.target.value))
                      ? Number(e.target.value)
                      : 0,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="active"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                onChange({ ...form, isActive: e.target.checked })
              }
            />
            <label
              htmlFor="active"
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              Active
            </label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/60 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving} disabled={saving}>
            {editing ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
