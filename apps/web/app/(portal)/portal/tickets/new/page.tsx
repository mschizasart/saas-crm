'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalNewTicketPage() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/portal/tickets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message, priority }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const created = await res.json();
      const id = created.id ?? created.data?.id;
      router.push(id ? `/tickets/${id}` : '/tickets');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4"><Link href="/portal/tickets" className="text-sm text-gray-500 hover:text-primary">← Back</Link></div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Submit a Ticket</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Subject <span className="text-red-500">*</span></label>
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Describe your issue <span className="text-red-500">*</span></label>
          <textarea required rows={8} value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
          <Link href="/portal/tickets" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';
