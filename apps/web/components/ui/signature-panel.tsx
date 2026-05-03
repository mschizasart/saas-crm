'use client';

/**
 * Admin-side signature panel.
 *
 * Fetches `GET /api/v1/{documentType}s/:id/signature` and renders:
 *   - Signed-by / when / IP / user-agent
 *   - View audit trail (table of events)
 *   - "Awaiting signature" CTA + copy-link button if unsigned
 *   - "Revoke signature" button (with confirmation) when signed
 *
 * Used from the proposal and contract detail pages.
 */

import { useState, useEffect, useCallback } from 'react';

type DocumentType = 'proposal' | 'contract';

interface AuditEvent {
  at: string;
  type: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}

interface SignatureRow {
  id: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  ipAddress: string;
  userAgent: string;
  geoCountry?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
  imageUrl?: string | null;
  isCompleted?: boolean;
  auditEvents?: AuditEvent[];
}

interface Props {
  documentType: DocumentType;
  documentId: string;
  publicHash?: string;
  publicLinkBase?: string; // e.g. /portal/contracts/sign or /portal/proposals/view
  onAfterRevoke?: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function SignaturePanel({
  documentType,
  documentId,
  publicHash,
  publicLinkBase,
  onAfterRevoke,
}: Props) {
  const [sig, setSig] = useState<SignatureRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchSig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/${documentType}s/${documentId}/signature`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setSig(data);
      } else {
        setSig(null);
      }
    } catch {
      setSig(null);
    } finally {
      setLoading(false);
    }
  }, [documentType, documentId]);

  useEffect(() => {
    fetchSig();
  }, [fetchSig]);

  function copyLink() {
    if (!publicHash || typeof window === 'undefined') return;
    const base = publicLinkBase || `/portal/${documentType}s/sign`;
    const url = `${window.location.origin}${base}/${publicHash}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function revoke() {
    setRevoking(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/${documentType}s/${documentId}/signature/revoke`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ reason: revokeReason }),
        },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setShowConfirm(false);
      setRevokeReason('');
      await fetchSig();
      onAfterRevoke?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setRevoking(false);
    }
  }

  const isCompleted = sig?.isCompleted && !sig?.revokedAt;
  const isAwaiting = !sig || !isCompleted;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Signature</h3>
        {isCompleted && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 border border-green-100">
            Signed
          </span>
        )}
        {sig?.revokedAt && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100">
            Revoked
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-20 animate-pulse bg-gray-50 dark:bg-gray-800 rounded" />
      ) : isCompleted && sig ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Signed by</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{sig.signerName}</div>
              <div className="text-xs text-gray-500">{sig.signerEmail}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">When</div>
              <div className="text-gray-900 dark:text-gray-100">
                {new Date(sig.signedAt).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">IP Address</div>
              <div className="text-gray-900 dark:text-gray-100 font-mono text-xs">{sig.ipAddress}</div>
              {sig.geoCountry && <div className="text-xs text-gray-500">{sig.geoCountry}</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">User-Agent</div>
              <div className="text-xs text-gray-500 break-all">{sig.userAgent}</div>
            </div>
          </div>

          {sig.imageUrl && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Signature</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sig.imageUrl}
                alt="Signature"
                className="max-h-24 border border-gray-100 dark:border-gray-800 rounded bg-white dark:bg-gray-900"
              />
            </div>
          )}

          {sig.auditEvents && sig.auditEvents.length > 0 && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Audit Trail</div>
              <table className="w-full text-xs">
                <thead className="text-left text-gray-400">
                  <tr>
                    <th className="py-1 pr-2 font-normal">When</th>
                    <th className="py-1 pr-2 font-normal">Event</th>
                    <th className="py-1 pr-2 font-normal">IP</th>
                    <th className="py-1 font-normal">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {sig.auditEvents.map((e, i) => (
                    <tr key={i} className="border-t border-gray-50 dark:border-gray-800">
                      <td className="py-1 pr-2 text-gray-500">{new Date(e.at).toLocaleString()}</td>
                      <td className="py-1 pr-2 text-gray-900 dark:text-gray-100">{e.type}</td>
                      <td className="py-1 pr-2 text-gray-500 font-mono">{e.ip ?? ''}</td>
                      <td className="py-1 text-gray-500">{e.detail ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <a
              href={`${API_BASE}/api/v1/${documentType}s/${documentId}/signed-pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              Download signed PDF
            </a>
            <button
              onClick={() => setShowConfirm(true)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-gray-900 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50"
            >
              Revoke signature
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Awaiting signature.</p>
          {publicHash && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm flex items-center justify-between gap-2">
              <code className="flex-1 truncate text-xs text-gray-600 dark:text-gray-400">
                {typeof window !== 'undefined'
                  ? `${window.location.origin}${publicLinkBase || `/portal/${documentType}s/sign`}/${publicHash}`
                  : publicHash}
              </code>
              <button
                onClick={copyLink}
                className="text-xs px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          )}
          {sig?.auditEvents && sig.auditEvents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Recent activity</div>
              <ul className="text-xs space-y-1">
                {sig.auditEvents.slice(-5).reverse().map((e, i) => (
                  <li key={i} className="text-gray-500">
                    <span className="text-gray-400">
                      {new Date(e.at).toLocaleString()}
                    </span>
                    {' — '}
                    <span className="text-gray-900 dark:text-gray-100">{e.type}</span>
                    {e.ip && <span className="text-gray-400 font-mono"> ({e.ip})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6">
            <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Revoke this signature?
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              The {documentType} will revert to <code>sent</code> and the client can sign again.
              This action is logged in the audit trail.
            </p>
            <textarea
              rows={2}
              placeholder="Reason (optional)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={revoking}
                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                Cancel
              </button>
              <button
                onClick={revoke}
                disabled={revoking}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
              >
                {revoking ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SignaturePanel;
