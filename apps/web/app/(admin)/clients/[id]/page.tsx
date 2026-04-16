'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

interface Client {
  id: string;
  company: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  vatNumber: string | null;
  isActive: boolean;
  contacts: Contact[];
  _count: {
    invoices: number;
    projects: number;
    tickets: number;
  };
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  total: number;
  status: string;
}

interface InvoicesResponse {
  data: Invoice[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center items-center py-24">
      <svg
        className="animate-spin h-7 w-7 text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
      ].join(' ')}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-500',
    sent: 'bg-blue-100 text-blue-700',
    partial: 'bg-orange-100 text-orange-700',
    paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'contacts' | 'invoices';

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Statement download
  const [downloadingStatement, setDownloadingStatement] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Contacts tab
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [addingContact, setAddingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // Invoices tab
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  // ── Fetch client ──────────────────────────────────────────────────────────

  const fetchClient = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clients/${clientId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Client = await res.json();
      setClient(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  // ── Fetch invoices when tab changes ──────────────────────────────────────

  useEffect(() => {
    if (activeTab !== 'invoices') return;
    setInvoicesLoading(true);
    fetch(`${API_BASE}/api/v1/invoices?clientId=${clientId}&limit=10`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((json: InvoicesResponse) => setInvoices(json.data ?? []))
      .catch(() => setInvoices([]))
      .finally(() => setInvoicesLoading(false));
  }, [activeTab, clientId]);

  // ── Download statement ─────────────────────────────────────────────────────

  async function downloadStatement() {
    setDownloadingStatement(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clients/${clientId}/statement/pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to download statement: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${client?.company ?? clientId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent — could show toast in the future
    } finally {
      setDownloadingStatement(false);
    }
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────

  function startEdit() {
    if (!client) return;
    setEditForm({
      company: client.company,
      phone: client.phone ?? '',
      website: client.website ?? '',
      address: client.address ?? '',
      city: client.city ?? '',
      country: client.country ?? '',
      vatNumber: client.vatNumber ?? '',
    });
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clients/${clientId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error(`Save failed with status ${res.status}`);
      const updated: Client = await res.json();
      setClient(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Add contact handler ───────────────────────────────────────────────────

  async function submitContact(e: React.FormEvent) {
    e.preventDefault();
    setAddingContact(true);
    setContactError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clients/${clientId}/contacts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(contactForm),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      const newContact: Contact = await res.json();
      setClient((prev) =>
        prev ? { ...prev, contacts: [...prev.contacts, newContact] } : prev,
      );
      setContactForm({ firstName: '', lastName: '', email: '', phone: '' });
      setShowContactForm(false);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setAddingContact(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />;

  if (error || !client) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Client not found'}</p>
        <button onClick={fetchClient} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'contacts', label: `Contacts (${client.contacts?.length ?? 0})` },
    { key: 'invoices', label: 'Invoices' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/clients" className="hover:text-primary transition-colors">Clients</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{client.company}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{client.company}</h1>
          <ActiveBadge active={client.isActive} />
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={downloadStatement}
              disabled={downloadingStatement}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {downloadingStatement ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                'Download Statement'
              )}
            </button>
            <button
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* ── Inline Edit Form ───────────────────────────────────────────────── */}
      {editing && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Edit Client</h2>
          {saveError && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                { label: 'Company Name', field: 'company' },
                { label: 'Phone', field: 'phone' },
                { label: 'Website', field: 'website' },
                { label: 'Address', field: 'address' },
                { label: 'City', field: 'city' },
                { label: 'Country', field: 'country' },
                { label: 'VAT Number', field: 'vatNumber' },
              ] as { label: string; field: keyof typeof editForm }[]
            ).map(({ label, field }) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input
                  type="text"
                  value={(editForm[field] as string) ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Overview tab ───────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Invoices', count: client._count.invoices },
            { label: 'Projects', count: client._count.projects },
            { label: 'Tickets', count: client._count.tickets },
          ].map(({ label, count }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
              <p className="text-3xl font-bold text-gray-900">{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Contacts tab ───────────────────────────────────────────────────── */}
      {activeTab === 'contacts' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Contacts</h2>
            <button
              onClick={() => { setShowContactForm((v) => !v); setContactError(null); }}
              className="inline-flex items-center gap-1 text-xs font-medium bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
            >
              <span className="text-base leading-none">+</span> Add Contact
            </button>
          </div>

          {showContactForm && (
            <form onSubmit={submitContact} className="px-4 py-4 border-b border-gray-100 bg-gray-50/50">
              {contactError && (
                <p className="text-red-600 text-xs mb-3">{contactError}</p>
              )}
              <div className="grid grid-cols-2 gap-3 mb-3">
                {(['firstName', 'lastName', 'email', 'phone'] as const).map((f) => (
                  <div key={f}>
                    <label className="block text-xs font-medium text-gray-500 mb-1 capitalize">
                      {f.replace(/([A-Z])/g, ' $1')}
                    </label>
                    <input
                      type={f === 'email' ? 'email' : 'text'}
                      value={contactForm[f]}
                      onChange={(e) => setContactForm((p) => ({ ...p, [f]: e.target.value }))}
                      required={f === 'firstName' || f === 'lastName'}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addingContact}
                  className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {addingContact ? 'Adding…' : 'Add Contact'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowContactForm(false)}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody>
                {(!client.contacts || client.contacts.length === 0) ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                      No contacts yet
                    </td>
                  </tr>
                ) : (
                  client.contacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {c.firstName} {c.lastName}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{c.email ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-500">{c.phone ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3">
                        {c.isPrimary && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Primary
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Invoices tab ───────────────────────────────────────────────────── */}
      {activeTab === 'invoices' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Invoices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoicesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: j === 2 ? '40%' : '60%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                      No invoices found for this client
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(inv.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium">
                        {Number(inv.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
