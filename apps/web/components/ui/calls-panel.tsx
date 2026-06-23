'use client';

/**
 * Reusable call-log + click-to-call panel for a CRM record (lead | client).
 * Renders a "Calls" card that:
 *   - loads the call history via GET /api/v1/calls?relType=&relId=
 *   - provides a "Log a call" form → POST /api/v1/calls
 *   - if telephony is configured (GET /api/v1/calls/settings), shows a
 *     click-to-call "Call" button → POST /api/v1/calls/dial
 *   - allows inline edit (outcome/notes) via PUT and delete via DELETE
 *
 * Mirrors the visual style of SmsPanel/DocumentPanel so it mounts
 * consistently next to them on the detail pages.
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Phone, PhoneIncoming, PhoneOutgoing, Play, Trash2, Pencil } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

export type CallEntityType = 'lead' | 'client';

interface Call {
  id: string;
  relType: 'lead' | 'client' | null;
  relId: string | null;
  direction: 'outbound' | 'inbound';
  fromNumber: string | null;
  toNumber: string | null;
  status: string | null;
  outcome: string | null;
  durationSeconds: number | null;
  notes: string | null;
  recordingUrl: string | null;
  loggedById: string | null;
  occurredAt: string | null;
  createdAt: string;
}

interface CallSettings {
  configured: boolean;
  fromNumber: string | null;
  source: 'org' | 'env' | 'none';
}

interface Props {
  entityType: CallEntityType;
  entityId: string;
  /** Prefill for the dialled number (e.g. the lead/client phone). */
  defaultPhone?: string | null;
}

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'callback_requested', label: 'Callback requested' },
];

const OUTCOME_LABELS: Record<string, string> = Object.fromEntries(
  OUTCOME_OPTIONS.map((o) => [o.value, o.label]),
);

