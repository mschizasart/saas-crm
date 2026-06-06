'use client';

/**
 * Report builder (Wave D2).
 *
 * Five-step workflow:
 *   1. Pick entity (clients | leads | invoices | opportunities | ...)
 *   2. Pick fields to include
 *   3. Add filter rows (field, op, value)
 *   4. Optional group-by + aggregations
 *   5. Pick chart type (table / bar / line / pie)
 *
 * Entities + fields come from GET /report-defs/entities (the
 * server-authoritative whitelist — the same one report-engine.ts
 * enforces at run time).
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type FieldType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

interface EntityDef {
  fields: { name: string; type: FieldType }[];
}

type EntityRegistry = Record<string, EntityDef>;

type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith';

const OPS_FOR_TYPE: Record<FieldType, FilterOp[]> = {
  string: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'],
  number: ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
  boolean: ['eq', 'ne'],
  enum: ['eq', 'ne', 'in', 'nin'],
};

type ChartType = 'table' | 'bar' | 'line' | 'pie';
const CHART_TYPES: ChartType[] = ['table', 'bar', 'line', 'pie'];

type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
const AGG_FNS: AggFn[] = ['count', 'sum', 'avg', 'min', 'max'];

interface FilterRow {
  field: string;
  op: FilterOp;
  value: string;
}

interface AggRow {
  fn: AggFn;
  field: string;
}

export default function NewReportPage() {
  const router = useRouter();

  // ─── Form state ───────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entityType, setEntityType] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [groupBy, setGroupBy] = useState<string>('');
  const [aggregations, setAggregations] = useState<AggRow[]>([]);
  const [chartType, setChartType] = useState<ChartType>('table');

  // ─── Entities metadata ────────────────────────────────────────
  const [registry, setRegistry] = useState<EntityRegistry>({});
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/report-defs/entities');
        if (!res.ok) {
          throw new Error(`Failed to load entities (${res.status})`);
        }
        setRegistry((await res.json()) as EntityRegistry);
      } catch (err: any) {
        setRegistryError(err?.message ?? 'Failed to load entity metadata');
      }
    })();
  }, []);

  const entityKeys = useMemo(() => Object.keys(registry), [registry]);
  const currentFields = useMemo(
    () => (entityType && registry[entityType]?.fields) || [],
    [entityType, registry],
  );

  // Reset dependent state when the entity changes
  useEffect(() => {
    setSelectedFields([]);
    setFilters([]);
    setGroupBy('');
    setAggregations([]);
  }, [entityType]);

  const toggleField = (name: string) => {
    setSelectedFields((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name],
    );
  };

  const addFilter = () => {
    const first = currentFields[0];
    if (!first) return;
    const op = OPS_FOR_TYPE[first.type][0];
    setFilters((f) => [...f, { field: first.name, op, value: '' }]);
  };

  const updateFilter = (idx: number, patch: Partial<FilterRow>) => {
    setFilters((f) => f.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeFilter = (idx: number) => {
    setFilters((f) => f.filter((_, i) => i !== idx));
  };

  const addAggregation = () => {
    const numericField = currentFields.find((f) => f.type === 'number');
    setAggregations((a) => [
      ...a,
      { fn: 'count', field: numericField?.name ?? currentFields[0]?.name ?? '' },
    ]);
  };

  const updateAggregation = (idx: number, patch: Partial<AggRow>) => {
    setAggregations((a) =>
      a.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
  };

  const removeAggregation = (idx: number) => {
    setAggregations((a) => a.filter((_, i) => i !== idx));
  };

  /**
   * Convert the UI filter rows into the JSON shape the engine expects.
   * String values for `in`/`nin` are split on commas; numeric values
   * coerced to Number; date values left as ISO strings.
   */
  const buildPayload = () => {
    const typeByName = new Map(currentFields.map((f) => [f.name, f.type]));
    const cookedFilters = filters
      .filter((f) => f.field && f.op)
      .map((f) => {
        const type = typeByName.get(f.field) ?? 'string';
        let value: unknown = f.value;
        if (f.op === 'in' || f.op === 'nin') {
          value = String(f.value)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => (type === 'number' ? Number(s) : s));
        } else if (type === 'number') {
          value = f.value === '' ? null : Number(f.value);
        } else if (type === 'boolean') {
          value = f.value === 'true';
        }
        return { field: f.field, op: f.op, value };
      });

    return {
      name: name.trim(),
      description: description.trim() || undefined,
      entityType,
      filters: cookedFilters,
      groupBy: groupBy || null,
      aggregations: aggregations.filter((a) => a.fn && (a.fn === 'count' || a.field)),
      fields: selectedFields,
      chartType,
    };
  };

  const save = async () => {
    setSaveError(null);
    if (!name.trim()) {
      setSaveError('Name is required');
      return;
    }
    if (!entityType) {
      setSaveError('Pick an entity');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/report-defs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      const created = await res.json();
      router.push(`/reports/builder/${created.id}`);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/reports/builder"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          New Report
        </h1>
      </div>

      {registryError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {registryError}
        </div>
      )}

      <div className="space-y-6">
        {/* ─── Step 1: Name + Entity ─── */}
        <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">
            1. Name &amp; Source
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 leads by status"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Entity
              </label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Pick one…</option>
                {entityKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short note about what this report is for"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        {entityType && (
          <>
            {/* ─── Step 2: Fields ─── */}
            <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">
                2. Fields to include
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {currentFields.map((f) => (
                  <label
                    key={f.name}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(f.name)}
                      onChange={() => toggleField(f.name)}
                      className="rounded"
                    />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-gray-400">{f.type}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* ─── Step 3: Filters ─── */}
            <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                  3. Filters
                </h2>
                <button
                  onClick={addFilter}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add filter
                </button>
              </div>
              {filters.length === 0 ? (
                <p className="text-xs text-gray-500">No filters — all rows.</p>
              ) : (
                <div className="space-y-2">
                  {filters.map((f, idx) => {
                    const fieldDef = currentFields.find((c) => c.name === f.field);
                    const allowedOps = fieldDef ? OPS_FOR_TYPE[fieldDef.type] : [];
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={f.field}
                          onChange={(e) => {
                            const newField = e.target.value;
                            const newDef = currentFields.find(
                              (c) => c.name === newField,
                            );
                            const newOp = newDef
                              ? OPS_FOR_TYPE[newDef.type][0]
                              : 'eq';
                            updateFilter(idx, { field: newField, op: newOp });
                          }}
                          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
                        >
                          {currentFields.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={f.op}
                          onChange={(e) =>
                            updateFilter(idx, { op: e.target.value as FilterOp })
                          }
                          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
                        >
                          {allowedOps.map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                        </select>
                        <input
                          type={
                            fieldDef?.type === 'date'
                              ? 'date'
                              : fieldDef?.type === 'number'
                                ? 'number'
                                : 'text'
                          }
                          value={f.value}
                          onChange={(e) =>
                            updateFilter(idx, { value: e.target.value })
                          }
                          placeholder={
                            f.op === 'in' || f.op === 'nin'
                              ? 'comma,separated'
                              : 'value'
                          }
                          className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
                        />
                        <button
                          onClick={() => removeFilter(idx)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ─── Step 4: Group-by + Aggregations ─── */}
            <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">
                4. Group &amp; Aggregate
              </h2>
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Group by
                </label>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className="w-full sm:w-1/2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="">— none —</option>
                  {currentFields.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500">
                  Aggregations
                </span>
                <button
                  onClick={addAggregation}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
              {aggregations.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No aggregations — raw rows.
                </p>
              ) : (
                <div className="space-y-2">
                  {aggregations.map((a, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={a.fn}
                        onChange={(e) =>
                          updateAggregation(idx, { fn: e.target.value as AggFn })
                        }
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
                      >
                        {AGG_FNS.map((fn) => (
                          <option key={fn} value={fn}>
                            {fn}
                          </option>
                        ))}
                      </select>
                      <select
                        value={a.field}
                        onChange={(e) =>
                          updateAggregation(idx, { field: e.target.value })
                        }
                        disabled={a.fn === 'count'}
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {currentFields
                          .filter((c) =>
                            ['sum', 'avg', 'min', 'max'].includes(a.fn)
                              ? c.type === 'number'
                              : true,
                          )
                          .map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => removeAggregation(idx)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ─── Step 5: Chart Type ─── */}
            <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">
                5. Visualization
              </h2>
              <div className="flex flex-wrap gap-2">
                {CHART_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    className={`px-4 py-2 rounded-lg text-sm capitalize border ${
                      chartType === t
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ─── Save ─── */}
        <div className="flex items-center justify-between sticky bottom-0 bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 border-t border-gray-100 dark:border-gray-800">
          {saveError && (
            <span className="text-sm text-red-600">{saveError}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/reports/builder"
              className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              onClick={save}
              disabled={saving || !name.trim() || !entityType}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save & Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
