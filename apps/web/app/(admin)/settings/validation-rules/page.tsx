'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { ValidationRuleModal } from '@/components/ui/validation-rule-modal';
import {
  type ValidationRule,
  type EntityKey,
  ENTITY_TABS,
  OPERATOR_LABELS,
  fieldLabel,
} from '@/components/ui/validation-rule-shared';
import { apiFetch, parseApiErrors } from '@/lib/api';

/**
 * Salesforce-style Validation Rules admin config. A rule blocks a record save
 * when its condition(s) evaluate true, surfacing a custom error message. The
 * backend enforces the rule on POST/PATCH of the entity; this page is the CRUD
 * surface for the rule definitions themselves.
 *
 * Mirrors the Custom Fields settings page: entity tabs, a list of definitions,
 * and a create/edit modal.
 */
export default function ValidationRulesPage() {
  const [entity, setEntity] = useState<EntityKey>('lead');
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ValidationRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/validation-rules?fieldTo=${entity}`);
      const data = res.ok ? await res.json() : [];
      setRules(Array.isArray(data) ? data : []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (rule: ValidationRule) => {
    if (!confirm(`Delete validation rule "${rule.name}"?`)) return;
    const res = await apiFetch(`/api/v1/validation-rules/${rule.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errs = await parseApiErrors(res, 'Failed to delete rule');
      errs.forEach((e) => toast.error(e));
      return;
    }
    toast.success('Validation rule deleted');
    load();
  };

  const toggleActive = async (rule: ValidationRule) => {
    const res = await apiFetch(`/api/v1/validation-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !rule.active }),
    });
    if (!res.ok) {
      const errs = await parseApiErrors(res, 'Failed to update rule');
      errs.forEach((e) => toast.error(e));
      return;
    }
    load();
  };

  return (
    <SettingsPageLayout
      title="Validation Rules"
      description="Block record saves when a condition is true, with a custom error message."
    >
      <SettingsSection title="Rules" description={`Manage validation rules for ${entity}s`}>
        <div className="flex items-center justify-between mb-4 gap-4">
          <div className="border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto flex-1">
            {ENTITY_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setEntity(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  entity === t.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 flex-shrink-0"
          >
            + New rule
          </button>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="px-4 py-12 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No validation rules yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Add a rule to block {entity} saves when a condition is met.
            </p>
            <button
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="mt-4 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
            >
              + New rule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="border border-gray-100 dark:border-gray-800 rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{rule.name}</span>
                    {!rule.active && (
                      <span className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 px-2 py-0.5 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rule.description}</p>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                    <code className="bg-gray-50 dark:bg-gray-800/60 px-1.5 py-0.5 rounded text-xs">
                      {summarize(rule, entity)}
                    </code>
                  </p>
                  <p className="text-xs text-red-600 mt-1.5">⚠ {rule.errorMessage}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label
                    className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer"
                    title="Active"
                  >
                    <input
                      type="checkbox"
                      checked={rule.active}
                      onChange={() => toggleActive(rule)}
                    />
                    Active
                  </label>
                  <button
                    onClick={() => {
                      setEditing(rule);
                      setShowModal(true);
                    }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(rule)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {showModal && (
        <ValidationRuleModal
          entity={entity}
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
          }}
        />
      )}
    </SettingsPageLayout>
  );
}

/**
 * Renders a human summary of the rule's condition(s), e.g.
 * "IF status equals 'lost' AND value greater_than 1000 → block".
 */
function summarize(rule: ValidationRule, entity: EntityKey): string {
  if (!rule.conditions || rule.conditions.length === 0) return 'IF (no conditions) → block';
  const parts = rule.conditions.map((c) => {
    const op = OPERATOR_LABELS[c.operator] ?? c.operator;
    const noValue = c.operator === 'is_empty' || c.operator === 'is_not_empty';
    const val = noValue ? '' : ` '${c.value ?? ''}'`;
    return `${fieldLabel(c.field, entity)} ${op}${val}`;
  });
  return `IF ${parts.join(` ${rule.conditionLogic} `)} → block`;
}
