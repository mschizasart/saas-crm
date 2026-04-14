'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Proposal {
  id: string;
  subject: string;
  content: string;
  totalValue: number;
  currency: string;
  status: string;
  allowComments: boolean;
  createdAt: string;
  publicHash?: string;
  client?: { id: string; company?: string; company_name?: string } | null;
  assignedTo?: { id: string; name?: string } | null;
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

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4"><Link href="/proposals" className="text-sm text-gray-500 hover:text-primary">← Back to proposals</Link></div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{p.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {p.client?.company ?? p.client?.company_name ?? '—'} · Value: {p.totalValue} {p.currency}
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{p.status}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button disabled={busy} onClick={() => run('send')} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">Send</button>
        <button disabled={busy} onClick={() => run('accept')} className="px-3 py-1.5 text-sm border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50">Mark Accepted</button>
        <button disabled={busy} onClick={() => run('decline')} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50">Mark Declined</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: p.content }} />
      </div>

      {p.publicHash && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm flex items-center justify-between gap-2">
          <span className="text-gray-600 truncate">Public link: /proposal/{p.publicHash}</span>
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/proposal/${p.publicHash}`)}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
