'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

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
  const router = useRouter();
  const [c, setC] = useState<Contract | null>(null);
  const [renderedContent, setRenderedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [contractRes, renderedRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/contracts/${id}`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/v1/contracts/${id}/rendered`, { headers: authHeaders() }),
      ]);
      if (!contractRes.ok) throw new Error(`Failed (${contractRes.status})`);
      const json = await contractRes.json();
      setC(json.data ?? json);
      if (renderedRes.ok) {
        const renderedJson = await renderedRes.json();
        setRenderedContent(renderedJson.content ?? renderedJson.renderedContent ?? null);
      }
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

  async function renewContract() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/${id}/renew`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to renew');
      const data = await res.json();
      const newId = data.id ?? data.data?.id;
      if (newId) router.push(`/contracts/${newId}`);
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

  function getDaysUntilExpiry(): { days: number; label: string; isExpired: boolean; isWarning: boolean } | null {
    if (!c?.endDate) return null;
    const end = new Date(c.endDate);
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { days: Math.abs(diffDays), label: `Expired ${Math.abs(diffDays)} days ago`, isExpired: true, isWarning: true };
    if (diffDays <= 30) return { days: diffDays, label: `Expires in ${diffDays} days`, isExpired: false, isWarning: true };
    return { days: diffDays, label: `Expires in ${diffDays} days`, isExpired: false, isWarning: false };
  }

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !c) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  const expiry = getDaysUntilExpiry();

  return (
    <div className="max-w-4xl">
      <div className="mb-4"><Link href="/contracts" className="text-sm text-gray-500 hover:text-primary">&larr; Back to contracts</Link></div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{c.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {c.client?.company ?? c.client?.company_name ?? '—'} &middot; {c.type} &middot; Value: {c.value}
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{c.status}</span>
      </div>

      {c.status === 'draft' && (
        <div className="mb-6">
          <button onClick={sendForSigning} disabled={busy} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {busy ? 'Sending...' : 'Send For Signing'}
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

      {/* Renewal section */}
      {expiry && (
        <div className={`mb-6 p-4 rounded-lg border ${expiry.isExpired ? 'bg-red-50 border-red-200' : expiry.isWarning ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Renewal Status</h3>
              <p className={`text-sm mt-1 ${expiry.isExpired ? 'text-red-700' : expiry.isWarning ? 'text-amber-700' : 'text-green-700'}`}>
                {expiry.label}
                {expiry.isWarning && (
                  <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${expiry.isExpired ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                    {expiry.isExpired ? 'Expired' : 'Expiring Soon'}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={renewContract}
              disabled={busy}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Renewing...' : 'Renew Contract'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: renderedContent ?? c.content }} />
      </div>

      <div className="mt-6 text-sm text-gray-500">
        Period: {c.startDate ? new Date(c.startDate).toLocaleDateString() : '—'} &rarr; {c.endDate ? new Date(c.endDate).toLocaleDateString() : '—'}
      </div>
    </div>
  );
}
