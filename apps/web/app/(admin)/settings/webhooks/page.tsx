'use client';

import { useEffect, useState } from 'react';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

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

  const quickSetup = (type: 'slack' | 'discord') => {
    resetForm();
    if (type === 'slack') {
      setName('Slack Notifications');
      setUrl('https://hooks.slack.com/services/YOUR/WEBHOOK/URL');
    } else {
      setName('Discord Notifications');
      setUrl('https://discord.com/api/webhooks/YOUR/WEBHOOK/URL');
    }
    setEvents([
      'invoice.created',
      'lead.status_changed',
      'ticket.created',
      'payment.received',
      'client.created',
    ]);
    setShowForm(true);
  };

  const getWebhookLabel = (whUrl: string) => {
    if (whUrl.includes('hooks.slack.com')) return 'Slack';
    if (whUrl.includes('discord.com/api/webhooks')) return 'Discord';
    return null;
  };

  if (loading) return <div className="p-6 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>;

  return (
    <SettingsPageLayout title="Webhooks" description="Send real-time event data to external services">
      {/* Quick Setup */}
      {!showForm && (
        <SettingsSection title="Quick Setup" description="Connect your favorite messaging platform to receive CRM notifications in real time.">
          <div className="flex gap-3">
            <button
              onClick={() => quickSetup('slack')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.271 0a2.527 2.527 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.164 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.164 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.164 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zm0-1.271a2.527 2.527 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.314A2.528 2.528 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.521h-6.314z" fill="#E01E5A"/></svg>
              Connect Slack
            </button>
            <button
              onClick={() => quickSetup('discord')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
              Connect Discord
            </button>
          </div>
        </SettingsSection>
      )}

      {showForm && (
        <SettingsSection title={editing ? 'Edit Webhook' : 'New Webhook'}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. Slack notifications" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="https://example.com/webhook" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Events</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EVENT_OPTIONS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} className="rounded border-gray-300 text-primary focus:ring-primary/30" />
                    {ev.replace('.', ' / ')}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300 text-primary" />
              Active
            </label>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleSave} disabled={saving || !name.trim() || !url.trim() || events.length === 0} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button onClick={resetForm} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Configured webhooks">
        {!showForm && (
          <div className="flex items-center justify-end mb-4">
            <button onClick={() => { resetForm(); setShowForm(true); }} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
              + New Webhook
            </button>
          </div>
        )}
        <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">URL</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Events</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Active</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last Triggered</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No webhooks configured</td></tr>
            )}
            {webhooks.map((wh) => (
              <tr key={wh.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                  <span className="flex items-center gap-1.5">
                    {wh.name}
                    {getWebhookLabel(wh.url) && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${getWebhookLabel(wh.url) === 'Slack' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
                        {getWebhookLabel(wh.url)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={wh.url}>{wh.url}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {wh.events.slice(0, 3).map((ev) => (
                      <span key={ev} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{ev}</span>
                    ))}
                    {wh.events.length > 3 && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">+{wh.events.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(wh)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${wh.active ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${wh.active ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                  {wh.lastTriggeredAt ? new Date(wh.lastTriggeredAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => handleTest(wh.id)} className="text-xs text-green-600 hover:underline">Test</button>
                  <button onClick={() => openEdit(wh)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => handleDelete(wh.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  {testResult?.id === wh.id && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{testResult.msg}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </SettingsSection>
    </SettingsPageLayout>
  );
}