// status/outcome → Badge variant map.
const OUTCOME_VARIANT: Record<string, BadgeVariant> = {
  connected: 'success',
  voicemail: 'info',
  callback_requested: 'info',
  no_answer: 'warning',
  busy: 'warning',
  wrong_number: 'error',
  failed: 'error',
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallsPanel({ entityType, entityId, defaultPhone }: Props) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<CallSettings | null>(null);
  const [dialing, setDialing] = useState(false);

  // Log-a-call form state.
  const [outcome, setOutcome] = useState('connected');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [notes, setNotes] = useState('');
  const [toNumber, setToNumber] = useState(defaultPhone ?? '');
  const [logging, setLogging] = useState(false);

  // Inline-edit state (per row).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editOutcome, setEditOutcome] = useState('connected');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Keep the dial number prefill in sync when the parent resolves the phone late.
  useEffect(() => {
    if (defaultPhone && !toNumber) setToNumber(defaultPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPhone]);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/calls?relType=${encodeURIComponent(entityType)}&relId=${encodeURIComponent(entityId)}`,
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setCalls(Array.isArray(json) ? json : json.data ?? []);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (entityId) fetchCalls();
  }, [fetchCalls, entityId]);

  // Load telephony settings once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/calls/settings');
        if (!res.ok) return;
        const json: CallSettings = await res.json();
        if (!cancelled) setSettings(json);
      } catch {
        /* ignore — button just won't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logCall() {
    const mins = parseInt(minutes, 10) || 0;
    const secs = parseInt(seconds, 10) || 0;
    const durationSeconds = mins * 60 + secs;
    setLogging(true);
    try {
      const res = await apiFetch('/api/v1/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relType: entityType,
          relId: entityId,
          direction: 'outbound',
          toNumber: toNumber.trim() || undefined,
          outcome,
          durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Could not log call: ${data.message ?? `HTTP ${res.status}`}`);
        return;
      }
      toast.success('Call logged');
      setNotes('');
      setMinutes('');
      setSeconds('');
      setOutcome('connected');
      await fetchCalls();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log call');
    } finally {
      setLogging(false);
    }
  }

  async function dial() {
    if (!defaultPhone) {
      toast.error('No phone number on record to dial');
      return;
    }
    setDialing(true);
    try {
      const res = await apiFetch('/api/v1/calls/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relType: entityType,
          relId: entityId,
          toNumber: defaultPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? `Could not place call (HTTP ${res.status})`);
        return;
      }
      toast.success(`Calling… (${data.status ?? 'queued'})`);
      await fetchCalls();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not place call');
    } finally {
      setDialing(false);
    }
  }

  function startEdit(call: Call) {
    setEditingId(call.id);
    setEditOutcome(call.outcome ?? 'connected');
    setEditNotes(call.notes ?? '');
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/v1/calls/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: editOutcome, notes: editNotes.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Update failed: ${data.message ?? `HTTP ${res.status}`}`);
        return;
      }
      toast.success('Call updated');
      setEditingId(null);
      await fetchCalls();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteCall(id: string) {
    if (!confirm('Delete this call log? This cannot be undone.')) return;
    try {
      const res = await apiFetch(`/api/v1/calls/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(`Delete failed (HTTP ${res.status})`);
        return;
      }
      toast.success('Call deleted');
      await fetchCalls();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Calls {calls.length > 0 && `(${calls.length})`}
        </h2>
        {settings?.configured ? (
          <button
            onClick={dial}
            disabled={dialing || !defaultPhone}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            {dialing ? 'Calling…' : 'Call'}
          </button>
        ) : settings && !settings.configured ? (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Set up telephony in Settings
          </span>
        ) : null}
      </div>

      {/* Log a call form */}
      <div className="border-b border-gray-100 dark:border-gray-800 p-4 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Outcome
            </label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {OUTCOME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Duration (mm:ss)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="mm"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-gray-400">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                placeholder="ss"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>
        <input
          type="text"
          value={toNumber}
          onChange={(e) => setToNumber(e.target.value)}
          placeholder="Number called (E.164, e.g. +14155551234)"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Call notes…"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
        />
        <div className="flex justify-end">
          <button
            onClick={logCall}
            disabled={logging}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {logging ? 'Logging…' : 'Log a call'}
          </button>
        </div>
      </div>

      {/* Call history */}
      {loading ? (
        <div className="p-6 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-10 bg-gray-50 dark:bg-gray-800 rounded animate-pulse"
            />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          No calls logged yet
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {calls.map((call) => {
            const inbound = call.direction === 'inbound';
            const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
            const variant: BadgeVariant =
              (call.outcome ? OUTCOME_VARIANT[call.outcome] : undefined) ??
              (call.status ? OUTCOME_VARIANT[call.status] : undefined) ??
              'default';
            const isEditing = editingId === call.id;
            return (
              <li key={call.id} className="px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <Icon
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      inbound ? 'text-green-500' : 'text-blue-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {call.outcome && (
                        <Badge variant={variant}>
                          {OUTCOME_LABELS[call.outcome] ?? call.outcome}
                        </Badge>
                      )}
                      <span className="text-gray-500 dark:text-gray-400 text-xs tabular-nums">
                        {formatDuration(call.durationSeconds)}
                      </span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">
                        {new Date(call.occurredAt ?? call.createdAt).toLocaleString()}
                      </span>
                      {call.toNumber && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span className="text-gray-400 dark:text-gray-500 text-xs">
                            {call.toNumber}
                          </span>
                        </>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <select
                          value={editOutcome}
                          onChange={(e) => setEditOutcome(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          {OUTCOME_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                          placeholder="Call notes…"
                          className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(call.id)}
                            disabled={savingEdit}
                            className="px-3 py-1 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                          >
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      call.notes && (
                        <p className="mt-1 text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                          {call.notes}
                        </p>
                      )
                    )}

                    {call.recordingUrl && !isEditing && (
                      <a
                        href={call.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Play className="w-3 h-3" /> Recording
                      </a>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(call)}
                        title="Edit"
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteCall(call.id)}
                        title="Delete"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default CallsPanel;
