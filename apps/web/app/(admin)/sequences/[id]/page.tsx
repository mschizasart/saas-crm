'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form-field';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import {
  Mail,
  CheckSquare,
  Clock,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
} from 'lucide-react';

type StepType = 'email' | 'task' | 'wait';

interface Step {
  id: string;
  position: number;
  type: StepType;
  delayMinutes: number;
  emailSubject?: string | null;
  emailBody?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  steps: Step[];
  createdAt: string;
}

interface Enrollment {
  id: string;
  recipientType: string;
  recipientName: string;
  recipientEmail: string;
  status: string;
  currentStepIndex: number;
  nextStepAt: string | null;
  enrolledAt: string;
}

interface Stats {
  totalEnrolled: number;
  active: number;
  completed: number;
  emailsSent: number;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'muted',
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

const ENROLLMENT_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  completed: 'info',
  paused: 'warning',
  unenrolled: 'muted',
  failed: 'error',
};

const STEP_TYPES: { value: StepType; label: string; icon: React.ReactNode }[] = [
  { value: 'email', label: 'Email', icon: <Mail className="w-4 h-4" /> },
  { value: 'task', label: 'Task', icon: <CheckSquare className="w-4 h-4" /> },
  { value: 'wait', label: 'Wait', icon: <Clock className="w-4 h-4" /> },
];

// ── Delay helpers ──────────────────────────────────────────────────────
type DelayUnit = 'minutes' | 'hours' | 'days';

function splitDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes <= 0) return { value: 0, unit: 'minutes' };
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function toMinutes(value: number, unit: DelayUnit): number {
  if (unit === 'days') return value * 1440;
  if (unit === 'hours') return value * 60;
  return value;
}

function delayLabel(minutes: number): string {
  if (minutes <= 0) return 'immediately';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ');
}

