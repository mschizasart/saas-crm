'use client';

/**
 * Settings → Approval Processes → [id] (Wave E1).
 *
 * Editor for a single approval process. Three sections:
 *
 *   1. Header — name, entity type, active toggle.
 *   2. Trigger condition — {field, op, value} builder. When all three
 *      fields are blank, the process triggers ALWAYS (server-side this
 *      is encoded as an empty object).
 *   3. Steps — ordered list of approvers. Each step picks 'user' or
 *      'role' (manager-type is deferred — see TODO in the API service);
 *      reorder is a simple up/down swap that re-numbers `order`.
 *
 * Save sends the full state via PUT, which replaces the step set
 * atomically server-side. No autosave — explicit "Save" button only.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

type ApproverType = 'user' | 'role' | 'manager';
type EntityType = 'invoice' | 'opportunity' | 'expense' | 'custom';

interface Step {
  order: number;
  approverType: ApproverType;
  approverUserId: string | null;
  approverRoleId: string | null;
  name: string | null;
}

interface ApprovalProcess {
  id: string;
  name: string;
  entityType: EntityType;
  active: boolean;
  triggerCondition: Record<string, unknown> | null;
  steps: Step[];
}

interface UserLite { id: string; firstName: string; lastName: string }
interface RoleLite { id: string; name: string }

const ENTITY_TYPES: EntityType[] = ['invoice', 'opportunity', 'expense', 'custom'];
const TRIGGER_OPS = [
  { value: 'gt', label: '> (greater than)' },
  { value: 'gte', label: '>= (greater or equal)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'lte', label: '<= (less or equal)' },
  { value: 'eq', label: '= (equals)' },
  { value: 'ne', label: '!= (not equals)' },
];

export default function ApprovalProcessEditorPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('invoice');
  const [active, setActive] = useState(true);
  const [triggerField, setTriggerField] = useState('');
  const [triggerOp, setTriggerOp] = useState('gt');
  const [triggerValue, setTriggerValue] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [roles, setRoles] = useState<RoleLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [pRes, uRes, rRes] = await Promise.all([
        apiFetch(`/api/v1/approval-processes/${id}`),
        apiFetch('/api/v1/users?limit=200'),
        apiFetch('/api/v1/roles'),
      ]);
      if (!pRes.ok) throw new Error(`Load failed: ${pRes.status}`);
      const p = (await pRes.json()) as ApprovalProcess;
      setName(p.name);
      setEntityType(p.entityType);
      setActive(p.active);
      const cond = (p.triggerCondition ?? {}) as Record<string, unknown>;
      setTriggerField(typeof cond.field === 'string' ? cond.field : '');
      setTriggerOp(typeof cond.op === 'string' ? cond.op : 'gt');
      setTriggerValue(
        cond.value !== undefined && cond.value !== null ? String(cond.value) : '',
      );
      setSteps(
        (p.steps ?? [])
          .sort((a, b) => a.order - b.order)
          .map((s) => ({
            order: s.order,
            approverType: s.approverType,
            approverUserId: s.approverUserId,
            approverRoleId: s.approverRoleId,
            name: s.name,
          })),
      );

      if (uRes.ok) {
        const data = await uRes.json();
        setUsers((data?.data ?? data ?? []) as UserLite[]);
      }
      if (rRes.ok) {
        const data = await rRes.json();
        setRoles((data?.data ?? data ?? []) as RoleLite[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ─── Step editing ──────────────────────────────────────────────

  function addStep() {
    const nextOrder = (steps[steps.length - 1]?.order ?? 0) + 1;
    setSteps((prev) => [
      ...prev,
      {
        order: nextOrder,
        approverType: 'user',
        approverUserId: users[0]?.id ?? null,
        approverRoleId: null,
        name: `Step ${nextOrder}`,
      },
    ]);
  }

  function removeStep(idx: number) {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, order: i + 1 })),
    );
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      // Renumber so order matches array position.
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  }

  function updateStep(idx: number, patch: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  // ─── Save / Delete ────────────────────────────────────────────

  function buildTriggerCondition(): Record<string, unknown> {
    if (!triggerField.trim()) return {};
    // Coerce numeric strings to numbers so the engine sees the right type.
    let value: unknown = triggerValue;
    const asNum = Number(triggerValue);
    if (triggerValue !== '' && Number.isFinite(asNum)) value = asNum;
    return { field: triggerField.trim(), op: triggerOp, value };
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Light client-side validation matching the API DTO. The server
      // will reject again — this just gives a faster, friendlier error.
      for (const s of steps) {
        if (s.approverType === 'user' && !s.approverUserId) {
          throw new Error(`Step ${s.order} needs a user`);
        }
        if (s.approverType === 'role' && !s.approverRoleId) {
          throw new Error(`Step ${s.order} needs a role`);
        }
      }

      const res = await apiFetch(`/api/v1/approval-processes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          entityType,
          active,
          triggerCondition: buildTriggerCondition(),
          steps: steps.map((s) => ({
            order: s.order,
            approverType: s.approverType,
            approverUserId: s.approverUserId ?? undefined,
            approverRoleId: s.approverRoleId ?? undefined,
            name: s.name ?? undefined,
          })),
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Save failed: ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteProcess() {
    if (!confirm('Delete this approval process? This cannot be undone.')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/approval-processes/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const msg = await res.text();
        throw new Error(msg || `Delete failed: ${res.status}`);
      }
      router.push('/settings/approval-processes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <Link
          href="/settings/approval-processes"
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Back to processes
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-6">Edit approval process</h1>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Details</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Entity type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
            >
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold mb-1">Trigger condition</h2>
        <p className="text-xs text-gray-500 mb-3">
          When does this process require approval? Leave the field empty to
          require approval for every record.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={triggerField}
            onChange={(e) => setTriggerField(e.target.value)}
            placeholder="field (e.g. total)"
            className="px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
          />
          <select
            value={triggerOp}
            onChange={(e) => setTriggerOp(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
          >
            {TRIGGER_OPS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          <input
            value={triggerValue}
            onChange={(e) => setTriggerValue(e.target.value)}
            placeholder="value (e.g. 10000)"
            className="px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Steps</h2>
          <Button type="button" variant="outline" onClick={addStep}>
            + Add step
          </Button>
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-gray-500">No steps yet.</p>
        ) : (
          <ul className="space-y-3">
            {steps.map((s, idx) => (
              <li
                key={idx}
                className="border border-gray-200 dark:border-gray-700 rounded-md p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                    #{s.order}
                  </span>
                  <input
                    value={s.name ?? ''}
                    onChange={(e) => updateStep(idx, { name: e.target.value })}
                    placeholder="Step name (optional)"
                    className="flex-1 px-2 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
                  />
                  <button
                    type="button"
                    onClick={() => moveStep(idx, -1)}
                    disabled={idx === 0}
                    className="px-2 text-xs disabled:opacity-40"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(idx, 1)}
                    disabled={idx === steps.length - 1}
                    className="px-2 text-xs disabled:opacity-40"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    className="px-2 text-xs text-red-600 hover:text-red-700"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={s.approverType}
                    onChange={(e) =>
                      updateStep(idx, {
                        approverType: e.target.value as ApproverType,
                        // Clear the other id when switching types.
                        approverUserId:
                          e.target.value === 'user' ? s.approverUserId : null,
                        approverRoleId:
                          e.target.value === 'role' ? s.approverRoleId : null,
                      })
                    }
                    className="px-2 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
                  >
                    <option value="user">Specific user</option>
                    <option value="role">Any user in role</option>
                    <option value="manager" disabled>
                      Requester's manager (coming soon)
                    </option>
                  </select>
                  {s.approverType === 'user' && (
                    <select
                      value={s.approverUserId ?? ''}
                      onChange={(e) =>
                        updateStep(idx, { approverUserId: e.target.value || null })
                      }
                      className="px-2 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
                    >
                      <option value="">Select user…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </option>
                      ))}
                    </select>
                  )}
                  {s.approverType === 'role' && (
                    <select
                      value={s.approverRoleId ?? ''}
                      onChange={(e) =>
                        updateStep(idx, { approverRoleId: e.target.value || null })
                      }
                      className="px-2 py-1 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
                    >
                      <option value="">Select role…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={deleteProcess}
          disabled={deleting}
          className="text-red-600 hover:text-red-700"
        >
          {deleting ? 'Deleting…' : 'Delete process'}
        </Button>
        <div className="flex gap-2">
          <Link href="/settings/approval-processes">
            <Button variant="ghost">Cancel</Button>
          </Link>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
