'use client';

/**
 * Wave E3 — Public REST API + Webhooks settings page.
 *
 * Two tabs:
 *   - "API Keys" — manage scoped `crm_*` keys. Plaintext secret shown
 *     once at creation in a copy-to-clipboard modal with a loud warning.
 *   - "Webhooks" — manage outbound webhook subscriptions (HTTPS only),
 *     view delivery history, redeliver individual attempts.
 *
 * This page is distinct from the legacy `/settings/api-keys` and
 * `/settings/webhooks` pages, which power the simpler in-app
 * integrations console. The legacy pages are left intact.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { apiFetch } from '@/lib/api';

const ALLOWED_EVENTS = [
  'client.created',
  'client.updated',
  'lead.created',
  'lead.updated',
  'lead.converted',
  'opportunity.created',
  'opportunity.stage_changed',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'ticket.created',
  'ticket.resolved',
] as const;

// JSON content-type header shared by all mutating calls in this page.
// apiFetch handles the Authorization header + 401 refresh for us.
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

// ─── Types ─────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secretSet: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  succeeded: boolean;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  responseBody: string | null;
}

// ─── Page ──────────────────────────────────────────────────────

export default function PublicApiSettingsPage() {
  const [tab, setTab] = useState<'keys' | 'webhooks'>('keys');

  return (
    <SettingsPageLayout
      title="API & Webhooks"
      description="Public REST API keys and outbound webhooks for your integrations."
    >
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800">
        <button
          onClick={() => setTab('keys')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'keys'
              ? 'border-b-2 border-primary text-primary'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
          }`}
        >
          API Keys
        </button>
        <button
          onClick={() => setTab('webhooks')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'webhooks'
              ? 'border-b-2 border-primary text-primary'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
          }`}
        >
          Webhooks
        </button>
      </div>

      {tab === 'keys' ? <ApiKeysTab /> : <WebhooksTab />}
    </SettingsPageLayout>
  );
}

// ─── API Keys tab ──────────────────────────────────────────────

function ApiKeysTab() {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [scopesText, setScopesText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  // Newly-created key (shown once)
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/settings/api-keys');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const scopes = scopesText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = { name };
      if (scopes.length) body.scopes = scopes;
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
      const res = await apiFetch('/api/v1/settings/api-keys', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCreatedKey(data.key);
      setShowForm(false);
      setName('');
      setScopesText('');
      setExpiresAt('');
      load();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? It cannot be un-revoked.')) return;
    await apiFetch(`/api/v1/settings/api-keys/${id}`, { method: 'DELETE' });
    load();
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback handled by select-all */
    }
  };

  return (
    <>
      {createdKey && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              API Key Created
            </h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-yellow-800 font-medium">
                This is the only time you will see this key. Copy it now and
                store it in a secret manager.
              </p>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 break-all select-all">
                {createdKey}
              </code>
              <button
                onClick={copyCreatedKey}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => {
                setCreatedKey(null);
                setCopied(false);
              }}
              className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 w-full"
            >
              I have saved this key
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <SettingsSection title="Create API Key">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Acme production integration"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Scopes (comma- or space-separated, e.g.{' '}
                <code>clients.read invoices.write</code>)
              </label>
              <input
                value={scopesText}
                onChange={(e) => setScopesText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="clients.read invoices.write"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Expiry (optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Key'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setName('');
                  setScopesText('');
                  setExpiresAt('');
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Keys">
        {!showForm && (
          <div className="flex items-center justify-end mb-4">
            <button
              onClick={() => setShowForm(true)}
              className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
            >
              + New Key
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Key
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Scopes
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Last used
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-gray-400 dark:text-gray-500"
                    >
                      No API keys yet
                    </td>
                  </tr>
                )}
                {rows.map((k) => (
                  <tr
                    key={k.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 dark:hover:bg-gray-800/30"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {k.name}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        crm_{k.keyPrefix}…{k.keyLast4}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {k.scopes.length === 0 ? (
                        <span className="italic text-gray-400">none</span>
                      ) : (
                        k.scopes.join(', ')
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {k.status === 'revoked' ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
                          Revoked
                        </span>
                      ) : k.status === 'expired' ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(k.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </>
  );
}

// ─── Webhooks tab ──────────────────────────────────────────────

function WebhooksTab() {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Newly-created secret (shown once)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Deliveries panel
  const [viewingWebhook, setViewingWebhook] = useState<WebhookRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/settings/webhooks');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEvent = (ev: string) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  const validUrl = useMemo(
    () => /^https:\/\//i.test(url.trim()),
    [url],
  );

  const handleCreate = async () => {
    if (!validUrl || events.length === 0) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/settings/webhooks', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: url.trim(), events }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCreatedSecret(data.secret);
      setShowForm(false);
      setUrl('');
      setEvents([]);
      load();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook? Past deliveries will be removed too.'))
      return;
    await apiFetch(`/api/v1/settings/webhooks/${id}`, { method: 'DELETE' });
    load();
  };

  const handleToggleActive = async (w: WebhookRow) => {
    await apiFetch(`/api/v1/settings/webhooks/${w.id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ active: !w.active }),
    });
    load();
  };

  const handleRotateSecret = async (id: string) => {
    if (
      !confirm(
        'Rotate the HMAC secret? The previous secret will stop verifying signatures immediately.',
      )
    )
      return;
    const res = await apiFetch(
      `/api/v1/settings/webhooks/${id}/rotate-secret`,
      { method: 'POST' },
    );
    if (!res.ok) return;
    const data = await res.json();
    setCreatedSecret(data.secret);
  };

  const copyCreatedSecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback handled by select-all */
    }
  };

  return (
    <>
      {createdSecret && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Webhook Secret
            </h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-yellow-800 font-medium">
                Copy this secret now — it will not be shown again. Use it to
                verify the <code>X-Crm-Signature</code> header on every
                inbound delivery.
              </p>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 break-all select-all">
                {createdSecret}
              </code>
              <button
                onClick={copyCreatedSecret}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => {
                setCreatedSecret(null);
                setCopied(false);
              }}
              className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 w-full"
            >
              I have saved this secret
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <SettingsSection title="Create Webhook">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Endpoint URL (HTTPS required)
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://example.com/hooks/crm"
              />
              {url && !validUrl && (
                <p className="text-xs text-red-600 mt-1">URL must start with https://</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                Events
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ALLOWED_EVENTS.map((ev) => (
                  <label
                    key={ev}
                    className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    <code className="font-mono">{ev}</code>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={saving || !validUrl || events.length === 0}
                className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Webhook'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setUrl('');
                  setEvents([]);
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Webhooks">
        {!showForm && (
          <div className="flex items-center justify-end mb-4">
            <button
              onClick={() => setShowForm(true)}
              className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
            >
              + New Webhook
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    URL
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Events
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Active
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-gray-400 dark:text-gray-500"
                    >
                      No webhooks yet
                    </td>
                  </tr>
                )}
                {rows.map((w) => (
                  <tr
                    key={w.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 dark:hover:bg-gray-800/30"
                  >
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                        {w.url}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {(w.events ?? []).join(', ') || (
                        <span className="italic text-gray-400">none</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleActive(w)}
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          w.active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {w.active ? 'Active' : 'Paused'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-3">
                      <button
                        onClick={() => setViewingWebhook(w)}
                        className="text-xs text-primary hover:underline"
                      >
                        Deliveries
                      </button>
                      <button
                        onClick={() => handleRotateSecret(w.id)}
                        className="text-xs text-yellow-700 hover:underline"
                      >
                        Rotate
                      </button>
                      <button
                        onClick={() => handleDelete(w.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {viewingWebhook && (
        <DeliveriesModal
          webhook={viewingWebhook}
          onClose={() => setViewingWebhook(null)}
        />
      )}
    </>
  );
}

// ─── Deliveries modal ──────────────────────────────────────────

function DeliveriesModal({
  webhook,
  onClose,
}: {
  webhook: WebhookRow;
  onClose: () => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/settings/webhooks/${webhook.id}/deliveries?limit=50`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setDeliveries(Array.isArray(data.data) ? data.data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [webhook.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRedeliver = async (id: string) => {
    // Updated path: `/:webhookId/deliveries/:id/redeliver` (was
    // `/deliveries/:id/redeliver`). The new route lets the API validate
    // that the delivery belongs to the webhook the caller named.
    await apiFetch(
      `/api/v1/settings/webhooks/${webhook.id}/deliveries/${id}/redeliver`,
      { method: 'POST' },
    );
    // Optimistic — the worker will update the row.
    setTimeout(load, 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Recent deliveries
            </h3>
            <code className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
              {webhook.url}
            </code>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : deliveries.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
              No deliveries yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-2 py-2 font-medium text-gray-600 dark:text-gray-400">
                    Event
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600 dark:text-gray-400">
                    Status
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600 dark:text-gray-400">
                    Attempts
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-600 dark:text-gray-400">
                    Last attempt
                  </th>
                  <th className="text-right px-2 py-2 font-medium text-gray-600 dark:text-gray-400">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-gray-50 dark:border-gray-800"
                  >
                    <td className="px-2 py-2 font-mono text-xs">{d.event}</td>
                    <td className="px-2 py-2">
                      {d.succeeded ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                          {d.statusCode ?? 'OK'}
                        </span>
                      ) : d.statusCode ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
                          {d.statusCode}
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-600">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">{d.attemptCount}</td>
                    <td className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {d.lastAttemptAt
                        ? new Date(d.lastAttemptAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => handleRedeliver(d.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Redeliver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
