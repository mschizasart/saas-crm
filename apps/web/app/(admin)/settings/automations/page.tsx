'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Workflow, Plus, Pencil, Trash2 } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch } from '@/lib/api';
import { TRIGGERS } from './catalogue';

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  conditions: any;
  actions: any[];
  active: boolean;
  createdAt: string;
  /** May or may not be exposed by backend yet — guarded for null. */
  lastRunAt?: string | null;
}

function triggerLabel(value: string): string {
  return TRIGGERS.find((t) => t.value === value)?.label ?? value;
}

function countConditions(conditions: any): number {
  if (!conditions) return 0;
  if (Array.isArray(conditions?.rules)) return conditions.rules.length;
  if (Array.isArray(conditions)) return conditions.length;
  if (conditions.field) return 1;
  return 0;
}

export default function AutomationsListPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/automations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('Failed to load automations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (rule: AutomationRule) => {
    // Optimistic update.
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    try {
      const res = await apiFetch(`/api/v1/automations/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(rule.active ? 'Automation disabled' : 'Automation enabled');
    } catch (e) {
      // Revert.
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: rule.active } : r)));
      toast.error('Failed to update automation');
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    if (!confirm(`Delete automation "${rule.name}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/v1/automations/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success('Automation deleted');
    } catch (e) {
      toast.error('Failed to delete automation');
    }
  };

  return (
    <ListPageLayout
      title="Automations"
      subtitle="Run actions automatically when events happen across your CRM"
      primaryAction={{
        label: 'New automation',
        href: '/settings/automations/new',
        icon: <Plus className="w-4 h-4" />,
      }}
    >
      <Card padding="none">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Workflow className="w-10 h-10" />}
            title="No automations yet"
            description="Create your first automation to send emails, update records, or fire webhooks when events occur."
            action={{ label: 'Create automation', href: '/settings/automations/new' }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Trigger</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Conditions</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Active</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last run</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const condCount = countConditions(rule.conditions);
                  const actionCount = Array.isArray(rule.actions) ? rule.actions.length : 0;
                  return (
                    <tr key={rule.id} className="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        <Link href={`/settings/automations/${rule.id}`} className="hover:text-primary">
                          {rule.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          {triggerLabel(rule.trigger)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{condCount}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{actionCount}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleActive(rule)}
                          aria-label={rule.active ? 'Disable automation' : 'Enable automation'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            rule.active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              rule.active ? 'translate-x-4' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-3">
                        <Link
                          href={`/settings/automations/${rule.id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule)}
                          className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </ListPageLayout>
  );
}
