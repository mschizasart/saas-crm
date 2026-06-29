'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { apiFetch, parseApiErrors } from '@/lib/api';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import {
  type ValidationRule,
  type EntityKey,
  type ValidationCondition,
  OPERATORS,
  NO_VALUE_OPERATORS,
  NATIVE_FIELDS,
} from '@/components/ui/validation-rule-shared';

/**
 * Create/edit modal for a Validation Rule. Mirrors the Custom Fields page's
 * FieldModal (backdrop + centered panel, inputCls, disabled-Save while
 * incomplete) but is a standalone component because the rule builder is large.
 *
 * Condition rows map 1:1 to the `conditions[]` payload: each row is
 * { field, operator, value? } where `value` is omitted for is_empty/is_not_empty.
 * The field dropdown is NATIVE_FIELDS[entity] PLUS the org's custom fields for
 * the entity (fetched live), offered as `cf:<slug>` options labeled by name.
 */

interface CustomFieldOption {
  slug: string;
  name: string;
}

interface RowState {
  field: string;
  operator: string;
  value: string;
}

const inputCls =
  'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900';

function emptyRow(entity: EntityKey): RowState {
  return { field: NATIVE_FIELDS[entity][0]?.value ?? '', operator: 'equals', value: '' };
}

/** Map a stored condition into editable row state (value coerced to string). */
function ruleToRows(rule: ValidationRule, entity: EntityKey): RowState[] {
  if (!rule.conditions || rule.conditions.length === 0) return [emptyRow(entity)];
  return rule.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value == null ? '' : String(c.value),
  }));
}

export function ValidationRuleModal({
  entity,
  editing,
  onClose,
  onSaved,
}: {
  entity: EntityKey;
  editing: ValidationRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const containerRef = useModalA11y(true, onClose);

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [conditionLogic, setConditionLogic] = useState<'AND' | 'OR'>(
    editing?.conditionLogic ?? 'AND',
  );
  const [rows, setRows] = useState<RowState[]>(
    editing ? ruleToRows(editing, entity) : [emptyRow(entity)],
  );
  const [errorMessage, setErrorMessage] = useState(editing?.errorMessage ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [order, setOrder] = useState(editing?.order ?? 0);

  const [customFields, setCustomFields] = useState<CustomFieldOption[]>([]);
  const [saving, setSaving] = useState(false);

  // Live custom fields for this entity → `cf:<slug>` field options.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/v1/custom-fields?fieldTo=${entity}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setCustomFields(
            data
              .filter((f) => f?.slug)
              .map((f) => ({ slug: String(f.slug), name: String(f.name ?? f.slug) })),
          );
        }
      } catch {
        /* silent — native fields still available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entity]);

  const updateRow = useCallback((idx: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);

  const addRow = () => setRows((prev) => [...prev, emptyRow(entity)]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const save = async () => {
    const conditions: ValidationCondition[] = rows
      .filter((r) => r.field && r.operator)
      .map((r) => {
        const cond: ValidationCondition = { field: r.field, operator: r.operator };
        if (!NO_VALUE_OPERATORS.has(r.operator)) cond.value = r.value;
        return cond;
      });

    if (conditions.length === 0) {
      toast.error('Add at least one condition');
      return;
    }
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!errorMessage.trim()) {
      toast.error('Error message is required');
      return;
    }

    setSaving(true);
    try {
      const body = {
        fieldTo: entity,
        name: name.trim(),
        description: description.trim() || undefined,
        conditionLogic,
        conditions,
        errorMessage: errorMessage.trim(),
        active,
        order: Number(order) || 0,
      };
      const res = await apiFetch(
        editing ? `/api/v1/validation-rules/${editing.id}` : '/api/v1/validation-rules',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errs = await parseApiErrors(res, 'Failed to save rule');
        errs.forEach((e) => toast.error(e));
        return;
      }
      toast.success(editing ? 'Validation rule updated' : 'Validation rule created');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="validation-rule-modal-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="validation-rule-modal-title" className="text-lg font-semibold mb-4">
          {editing ? 'Edit' : 'New'} Validation Rule
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Block lost leads with high value"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Description (optional)
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* ── Conditions ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs text-gray-600 dark:text-gray-400">
                Block the save when {rows.length > 1 ? 'these conditions match' : 'this condition matches'}
              </label>
              {rows.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-gray-500">Match</span>
                  <select
                    value={conditionLogic}
                    onChange={(e) => setConditionLogic(e.target.value as 'AND' | 'OR')}
                    className="border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 bg-white dark:bg-gray-900"
                  >
                    <option value="AND">ALL (AND)</option>
                    <option value="OR">ANY (OR)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((row, idx) => {
                const noValue = NO_VALUE_OPERATORS.has(row.operator);
                return (
                  <div key={idx} className="flex items-start gap-2">
                    <select
                      value={row.field}
                      onChange={(e) => updateRow(idx, { field: e.target.value })}
                      className={`${inputCls} flex-1`}
                      aria-label="Field"
                    >
                      <optgroup label="Fields">
                        {NATIVE_FIELDS[entity].map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                      {customFields.length > 0 && (
                        <optgroup label="Custom fields">
                          {customFields.map((cf) => (
                            <option key={cf.slug} value={`cf:${cf.slug}`}>
                              {cf.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <select
                      value={row.operator}
                      onChange={(e) => updateRow(idx, { operator: e.target.value })}
                      className={`${inputCls} flex-1`}
                      aria-label="Operator"
                    >
                      {OPERATORS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    {!noValue && (
                      <input
                        value={row.value}
                        onChange={(e) => updateRow(idx, { value: e.target.value })}
                        placeholder="value"
                        className={`${inputCls} flex-1`}
                        aria-label="Value"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length === 1}
                      className="px-2 py-2 text-gray-400 hover:text-red-600 disabled:opacity-30"
                      aria-label="Remove condition"
                      title="Remove condition"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addRow}
              className="mt-2 text-xs text-primary hover:underline"
            >
              + Add condition
            </button>
          </div>

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Error message (shown to the user when blocked)
            </label>
            <textarea
              value={errorMessage}
              onChange={(e) => setErrorMessage(e.target.value)}
              rows={2}
              placeholder="e.g. A lead marked lost cannot have a budget over $1,000."
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-600 dark:text-gray-400">Order</span>
              <input
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim() || !errorMessage.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
