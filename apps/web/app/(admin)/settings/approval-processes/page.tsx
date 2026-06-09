'use client';

/**
 * Settings → Approval Processes (Wave E1).
 *
 * Lists every approval process the org has configured. Each row links
 * to the editor at /settings/approval-processes/[id]. The "+ New"
 * button opens a modal that creates a minimal process (name + entity
 * type + one starter step), then routes the user straight to the
 * editor to fill in the chain.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface Step {
  id: string;
  order: number;
  approverType: 'user' | 'role' | 'manager';
  approverUserId: string | null;
  approverRoleId: string | null;
  name: string | null;
}

interface ApprovalProcess {
  id: string;
  name: string;
  entityType: string;
  active: boolean;
  triggerCondition: Record<string, unknown>;
  steps: Step[];
  _count?: { requests: number };
  updatedAt: string;
}

interface ListResponse {
  data: ApprovalProcess[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UserLite { id: string; firstName: string; lastName: string }

const ENTITY_TYPES = ['invoice', 'opportunity', 'expense', 'custom'] as const;

function NewProcessModal({
  open,
  onClose,
  onCreated,
  users,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  users: UserLite[];
}) {
  const [name, setName] = useState('');
  const [entityType, setEntityType] =
    useState<(typeof ENTITY_TYPES)[number]>('invoice');
  const [approverUserId, setApproverUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setApproverUserId((id) => id || users[0]?.id || '');
  }, [open, users]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/approval-processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          entityType,
          triggerCondition: {},
          steps: [
            {
              order: 1,
              approverType: 'user',
              approverUserId,
              name: 'Approval',
            },
          ],
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Create failed: ${res.status}`);
      }
      const created = await res.json();
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">New approval process</h2>
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
              placeholder="High-value invoice approval"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Entity type</label>
            <select
              value={entityType}
              onChange={(e) =>
                setEntityType(e.target.value as (typeof ENTITY_TYPES)[number])
              }
              className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
            >
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              First approver
            </label>
            <select
              required
              value={approverUserId}
              onChange={(e) => setApproverUserId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              You can add more steps and switch to role-based approvers in the
              editor.
            </p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !approverUserId}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ApprovalProcessesSettingsPage() {
  const router = useRouter();
  const [processes, setProcesses] = useState<ApprovalProcess[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [pRes, uRes] = await Promise.all([
        apiFetch('/api/v1/approval-processes?limit=100'),
        apiFetch('/api/v1/users?limit=200'),
      ]);
      if (!pRes.ok) throw new Error(`Load failed: ${pRes.status}`);
      const pData = (await pRes.json()) as ListResponse;
      setProcesses(pData.data ?? []);
      if (uRes.ok) {
        const uData = await uRes.json();
        const list = (uData?.data ?? uData ?? []) as UserLite[];
        setUsers(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Approval Processes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Define multi-step approval chains for invoices, opportunities,
            expenses, or any custom workflow.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New process</Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : processes.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-gray-500">
            No approval processes yet. Create one to start gating high-value
            actions.
          </p>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Steps</th>
                <th className="px-4 py-2 font-medium">Requests</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/settings/approval-processes/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 capitalize">{p.entityType}</td>
                  <td className="px-4 py-2">{p.steps?.length ?? 0}</td>
                  <td className="px-4 py-2">{p._count?.requests ?? 0}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        p.active
                          ? 'inline-flex px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200'
                          : 'inline-flex px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200'
                      }
                    >
                      {p.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/settings/approval-processes/${p.id}`}
                      className="text-xs text-gray-500 hover:text-gray-900"
                    >
                      Edit →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <NewProcessModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => {
          setModalOpen(false);
          router.push(`/settings/approval-processes/${id}`);
        }}
        users={users}
      />
    </div>
  );
}
