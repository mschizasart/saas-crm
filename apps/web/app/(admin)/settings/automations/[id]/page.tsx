'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Plus,
  Trash2,
  Play,
  Save as SaveIcon,
  History,
  Settings2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import {
  ACTIONS,
  OPERATORS,
  TRIGGERS,
  findAction,
  findTrigger,
  type ActionFieldDef,
} from '../catalogue';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConditionRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface ActionRow {
  id: string;
  type: string;
  config: Record<string, any>;
}

type ConditionLogic = 'AND' | 'OR';

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  conditions: any;
  actions: any[];
  active: boolean;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * The backend's `evaluateConditions` only handles a single `{ field, operator, value }`
 * object today (no AND/OR group support). We still let the UI build a multi-row group
 * because: (a) it's the natural mental model and (b) rolling out logic-group support on
 * the API doesn't break the contract — the frontend always serialises into the richer
 * `{ logic, rules: [...] }` shape AND collapses to the legacy single-condition shape
 * when there is exactly one row, so existing rules keep working.
 */
function serialiseConditions(rows: ConditionRow[], logic: ConditionLogic): any {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const r = rows[0];
    if (!r.field) return null;
    return { field: r.field, operator: r.operator, value: r.value };
  }
  return {
    logic,
    rules: rows
      .filter((r) => r.field)
      .map((r) => ({ field: r.field, operator: r.operator, value: r.value })),
  };
}

function deserialiseConditions(raw: any): { rows: ConditionRow[]; logic: ConditionLogic } {
  if (!raw) return { rows: [], logic: 'AND' };
  if (Array.isArray(raw?.rules)) {
    return {
      logic: raw.logic === 'OR' ? 'OR' : 'AND',
      rows: raw.rules.map((r: any) => ({
        id: makeId(),
        field: r.field ?? '',
        operator: r.operator ?? 'equals',
        value: r.value ?? '',
      })),
    };
  }
  if (raw.field) {
    return {
      logic: 'AND',
      rows: [
        {
          id: makeId(),
          field: raw.field,
          operator: raw.operator ?? 'equals',
          value: raw.value ?? '',
        },
      ],
    };
  }
  return { rows: [], logic: 'AND' };
}

function deserialiseActions(raw: any[]): ActionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => ({
    id: makeId(),
    type: a?.type ?? 'send_email',
    config: a?.config ?? {},
  }));
}

function serialiseActions(rows: ActionRow[]): any[] {
  return rows.map(({ type, config }) => ({ type, config }));
}

// ─── Sortable row primitive ─────────────────────────────────────────────────

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handleProps: {
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

// ─── Action params editor ───────────────────────────────────────────────────

function ActionParamsEditor({
  action,
  onChange,
}: {
  action: ActionRow;
  onChange: (config: Record<string, any>) => void;
}) {
  const def = findAction(action.type);
  if (!def) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Unknown action type "{action.type}". Backend may not support it — the engine will log a
        warning and skip it.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {def.fields.map((field) => (
        <ActionParamField
          key={field.key}
          field={field}
          value={action.config[field.key] ?? ''}
          onChange={(v) => onChange({ ...action.config, [field.key]: v })}
        />
      ))}
    </div>
  );
}

