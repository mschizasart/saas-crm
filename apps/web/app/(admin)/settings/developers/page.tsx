'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { Badge } from '@/components/ui/badge';
import { apiFetch, API_BASE } from '@/lib/api';

interface ScopeItem {
  value: string;
  label: string;
}

type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';

interface EndpointRef {
  method: HttpMethod;
  path: string;
  description: string;
  scope: string;
}

// Static documented endpoint reference. The catalog of scopes/events is
// fetched live; this list mirrors the public Integration API surface that
// Zapier/Make consume so developers can see method + required scope at a
// glance without digging through Swagger.
const ENDPOINTS: EndpointRef[] = [
  { method: 'GET', path: '/integration/me', description: 'Auth test — returns the org + principal + granted scopes', scope: 'any' },
  { method: 'GET', path: '/integration/leads', description: 'List leads', scope: 'leads.read' },
  { method: 'POST', path: '/integration/leads', description: 'Create a lead', scope: 'leads.write' },
  { method: 'GET', path: '/integration/clients', description: 'List clients', scope: 'clients.read' },
  { method: 'POST', path: '/integration/clients', description: 'Create a client', scope: 'clients.write' },
  { method: 'GET', path: '/integration/invoices', description: 'List invoices', scope: 'invoices.read' },
  { method: 'GET', path: '/integration/opportunities', description: 'List opportunities', scope: 'opportunities.read' },
  { method: 'POST', path: '/integration/webhooks', description: 'Subscribe to a trigger event', scope: 'webhooks.subscribe' },
  { method: 'DELETE', path: '/integration/webhooks/:id', description: 'Unsubscribe a webhook', scope: 'webhooks.subscribe' },
  { method: 'GET', path: '/integration/events/:event/sample', description: 'Fetch a sample payload for an event', scope: 'any' },
];

const METHOD_VARIANT: Record<HttpMethod, 'success' | 'info' | 'error' | 'warning'> = {
  GET: 'info',
  POST: 'success',
  DELETE: 'error',
  PATCH: 'warning',
  PUT: 'warning',
};

export default function DevelopersPage() {
  const [scopes, setScopes] = useState<ScopeItem[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [scopesRes, eventsRes] = await Promise.all([
          apiFetch('/api/v1/integration/scopes'),
          apiFetch('/api/v1/integration/events'),
        ]);
        if (cancelled) return;
        if (scopesRes.ok) {
          const data = await scopesRes.json();
          setScopes(Array.isArray(data?.scopes) ? data.scopes : []);
        }
        if (eventsRes.ok) {
          const data = await eventsRes.json();
          setEvents(Array.isArray(data?.events) ? data.events : []);
        }
        if (!scopesRes.ok && !eventsRes.ok) setError(true);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const baseUrl = `${API_BASE}/api/v1`;
  const hasApiUrl = Boolean(process.env.NEXT_PUBLIC_API_URL);

  return (
    <SettingsPageLayout
      title="Developers / API"
      description="Build integrations on the public Integration API — connect Zapier, Make, or your own services."
    >
      {/* Overview */}
      <SettingsSection title="Overview" description="A scoped REST API for reading and writing CRM data and subscribing to events.">
        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <p>
            The public Integration API lets external tools (Zapier, Make, custom backends) read and write
            your CRM data and subscribe to trigger events. Access is granted through scoped API keys.
          </p>
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Base URL</p>
            <code className="block px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 break-all select-all">
              {baseUrl}
            </code>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Authentication</p>
            <p className="mb-2">
              Pass an API key (prefixed <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">crm_</code>) as a Bearer token on every request:
            </p>
            <code className="block px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 break-all select-all">
              Authorization: Bearer crm_xxxxxxxxxxxxxxxx
            </code>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/settings/api-keys" className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
              Create an API key
            </Link>
            <Link href="/settings/webhooks" className="border border-gray-200 dark:border-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              Manage webhooks
            </Link>
            {hasApiUrl && (
              <a
                href={`${API_BASE}/api/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-gray-200 dark:border-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Open API reference (Swagger)
              </a>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Scopes */}
      <SettingsSection title="Scopes" description="Grant the minimum scopes each key needs. Use * for full access.">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading scopes…</p>
        ) : scopes.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {error ? 'Could not load the scope catalog.' : 'No scopes available.'}
          </p>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Scope</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Description</th>
                </tr>
              </thead>
              <tbody>
                {scopes.map((s) => (
                  <tr key={s.value} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                    <td className="px-4 py-3">
                      <Badge variant={s.value === '*' ? 'warning' : 'info'}>
                        <code className="font-mono">{s.value}</code>
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{s.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {/* Trigger events */}
      <SettingsSection title="Trigger events" description="Events your Zapier triggers and webhooks can subscribe to.">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading events…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {error ? 'Could not load the event catalog.' : 'No events available.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {events.map((ev) => (
              <Badge key={ev} variant="default">
                <code className="font-mono">{ev}</code>
              </Badge>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Endpoint reference */}
      <SettingsSection title="Endpoint reference" description="Key endpoints and the scope each one requires.">
        <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Method</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Path</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Description</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Scope</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method} ${e.path}`} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="px-4 py-3">
                    <Badge variant={METHOD_VARIANT[e.method]}>{e.method}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-gray-800 dark:text-gray-200">{e.path}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{e.description}</td>
                  <td className="px-4 py-3">
                    {e.scope === 'any' ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">any key</span>
                    ) : (
                      <code className="text-xs font-mono text-gray-600 dark:text-gray-400">{e.scope}</code>
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
