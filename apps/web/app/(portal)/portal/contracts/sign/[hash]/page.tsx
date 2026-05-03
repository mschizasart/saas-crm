'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { SignaturePad } from '@/components/ui/signature-pad';

interface Contract {
  id: string;
  title?: string;
  subject?: string;
  content: string;
  status?: string;
  signedAt: string | null;
  signatureRequired?: boolean;
  organization?: { name: string } | null;
  client?: { id: string; company?: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function ContractSignPage() {
  const params = useParams();
  const hash = params.hash as string;

  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedByName, setSignedByName] = useState('');
  const [signedByEmail, setSignedByEmail] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [signatureId, setSignatureId] = useState<string | null>(null);

  const fetchContract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/sign/${hash}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Contract = await res.json();
      setContract(data);
      if (data.client?.company) setSignedByName(data.client.company);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contract');
    } finally {
      setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  // Track view audit event.
  useEffect(() => {
    if (!contract) return;
    fetch(`${API_BASE}/api/v1/contracts/${contract.id}/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!signaturePng) {
      setSubmitError('Please draw your signature');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/public/contracts/${hash}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signedByName,
          email: signedByEmail,
          signaturePng,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || `Failed with status ${res.status}`);
      setSignatureId(json.signatureId ?? null);
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to sign');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        Loading contract…
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Contract Not Available</h1>
          <p className="text-sm text-red-600">{error ?? 'Contract not found or already signed.'}</p>
        </div>
      </div>
    );
  }

  if (success || contract.signedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8">
          <div className="w-14 h-14 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Signed — thanks!</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Your signature has been recorded.
          </p>
          {signatureId && (
            <a
              href={`${API_BASE}/api/v1/contracts/${contract.id}/signed-pdf`}
              className="inline-block px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download signed PDF
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {contract.organization?.name && (
          <p className="text-center text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{contract.organization.name}</p>
        )}
        <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">
          {contract.title ?? contract.subject}
        </h1>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 mb-6">
          <div
            className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300"
            dangerouslySetInnerHTML={{ __html: contract.content }}
          />
        </div>

        <form onSubmit={submit} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sign Contract</h2>
          {submitError && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={signedByName}
                onChange={(e) => setSignedByName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email *</label>
              <input
                type="email"
                required
                value={signedByEmail}
                onChange={(e) => setSignedByEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Signature *</label>
            <SignaturePad width={600} height={180} onSignature={setSignaturePng} />
          </div>

          <button
            type="submit"
            disabled={submitting || !signaturePng}
            className="w-full px-4 py-3 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Signing…' : 'Sign Contract'}
          </button>
        </form>
      </div>
    </div>
  );
}
