'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

const EVENT_OPTIONS = [
  'invoice.created', 'invoice.overdue', 'invoice.sent',
  'lead.status_changed', 'lead.assigned',
  'ticket.created', 'ticket.status_changed', 'ticket.replied',
  'task.created', 'task.completed',
  'project.created', 'client.created',
  'estimate.sent', 'contract.signed', 'payment.received',
];

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; msg: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/webhooks`, { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setWebhooks(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName(''); setUrl(''); setEvents([]); setActive(true);
    setEditing(null); setShowForm(false);
  };

  const openEdit = (wh: Webhook) => {
    setEditing(wh);
    setName(wh.name);
    setUrl(wh.url);
    setEvents(wh.events);
    setActive(wh.active);
    setShowForm(true);
  };

  const toggleEvent = (ev: string) => {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  };

  const handleSave = async () => {
    setSaving(true);
    const body = { name, url, events, active };
    try {
      if (editing) {
        await fetch(`${API_BASE}/api/v1/webhooks/${editing.id}`, {
          method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
        });
      } else {
        await fetch(`${API_BASE}/api/v1/webhooks`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
        });
      }
      resetForm(); load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    await fetch(`${API_BASE}/api/v1/webhooks/${id}`, { method: 'DELETE', headers: authHeaders() });
    load();
  };

  const handleTest = async (id: string) => {
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/webhooks/${id}/test`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json();
      setTestResult({ id, msg: data.success ? `OK (${data.status})` : `Failed: ${data.error ?? 'Unknown error'}` });
    } catch (e) {
      setTestResult({ id, msg: `Error: ${e}` });
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const toggleActive = async (wh: Webhook) => {
    await fetch(`${API_BASE}/api/v1/webhooks/${wh.id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ active: !wh.active }),
    });
    load();
  };

  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-1">Send real-time event data to external services</p>
        </div>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true); }} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
            + New Webhook
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6 max-w-3xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit Webhook' : 'New Webhook'}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. Slack notifications" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="https://example.com/webhook" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Events</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EVENT_OPTIONS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} className="rounded border-gray-300 text-primary focus:ring-primary/30" />
                    {ev.replace('.', ' / ')}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300 text-primary" />
              Active
            </label>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleSave} disabled={saving || !name.trim() || !url.trim() || events.length === 0} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button onClick={resetForm} className="text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Webhooks table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">URL</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Events</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Active</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Last Triggered</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No webhooks configured</td></tr>
            )}
            {webhooks.map((wh) => (
              <tr key={wh.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">{wh.name}</td>
                <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]" title={wh.url}>{wh.url}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {wh.events.slice(0, 3).map((ev) => (
                      <span key={ev} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">{ev}</span>
                    ))}
                    {wh.events.length > 3 && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">+{wh.events.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(wh)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${wh.active ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${wh.active ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {wh.lastTriggeredAt ? new Date(wh.lastTriggeredAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => handleTest(wh.id)} className="text-xs text-green-600 hover:underline">Test</button>
                  <button onClick={() => openEdit(wh)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => handleDelete(wh.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  {testResult?.id === wh.id && (
                    <span className="text-xs text-gray-500 ml-2">{testResult.msg}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
