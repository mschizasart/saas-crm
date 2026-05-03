'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';
import { SentEmailsPanel } from '@/components/sent-emails-panel';
import { SignaturePanel } from '@/components/ui/signature-panel';

interface Proposal {
  id: string;
  subject: string;
  content: string;
  total: number;
  currency: string;
  status: string;
  allowComments: boolean;
  signatureRequired?: boolean;
  signedAt?: string | null;
  createdAt: string;
  publicHash?: string;
  hash?: string;
  client?: { id: string; company?: string; company_name?: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

export default function ProposalDetailPage() {
  const { id } = useParams() as { id: string };
  const [p, setP] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentEmailsKey, setSentEmailsKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setP(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  async function run(path: string) {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/${id}/${path}`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      await fetchData();
      if (path === 'send') setSentEmailsKey((n) => n + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSignatureRequired() {
    if (!p) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ signatureRequired: !p.signatureRequired }),
      });
      if (!res.ok) throw new Error('Failed');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 dark:bg-gray-800 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  const publicHash = p.publicHash ?? p.hash;

  return (
    <DetailPageLayout
      title={p.subject}
      subtitle={`${p.client?.company ?? p.client?.company_name ?? '—'} · Value: ${p.total} ${p.currency}`}
      breadcrumbs={[
        { label: 'Proposals', href: '/proposals' },
        { label: p.subject },
      ]}
      badge={
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{p.status}</span>
      }
      actions={[
        { label: 'Send', onClick: () => run('send'), disabled: busy, variant: 'secondary' },
        { label: 'Mark Accepted', onClick: () => run('accept'), disabled: busy, variant: 'secondary' },
        { label: 'Mark Declined', onClick: () => run('decline'), disabled: busy, variant: 'secondary' },
      ]}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: p.content }} />
      </div>

      <SentEmailsPanel
        routedTo="proposal"
        routedToId={p.id}
        refreshKey={sentEmailsKey}
      />

      {/* Require-signature toggle */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Require e-signature</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            When on, the client must draw a signature on the portal page (instead of click-to-accept).
          </div>
        </div>
        <button
          onClick={toggleSignatureRequired}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            p.signatureRequired ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
          }`}
          aria-pressed={!!p.signatureRequired}
          aria-label="Toggle e-signature requirement"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              p.signatureRequired ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <SignaturePanel
        documentType="proposal"
        documentId={p.id}
        publicHash={publicHash}
        publicLinkBase="/portal/proposals/view"
        onAfterRevoke={fetchData}
      />

      {publicHash && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm flex items-center justify-between gap-2">
          <span className="text-gray-600 dark:text-gray-400 truncate">Public link: /proposal/{publicHash}</span>
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/proposal/${publicHash}`)}
            className="text-xs px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Copy
          </button>
        </div>
      )}
    </DetailPageLayout>
  );
}
