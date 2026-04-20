'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

interface Proposal {
  id: string;
  subject: string;
  content: string;
  total: number;
  currency: string;
  status: string;
  allowComments: boolean;
  createdAt: string;
  publicHash?: string;
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
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 dark:bg-gray-800 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

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

      {p.publicHash && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm flex items-center justify-between gap-2">
          <span className="text-gray-600 dark:text-gray-400 truncate">Public link: /proposal/{p.publicHash}</span>
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/proposal/${p.publicHash}`)}
            className="text-xs px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Copy
          </button>
        </div>
      )}
    </DetailPageLayout>
  );
}
