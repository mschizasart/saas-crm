'use client';

/**
 * Approval Request detail (Wave E1).
 *
 * Shows the target preview, the full step timeline (decided steps with
 * comment; pending step highlighted), and an Approve/Reject action with
 * a comment textarea. The "Decide" buttons are disabled when the
 * request isn't pending OR the current user can't see a 200 from
 * /my-pending for this id (cheap eligibility hint — the API enforces
 * the real check).
 *
 * Cancel is shown only when the request is pending AND `requestedById`
 * matches the current user.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

type ApproverType = 'user' | 'role' | 'manager';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface Step {
  id: string;
  order: number;
  approverType: ApproverType;
  approverUserId: string | null;
  approverRoleId: string | null;
  name: string | null;
}

interface Decision {
  id: string;
  stepOrder: number;
  decidedById: string;
  decision: 'approve' | 'reject';
  comment: string | null;
  decidedAt: string;
}

interface Process {
  id: string;
  name: string;
  entityType: string;
  steps: Step[];
}

interface Request {
  id: string;
  process: Process;
  targetType: string;
  targetId: string;
  status: Status;
  currentStepOrder: number;
  requestedById: string;
  startedAt: string;
  completedAt: string | null;
  decisions: Decision[];
}

interface Me { id: string }

const STATUS_BADGE: Record<Status, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function ApprovalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [req, setReq] = useState<Request | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [eligibleToDecide, setEligibleToDecide] = useState(false);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rRes, meRes, pendRes] = await Promise.all([
        apiFetch(`/api/v1/approval-requests/${id}`),
        apiFetch('/api/v1/users/me'),
        apiFetch('/api/v1/approval-requests/my-pending'),
      ]);
      if (!rRes.ok) throw new Error(`Load failed: ${rRes.status}`);
      const reqData = (await rRes.json()) as Request;
      setReq(reqData);
      if (meRes.ok) setMe(await meRes.json());
      if (pendRes.ok) {
        const pend = await pendRes.json();
        const list = (pend?.data ?? []) as { id: string }[];
        setEligibleToDecide(list.some((r) => r.id === id));
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

  async function decide(decision: 'approve' | 'reject') {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/approval-requests/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          comment: comment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Decision failed: ${res.status}`);
      }
      setComment('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!confirm('Cancel this approval request?')) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/approval-requests/${id}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Cancel failed: ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!req) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorBanner message={error ?? 'Request not found'} />
      </div>
    );
  }

  const decisionByStepOrder = new Map<number, Decision>();
  for (const d of req.decisions) decisionByStepOrder.set(d.stepOrder, d);

  const canCancel = req.status === 'pending' && me?.id === req.requestedById;
  const canDecide = req.status === 'pending' && eligibleToDecide;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link
          href="/approvals"
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Back to approvals
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{req.process.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="capitalize">{req.process.entityType}</span>
            {' · '}
            <span className="font-mono text-xs">{req.targetId}</span>
          </p>
        </div>
        <span
          className={`inline-flex px-3 py-1 rounded text-sm border ${STATUS_BADGE[req.status]}`}
        >
          {req.status}
        </span>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold mb-1">Target</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          <span className="capitalize">{req.targetType}</span>{' '}
          <span className="font-mono text-xs">{req.targetId}</span>
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Started {new Date(req.startedAt).toLocaleString()}
          {req.completedAt && (
            <>
              {' · '}
              Completed {new Date(req.completedAt).toLocaleString()}
            </>
          )}
        </p>
      </Card>

      <Card className="p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Step timeline</h2>
        <ol className="space-y-3">
          {req.process.steps
            .sort((a, b) => a.order - b.order)
            .map((step) => {
              const decision = decisionByStepOrder.get(step.order);
              const isCurrent =
                req.status === 'pending' && step.order === req.currentStepOrder;
              const dotClass = decision
                ? decision.decision === 'approve'
                  ? 'bg-green-500'
                  : 'bg-red-500'
                : isCurrent
                  ? 'bg-amber-500'
                  : 'bg-gray-300';
              return (
                <li key={step.id} className="flex gap-3">
                  <div
                    className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${dotClass}`}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      Step {step.order} {step.name ? `— ${step.name}` : ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      {step.approverType === 'user'
                        ? 'Approver: specific user'
                        : step.approverType === 'role'
                          ? 'Approver: any user in role'
                          : "Approver: requester's manager"}
                    </p>
                    {decision ? (
                      <div className="mt-1 text-xs">
                        <span
                          className={
                            decision.decision === 'approve'
                              ? 'text-green-700'
                              : 'text-red-700'
                          }
                        >
                          {decision.decision}d
                        </span>{' '}
                        on {new Date(decision.decidedAt).toLocaleString()}
                        {decision.comment && (
                          <p className="text-gray-600 dark:text-gray-400 mt-0.5 italic">
                            “{decision.comment}”
                          </p>
                        )}
                      </div>
                    ) : isCurrent ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Awaiting decision
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-400">Not yet reached</p>
                    )}
                  </div>
                </li>
              );
            })}
        </ol>
      </Card>

      {canDecide && (
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold mb-3">Your decision</h2>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Comment (optional)"
            className="w-full px-3 py-2 border rounded-md text-sm dark:bg-gray-800 dark:border-gray-700 mb-3"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => decide('reject')}
              disabled={submitting}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Reject
            </Button>
            <Button onClick={() => decide('approve')} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Approve'}
            </Button>
          </div>
        </Card>
      )}

      {canCancel && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            onClick={cancel}
            disabled={submitting}
            className="text-red-600 hover:text-red-700"
          >
            Cancel request
          </Button>
        </div>
      )}
    </div>
  );
}
