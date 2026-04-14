'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Contract {
  id: string;
  subject: string;
  content: string;
  type: string;
  status: string;
  value: number;
  startDate: string;
  endDate: string;
  publicHash?: string;
  client?: { id: string; company?: string; company_name?: string } | null;
  signedAt?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

export default function ContractDetailPage() {
  const { id } = useParams() as { id: string };
  const [c, setC] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setC(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  async function sendForSigning() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/${id}/send`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!c?.publicHash) return;
    const url = `${window.location.origin}/contract/${c.publicHash}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !c) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4"><Link href="/contracts" className="text-sm text-gray-500 hover:text-primary">← Back to contracts</Link></div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{c.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {c.client?.company ?? c.client?.company_name ?? '—'} · {c.type} · Value: {c.value}
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{c.status}</span>
      </div>

      {c.status === 'draft' && (
        <div className="mb-6">
          <button onClick={sendForSigning} disabled={busy} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send For Signing'}
          </button>
        </div>
      )}

      {c.status === 'pending_signature' && c.publicHash && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 mb-2">Awaiting signature. Share this link with the client:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white border border-amber-200 rounded text-xs break-all">
              {typeof window !== 'undefined' ? `${window.location.origin}/contract/${c.publicHash}` : `/contract/${c.publicHash}`}
            </code>
            <button onClick={copyLink} className="px-3 py-2 bg-white border border-amber-200 rounded text-xs hover:bg-amber-50">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: c.content }} />
      </div>

      <div className="mt-6 text-sm text-gray-500">
        Period: {c.startDate ? new Date(c.startDate).toLocaleDateString() : '—'} → {c.endDate ? new Date(c.endDate).toLocaleDateString() : '—'}
      </div>
    </div>
  );
}