function ActionParamField({
  field,
  value,
  onChange,
}: {
  field: ActionFieldDef;
  value: any;
  onChange: (val: any) => void;
}) {
  const baseInput =
    'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {field.label}
        {field.required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {field.kind === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={baseInput}
        />
      ) : field.kind === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={baseInput}>
          <option value="">— select —</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.kind === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={baseInput}
        />
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AutomationBuilderPage() {
  const params = useParams() as { id: string };
  const router = useRouter();
  const id = params.id;
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [trigger, setTrigger] = useState<string>(TRIGGERS[0]?.value ?? '');
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>('AND');
  const [actions, setActions] = useState<ActionRow[]>([]);

  const [activeTab, setActiveTab] = useState<'builder' | 'history'>('builder');

  // Test run UI state.
  const [testPayload, setTestPayload] = useState<string>('{\n  "id": "sample-id"\n}');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  // ─── Load existing rule (edit mode) ───────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/automations');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list: AutomationRule[] = await res.json();
        const rule = Array.isArray(list) ? list.find((r) => r.id === id) : null;
        if (!rule) {
          toast.error('Automation not found');
          router.replace('/settings/automations');
          return;
        }
        setName(rule.name ?? '');
        setActive(rule.active);
        setTrigger(rule.trigger ?? TRIGGERS[0].value);
        const { rows, logic } = deserialiseConditions(rule.conditions);
        setConditions(rows);
        setConditionLogic(logic);
        setActions(deserialiseActions(rule.actions));
      } catch (e) {
        toast.error('Failed to load automation');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, router]);

  // Keep test payload in sync with selected trigger so the user gets a sensible default.
  useEffect(() => {
    const def = findTrigger(trigger);
    if (!def) return;
    const sample: Record<string, any> = { id: 'sample-id' };
    def.fields.forEach((f) => {
      sample[f] = '';
    });
    setTestPayload((prev) => {
      // If the user has hand-edited, leave it alone.
      try {
        const parsed = JSON.parse(prev);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 1) return prev;
      } catch {
        return prev;
      }
      return JSON.stringify(sample, null, 2);
    });
  }, [trigger]);

  // ─── Sensors for drag ─────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ─── Condition CRUD ───────────────────────────────────────────────────────
  const addCondition = () => {
    const triggerDef = findTrigger(trigger);
    const defaultField = triggerDef?.fields[0] ?? '';
    setConditions((prev) => [
      ...prev,
      { id: makeId(), field: defaultField, operator: 'equals', value: '' },
    ]);
  };
  const removeCondition = (rowId: string) =>
    setConditions((prev) => prev.filter((r) => r.id !== rowId));
  const updateCondition = (rowId: string, patch: Partial<ConditionRow>) =>
    setConditions((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));

  const onConditionDragEnd = (event: DragEndEvent) => {
    const { active: a, over } = event;
    if (!over || a.id === over.id) return;
    setConditions((prev) => {
      const oldIx = prev.findIndex((r) => r.id === a.id);
      const newIx = prev.findIndex((r) => r.id === over.id);
      if (oldIx < 0 || newIx < 0) return prev;
      return arrayMove(prev, oldIx, newIx);
    });
  };

  // ─── Action CRUD ──────────────────────────────────────────────────────────
  const addAction = () =>
    setActions((prev) => [...prev, { id: makeId(), type: ACTIONS[0].value, config: {} }]);
  const removeAction = (rowId: string) =>
    setActions((prev) => prev.filter((r) => r.id !== rowId));
  const updateActionType = (rowId: string, type: string) =>
    setActions((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, type, config: {} } : r)),
    );
  const updateActionConfig = (rowId: string, config: Record<string, any>) =>
    setActions((prev) => prev.map((r) => (r.id === rowId ? { ...r, config } : r)));

  const onActionDragEnd = (event: DragEndEvent) => {
    const { active: a, over } = event;
    if (!over || a.id === over.id) return;
    setActions((prev) => {
      const oldIx = prev.findIndex((r) => r.id === a.id);
      const newIx = prev.findIndex((r) => r.id === over.id);
      if (oldIx < 0 || newIx < 0) return prev;
      return arrayMove(prev, oldIx, newIx);
    });
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (!trigger) return false;
    if (actions.length === 0) return false;
    return true;
  }, [name, trigger, actions]);

  const handleSave = async () => {
    if (!canSave) {
      toast.error('Please add a name, a trigger, and at least one action.');
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      trigger,
      conditions: serialiseConditions(conditions, conditionLogic),
      actions: serialiseActions(actions),
      active,
    };
    try {
      const res = isNew
        ? await apiFetch('/api/v1/automations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await apiFetch(`/api/v1/automations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json().catch(() => null);
      toast.success(isNew ? 'Automation created' : 'Automation saved');
      if (isNew && saved?.id) {
        router.replace(`/settings/automations/${saved.id}`);
      }
    } catch (e) {
      toast.error('Failed to save automation');
    } finally {
      setSaving(false);
    }
  };

  // ─── Test run ─────────────────────────────────────────────────────────────
  const handleTestRun = async () => {
    let payload: any;
    try {
      payload = JSON.parse(testPayload);
    } catch {
      toast.error('Test payload is not valid JSON');
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    // Run locally — the backend has no test-run endpoint today.
    try {
      const result = simulateRule({
        trigger,
        conditions: serialiseConditions(conditions, conditionLogic),
        actions: serialiseActions(actions),
        payload,
      });
      setTestResult(result);
    } finally {
      setTestRunning(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  }

  const triggerDef = findTrigger(trigger);
  const fieldOptions = triggerDef?.fields ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex flex-col gap-3">
        <Link
          href="/settings/automations"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary transition-colors w-fit"
        >
          <span aria-hidden="true">&larr;</span>
          Back to automations
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled automation"
            className="text-2xl font-bold text-gray-900 dark:text-gray-100 bg-transparent border-none focus:outline-none focus:ring-0 px-0 placeholder:text-gray-300 dark:placeholder:text-gray-600 w-full sm:max-w-md"
          />
          <div className="flex items-center gap-3 flex-shrink-0">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <button
                type="button"
                onClick={() => setActive(!active)}
                aria-label={active ? 'Disable automation' : 'Enable automation'}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    active ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
              {active ? 'Active' : 'Paused'}
            </label>
            <Button
              variant="secondary"
              onClick={handleTestRun}
              icon={<Play className="w-4 h-4" />}
              loading={testRunning}
              disabled={!trigger || actions.length === 0}
            >
              Test run
            </Button>
            <Button
              onClick={handleSave}
              icon={<SaveIcon className="w-4 h-4" />}
              loading={saving}
              disabled={!canSave}
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setActiveTab('builder')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'builder'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          <Settings2 className="w-4 h-4" />
          Builder
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          <History className="w-4 h-4" />
          Run history
        </button>
      </div>

      {activeTab === 'history' ? (
        <Card padding="lg">
          <div className="text-center py-10">
            <History className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
              No execution history yet
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Coming soon — backend hook needed. The API does not currently persist or expose
              automation execution logs.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Step 1 — When this happens */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold">
                1
              </span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  When this happens
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Choose the event that starts this automation.</p>
              </div>
            </div>
            <div className="p-6 space-y-2">
              <select
                value={trigger}
                onChange={(e) => {
                  setTrigger(e.target.value);
                  // Reset condition fields that may not exist on the new trigger.
                  setConditions((prev) =>
                    prev.map((r) => ({ ...r, field: r.field || '' })),
                  );
                }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {triggerDef ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">{triggerDef.description}</p>
              ) : null}
            </div>
          </Card>

          {/* Step 2 — Only if (conditions) */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold">
                2
              </span>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Only if</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Optional. Filter which events should trigger this automation.
                </p>
              </div>
              {conditions.length > 1 ? (
                <div className="inline-flex border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setConditionLogic('AND')}
                    className={`px-3 py-1.5 ${
                      conditionLogic === 'AND'
                        ? 'bg-primary text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() => setConditionLogic('OR')}
                    className={`px-3 py-1.5 ${
                      conditionLogic === 'OR'
                        ? 'bg-primary text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    OR
                  </button>
                </div>
              ) : null}
            </div>
            <div className="p-6 space-y-3">
              {conditions.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No conditions — this automation runs every time the trigger fires.
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onConditionDragEnd}
                >
                  <SortableContext
                    items={conditions.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {conditions.map((row) => (
                        <SortableRow key={row.id} id={row.id}>
                          {({ attributes, listeners, isDragging }) => (
                            <div
                              className={`flex items-start gap-2 p-3 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/60 dark:bg-gray-900/40 ${
                                isDragging ? 'shadow-lg' : ''
                              }`}
                            >
                              <button
                                type="button"
                                {...attributes}
                                {...listeners}
                                className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing pt-2"
                                aria-label="Drag to reorder"
                              >
                                <GripVertical className="w-4 h-4" />
                              </button>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                                {fieldOptions.length > 0 ? (
                                  <select
                                    value={row.field}
                                    onChange={(e) => updateCondition(row.id, { field: e.target.value })}
                                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                                  >
                                    <option value="">— field —</option>
                                    {fieldOptions.map((f) => (
                                      <option key={f} value={f}>
                                        {f}
                                      </option>
                                    ))}
                                    {/* Custom field fallback */}
                                    {row.field && !fieldOptions.includes(row.field) ? (
                                      <option value={row.field}>{row.field} (custom)</option>
                                    ) : null}
                                  </select>
                                ) : (
                                  <input
                                    value={row.field}
                                    onChange={(e) => updateCondition(row.id, { field: e.target.value })}
                                    placeholder="field"
                                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                                  />
                                )}
                                <select
                                  value={row.operator}
                                  onChange={(e) => updateCondition(row.id, { operator: e.target.value })}
                                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                                >
                                  {OPERATORS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={row.value}
                                  onChange={(e) => updateCondition(row.id, { value: e.target.value })}
                                  placeholder="value"
                                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCondition(row.id)}
                                className="text-gray-400 hover:text-red-600 pt-2"
                                aria-label="Remove condition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </SortableRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
              <button
                type="button"
                onClick={addCondition}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <Plus className="w-3.5 h-3.5" />
                Add condition
              </button>
            </div>
          </Card>

          {/* Step 3 — Then do (actions) */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold">
                3
              </span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Then do</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Actions run in order. Drag to reorder.
                </p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {actions.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No actions yet. Add at least one to save the automation.
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onActionDragEnd}
                >
                  <SortableContext
                    items={actions.map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3">
                      {actions.map((row, idx) => {
                        const def = findAction(row.type);
                        return (
                          <SortableRow key={row.id} id={row.id}>
                            {({ attributes, listeners, isDragging }) => (
                              <div
                                className={`p-3 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/60 dark:bg-gray-900/40 ${
                                  isDragging ? 'shadow-lg' : ''
                                }`}
                              >
                                <div className="flex items-start gap-2 mb-3">
                                  <button
                                    type="button"
                                    {...attributes}
                                    {...listeners}
                                    className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing pt-2"
                                    aria-label="Drag to reorder"
                                  >
                                    <GripVertical className="w-4 h-4" />
                                  </button>
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium mt-1.5">
                                    {idx + 1}
                                  </span>
                                  <select
                                    value={row.type}
                                    onChange={(e) => updateActionType(row.id, e.target.value)}
                                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                                  >
                                    {ACTIONS.map((a) => (
                                      <option key={a.value} value={a.value}>
                                        {a.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeAction(row.id)}
                                    className="text-gray-400 hover:text-red-600 pt-2"
                                    aria-label="Remove action"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                {def ? (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 ml-12">
                                    {def.description}
                                  </p>
                                ) : null}
                                <div className="ml-12">
                                  <ActionParamsEditor
                                    action={row}
                                    onChange={(config) => updateActionConfig(row.id, config)}
                                  />
                                </div>
                              </div>
                            )}
                          </SortableRow>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
              <button
                type="button"
                onClick={addAction}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <Plus className="w-3.5 h-3.5" />
                Add action
              </button>
            </div>
          </Card>

          {/* Test run panel */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <Play className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Test run</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Simulates the rule locally against a sample event payload. Does not call out to
                  email, webhooks, or the database.
                </p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Sample payload (JSON)
                </label>
                <textarea
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {testResult ? (
                <div className="border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
                  <div
                    className={`px-3 py-2 text-xs font-medium ${
                      testResult.matched
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {testResult.matched
                      ? `Conditions matched — ${testResult.actions.length} action(s) would run`
                      : 'Conditions did not match — no actions would run'}
                  </div>
                  {testResult.matched && testResult.actions.length > 0 ? (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {testResult.actions.map((entry, i) => (
                        <li key={i} className="px-3 py-2 text-xs">
                          <div className="font-medium text-gray-700 dark:text-gray-300">
                            {i + 1}. {entry.label}
                          </div>
                          <pre className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                            {entry.detail}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Local test-run simulator ───────────────────────────────────────────────
//
// The backend has no `/automations/:id/test` endpoint, so we mirror the rule
// engine's logic locally to give the user a quick sanity check. This is a
// best-effort preview — it does NOT send email, hit the DB, or fire webhooks.

interface TestResult {
  matched: boolean;
  actions: { label: string; detail: string }[];
}

function pickEntity(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  return (
    payload.ticket ?? payload.invoice ?? payload.lead ?? payload.task ?? payload
  );
}

function evaluateOne(rule: any, payload: any): boolean {
  const entity = pickEntity(payload);
  const fieldValue = entity?.[rule.field];
  switch (rule.operator) {
    case 'equals':
      return String(fieldValue) === String(rule.value);
    case 'not_equals':
      return String(fieldValue) !== String(rule.value);
    case 'contains':
      return String(fieldValue ?? '').toLowerCase().includes(String(rule.value).toLowerCase());
    case 'greater_than':
      return Number(fieldValue) > Number(rule.value);
    case 'less_than':
      return Number(fieldValue) < Number(rule.value);
    default:
      return true;
  }
}

function evaluateConditions(conditions: any, payload: any): boolean {
  if (!conditions) return true;
  if (Array.isArray(conditions?.rules)) {
    const rules = conditions.rules;
    if (rules.length === 0) return true;
    if (conditions.logic === 'OR') return rules.some((r: any) => evaluateOne(r, payload));
    return rules.every((r: any) => evaluateOne(r, payload));
  }
  if (conditions.field) return evaluateOne(conditions, payload);
  return true;
}

function describeAction(action: any): { label: string; detail: string } {
  const def = findAction(action.type);
  const label = def?.label ?? action.type;
  const detail = JSON.stringify(action.config ?? {}, null, 2);
  return { label, detail };
}

function simulateRule({
  trigger,
  conditions,
  actions,
  payload,
}: {
  trigger: string;
  conditions: any;
  actions: any[];
  payload: any;
}): TestResult {
  void trigger; // trigger only matters for routing in production; in the simulator we always run the rule.
  const matched = evaluateConditions(conditions, payload);
  if (!matched) return { matched: false, actions: [] };
  return {
    matched: true,
    actions: actions.map(describeAction),
  };
}