export default function SequenceEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const loadSequence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/sequences/${id}`);
      if (!res.ok) {
        toast.error('Sequence not found');
        router.push('/sequences');
        return;
      }
      const s: Sequence = await res.json();
      s.steps = [...(s.steps ?? [])].sort((a, b) => a.position - b.position);
      setSequence(s);
      setName(s.name);
      setDescription(s.description ?? '');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  const loadEnrollments = useCallback(async () => {
    const res = await apiFetch(`/api/v1/sequences/${id}/enrollments`);
    if (res.ok) setEnrollments(await res.json());
  }, [id]);

  const loadStats = useCallback(async () => {
    const res = await apiFetch(`/api/v1/sequences/${id}/stats`);
    if (res.ok) setStats(await res.json());
  }, [id]);

  useEffect(() => {
    loadSequence();
    loadEnrollments();
    loadStats();
  }, [loadSequence, loadEnrollments, loadStats]);

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/v1/sequences/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not save sequence');
        return false;
      }
      const updated = await res.json();
      setSequence((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success('Saved');
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function runAction(
    action: 'activate' | 'pause' | 'resume',
    successMsg: string,
  ) {
    setActing(true);
    try {
      const res = await apiFetch(`/api/v1/sequences/${id}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? `Could not ${action} sequence`);
        return;
      }
      toast.success(successMsg);
      await loadSequence();
    } finally {
      setActing(false);
    }
  }

  async function deleteSequence() {
    if (!confirm('Delete this sequence? This cannot be undone.')) return;
    setActing(true);
    try {
      const res = await apiFetch(`/api/v1/sequences/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not delete sequence');
        return;
      }
      toast.success('Sequence deleted');
      router.push('/sequences');
    } finally {
      setActing(false);
    }
  }

  // ── Step operations ──────────────────────────────────────────────
  async function addStep(type: StepType) {
    const res = await apiFetch(`/api/v1/sequences/${id}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, delayMinutes: type === 'wait' ? 1440 : 0 }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e?.message ?? 'Could not add step');
      return;
    }
    await loadSequence();
  }

  async function updateStep(stepId: string, patch: Partial<Step>) {
    const res = await apiFetch(`/api/v1/sequences/${id}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e?.message ?? 'Could not save step');
      return;
    }
    // Merge locally so inline edits persist without a full refetch.
    setSequence((prev) =>
      prev
        ? {
            ...prev,
            steps: prev.steps.map((s) =>
              s.id === stepId ? { ...s, ...patch } : s,
            ),
          }
        : prev,
    );
  }

  async function deleteStep(stepId: string) {
    const res = await apiFetch(`/api/v1/sequences/${id}/steps/${stepId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e?.message ?? 'Could not delete step');
      return;
    }
    await loadSequence();
  }

  async function moveStep(index: number, dir: -1 | 1) {
    if (!sequence) return;
    const steps = [...sequence.steps];
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    // Optimistic reorder.
    setSequence({ ...sequence, steps });
    const res = await apiFetch(`/api/v1/sequences/${id}/steps/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedStepIds: steps.map((s) => s.id) }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e?.message ?? 'Could not reorder steps');
      await loadSequence();
    }
  }

  async function unenroll(enrollmentId: string) {
    const res = await apiFetch(
      `/api/v1/sequences/enrollments/${enrollmentId}/unenroll`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e?.message ?? 'Could not unenroll');
      return;
    }
    toast.success('Unenrolled');
    await Promise.all([loadEnrollments(), loadStats()]);
  }

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }
  if (!sequence) return null;

  const status = sequence.status;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-1">
      <PageHeader
        title={name || 'Untitled sequence'}
        backHref="/sequences"
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[status] ?? 'default'}>{status}</Badge>
          </span>
        }
      >
        <Button variant="secondary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {status === 'draft' && (
          <Button
            variant="primary"
            onClick={() => runAction('activate', 'Sequence activated')}
            disabled={acting}
          >
            Activate
          </Button>
        )}
        {status === 'active' && (
          <Button
            variant="secondary"
            onClick={() => runAction('pause', 'Sequence paused')}
            disabled={acting}
          >
            Pause
          </Button>
        )}
        {status === 'paused' && (
          <Button
            variant="primary"
            onClick={() => runAction('resume', 'Sequence resumed')}
            disabled={acting}
          >
            Resume
          </Button>
        )}
        {status === 'draft' && (
          <Button
            variant="destructive"
            onClick={deleteSequence}
            disabled={acting}
          >
            Delete
          </Button>
        )}
      </PageHeader>

      {/* ── Stats ──────────────────────────────────────────────── */}
      {stats && (
        <Card padding="md">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Total enrolled" value={stats.totalEnrolled} />
            <Stat label="Active" value={stats.active} />
            <Stat label="Completed" value={stats.completed} />
            <Stat label="Emails sent" value={stats.emailsSent} />
          </div>
        </Card>
      )}

      {/* ── Details ────────────────────────────────────────────── */}
      <Card padding="md" className="space-y-4">
        <FormField label="Sequence name" required>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="Description">
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this sequence for?"
          />
        </FormField>
      </Card>

      {/* ── Steps builder ──────────────────────────────────────── */}
      <Card padding="md" className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Steps
        </h2>

        {sequence.steps.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No steps yet. Add an email, task, or wait below.
          </p>
        ) : (
          <ol className="space-y-3">
            {sequence.steps.map((step, idx) => (
              <StepCard
                key={step.id}
                step={step}
                index={idx}
                total={sequence.steps.length}
                onMove={moveStep}
                onUpdate={updateStep}
                onDelete={deleteStep}
              />
            ))}
          </ol>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center mr-1">
            Add step:
          </span>
          {STEP_TYPES.map((t) => (
            <Button
              key={t.value}
              variant="secondary"
              size="sm"
              icon={t.icon}
              onClick={() => addStep(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* ── Enrollments ────────────────────────────────────────── */}
      <Card padding="md" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Enrollments
          </h2>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setEnrollOpen(true)}
          >
            Enroll records
          </Button>
        </div>

        {enrollments.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No one is enrolled yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Step</th>
                  <th className="px-3 py-2 font-medium">Next step</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {enrollments.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {e.recipientName || e.recipientEmail}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {e.recipientEmail}
                        <span className="text-gray-400"> · {e.recipientType}</span>
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={ENROLLMENT_VARIANT[e.status] ?? 'default'}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.currentStepIndex + 1}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {e.nextStepAt
                        ? new Date(e.nextStepAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.status === 'active' && (
                        <button
                          onClick={() => unenroll(e.id)}
                          className="text-xs text-red-600 dark:text-red-400 hover:underline"
                        >
                          Unenroll
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {enrollOpen && (
        <EnrollModal
          sequenceId={id}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={async () => {
            setEnrollOpen(false);
            await Promise.all([loadEnrollments(), loadStats()]);
          }}
        />
      )}
    </div>
  );
}

// ── Step card ──────────────────────────────────────────────────────────
function StepCard({
  step,
  index,
  total,
  onMove,
  onUpdate,
  onDelete,
}: {
  step: Step;
  index: number;
  total: number;
  onMove: (index: number, dir: -1 | 1) => void;
  onUpdate: (stepId: string, patch: Partial<Step>) => void;
  onDelete: (stepId: string) => void;
}) {
  const meta = STEP_TYPES.find((t) => t.value === step.type)!;

  // Local editable state — committed on blur via onUpdate.
  const [subject, setSubject] = useState(step.emailSubject ?? '');
  const [body, setBody] = useState(step.emailBody ?? '');
  const [taskTitle, setTaskTitle] = useState(step.taskTitle ?? '');
  const [taskDescription, setTaskDescription] = useState(
    step.taskDescription ?? '',
  );
  const split = splitDelay(step.delayMinutes);
  const [delayValue, setDelayValue] = useState(split.value);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(split.unit);

  function commitDelay(value: number, unit: DelayUnit) {
    onUpdate(step.id, { delayMinutes: toMinutes(value, unit) });
  }

  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs">
            {index + 1}
          </span>
          <span className="text-primary">{meta.icon}</span>
          <span className="capitalize">{step.type}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
            aria-label="Move up"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
            aria-label="Move down"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(step.id)}
            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400"
            aria-label="Delete step"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Wait <span className="font-medium">{delayLabel(step.delayMinutes)}</span>{' '}
        then…
      </p>

      {/* Delay editor */}
      <div className="flex items-end gap-2 mb-3">
        <FormField label="Delay" className="w-28">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={delayValue}
            onChange={(e) => setDelayValue(Number(e.target.value))}
            onBlur={() => commitDelay(delayValue, delayUnit)}
          />
        </FormField>
        <FormField label="Unit" className="w-32">
          <select
            className={inputClass}
            value={delayUnit}
            onChange={(e) => {
              const unit = e.target.value as DelayUnit;
              setDelayUnit(unit);
              commitDelay(delayValue, unit);
            }}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </FormField>
      </div>

      {step.type === 'email' && (
        <div className="space-y-3">
          <FormField label="Subject">
            <input
              className={inputClass}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => onUpdate(step.id, { emailSubject: subject })}
              placeholder="Email subject line"
            />
          </FormField>
          <FormField label="Body" hint="HTML is supported.">
            <textarea
              className={inputClass}
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => onUpdate(step.id, { emailBody: body })}
              placeholder="Email body"
            />
          </FormField>
        </div>
      )}

      {step.type === 'task' && (
        <div className="space-y-3">
          <FormField label="Task title">
            <input
              className={inputClass}
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onBlur={() => onUpdate(step.id, { taskTitle })}
              placeholder="e.g. Call the prospect"
            />
          </FormField>
          <FormField label="Task description">
            <textarea
              className={inputClass}
              rows={3}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              onBlur={() => onUpdate(step.id, { taskDescription })}
              placeholder="Details for the assignee"
            />
          </FormField>
        </div>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ── Enroll modal ───────────────────────────────────────────────────────
interface PickerRow {
  id: string;
  label: string;
  sublabel?: string;
}

function EnrollModal({
  sequenceId,
  onClose,
  onEnrolled,
}: {
  sequenceId: string;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const [tab, setTab] = useState<'lead' | 'client'>('lead');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, 'lead' | 'client'>>(
    {},
  );
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      const endpoint = tab === 'lead' ? 'leads' : 'clients';
      const res = await apiFetch(`/api/v1/${endpoint}?${params.toString()}`);
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = await res.json();
      // Both list endpoints return { data, total, ... }.
      const list: unknown[] = Array.isArray(json) ? json : (json?.data ?? []);
      setRows(
        list.map((r) => {
          const rec = r as Record<string, unknown>;
          const label =
            (rec.name as string) ||
            (rec.company as string) ||
            (rec.email as string) ||
            (rec.id as string);
          const sublabel =
            (rec.email as string) ||
            (rec.company as string) ||
            undefined;
          return { id: rec.id as string, label, sublabel };
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = tab;
      return next;
    });
  }

  async function submit() {
    const recipients = Object.entries(selected).map(([id, type]) => ({
      type,
      id,
    }));
    if (recipients.length === 0) {
      toast.error('Select at least one record');
      return;
    }
    setEnrolling(true);
    try {
      const res = await apiFetch(`/api/v1/sequences/${sequenceId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not enroll records');
        return;
      }
      const r = await res.json();
      toast.success(`Enrolled ${r.enrolled}, skipped ${r.skipped}`);
      onEnrolled();
    } finally {
      setEnrolling(false);
    }
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Enroll records
          </h2>
          <div className="flex gap-2 mb-3">
            {(['lead', 'client'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setSearch('');
                }}
                className={
                  tab === t
                    ? 'px-3 py-1.5 text-xs rounded-lg bg-primary text-white capitalize'
                    : 'px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 capitalize'
                }
              >
                {t}s
              </button>
            ))}
          </div>
          <input
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tab}s…`}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-4 text-sm text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No records found.</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selected[r.id]}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-900 dark:text-gray-100 truncate">
                        {r.label}
                      </span>
                      {r.sublabel && (
                        <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                          {r.sublabel}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {selectedCount} selected
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={enrolling || selectedCount === 0}
            >
              {enrolling ? 'Enrolling…' : 'Enroll'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
