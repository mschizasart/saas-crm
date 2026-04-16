'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface LeadNote {
  id: string;
  content: string;
  createdAt: string;
  author?: { name?: string } | null;
}

interface LeadActivity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

interface LeadEmailRecord {
  id: string;
  direction: string;
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  sentAt: string;
}

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  status: string;
  source: string | null;
  budget: number | null;
  description: string | null;
  createdAt: string;
  notes?: LeadNote[];
  activities?: LeadActivity[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

type Tab = 'overview' | 'notes' | 'emails' | 'activity';

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Lead>>({});
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [converting, setConverting] = useState(false);

  // Emails state
  const [emails, setEmails] = useState<LeadEmailRecord[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
  const [logForm, setLogForm] = useState({ direction: 'outbound', subject: '', body: '', fromEmail: '', toEmail: '' });
  const [sendingEmail, setSendingEmail] = useState(false);

  // AI Draft
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiTone, setAiTone] = useState<'professional' | 'friendly' | 'formal'>('professional');

  const fetchLead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      const data: Lead = json.data ?? json;
      setLead(data);
      setDraft(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchLead();
  }, [id, fetchLead]);

  async function saveEdit() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      await fetchLead();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function convertToClient() {
    if (!confirm('Convert this lead to a client?')) return;
    setConverting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}/convert`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Convert failed');
      const json = await res.json();
      const clientId = json.clientId ?? json.id ?? json.data?.id;
      if (clientId) router.push(`/clients/${clientId}`);
      else router.push('/clients');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Convert failed');
    } finally {
      setConverting(false);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}/notes`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content: newNote }),
      });
      if (!res.ok) throw new Error('Note failed');
      setNewNote('');
      await fetchLead();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Note failed');
    } finally {
      setSavingNote(false);
    }
  }

  const fetchEmails = useCallback(async () => {
    setEmailsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}/emails`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setEmails(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch { /* ignore */ } finally { setEmailsLoading(false); }
  }, [id]);

  useEffect(() => {
    if (tab === 'emails' && id) fetchEmails();
  }, [tab, id, fetchEmails]);

  async function handleSendEmail(e: FormEvent) {
    e.preventDefault();
    if (!emailForm.to || !emailForm.subject) return;
    setSendingEmail(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}/emails`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(emailForm),
      });
      if (!res.ok) throw new Error('Send failed');
      setShowSendModal(false);
      setEmailForm({ to: '', subject: '', body: '' });
      await fetchEmails();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Send failed');
    } finally { setSendingEmail(false); }
  }

  async function handleLogEmail(e: FormEvent) {
    e.preventDefault();
    setSendingEmail(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}/emails/log`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(logForm),
      });
      if (!res.ok) throw new Error('Log failed');
      setShowLogModal(false);
      setLogForm({ direction: 'outbound', subject: '', body: '', fromEmail: '', toEmail: '' });
      await fetchEmails();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Log failed');
    } finally { setSendingEmail(false); }
  }

  async function handleAiDraftEmail() {
    if (!lead) return;
    setAiDrafting(true);
    try {
      const previousMessages = emails.slice(-5).map((em) => ({
        from: em.direction === 'inbound' ? (em.fromEmail ?? 'Client') : 'Staff',
        message: em.body ?? '',
        date: em.sentAt,
      }));
      const res = await fetch(`${API_BASE}/api/v1/ai/draft-reply`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          subject: emailForm.subject || `Email to ${lead.name}`,
          previousMessages,
          tone: aiTone,
        }),
      });
      if (!res.ok) throw new Error('AI draft failed');
      const data = await res.json();
      if (data.draft) {
        setEmailForm((prev) => ({ ...prev, body: prev.body ? prev.body + '\n' + data.draft : data.draft }));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setAiDrafting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl animate-pulse">
        <div className="h-4 w-32 bg-gray-100 rounded mb-4" />
        <div className="h-7 w-64 bg-gray-100 rounded mb-6" />
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="max-w-4xl">
        <Link href="/leads" className="text-sm text-gray-500 hover:text-primary">← Back</Link>
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-100 rounded text-sm text-red-600">
          {error ?? 'Lead not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <Link href="/leads" className="text-sm text-gray-500 hover:text-primary">← Back to leads</Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{lead.company} {lead.position && `· ${lead.position}`}</p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
              <button onClick={convertToClient} disabled={converting} className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {converting ? 'Converting…' : 'Convert to Client'}
              </button>
            </>
          )}
          {editing && (
            <>
              <button onClick={() => { setEditing(false); setDraft(lead); }} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={saveEdit} className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90">Save</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['overview', 'notes', 'emails', 'activity'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Detail label="Email">
              {editing ? (
                <input className={inputClass} value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              ) : (
                lead.email ?? '—'
              )}
            </Detail>
            <Detail label="Phone">
              {editing ? (
                <input className={inputClass} value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              ) : (
                lead.phone ?? '—'
              )}
            </Detail>
            <Detail label="Company">
              {editing ? (
                <input className={inputClass} value={draft.company ?? ''} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
              ) : (
                lead.company ?? '—'
              )}
            </Detail>
            <Detail label="Position">
              {editing ? (
                <input className={inputClass} value={draft.position ?? ''} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
              ) : (
                lead.position ?? '—'
              )}
            </Detail>
            <Detail label="Website">
              {editing ? (
                <input className={inputClass} value={draft.website ?? ''} onChange={(e) => setDraft({ ...draft, website: e.target.value })} />
              ) : (
                lead.website ?? '—'
              )}
            </Detail>
            <Detail label="Status">
              {editing ? (
                <input className={inputClass} value={draft.status ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value })} />
              ) : (
                <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{lead.status}</span>
              )}
            </Detail>
            <Detail label="Source">{lead.source ?? '—'}</Detail>
            <Detail label="Budget">{lead.budget != null ? lead.budget : '—'}</Detail>
            <Detail label="Address" wide>
              {[lead.address, lead.city, lead.country].filter(Boolean).join(', ') || '—'}
            </Detail>
            <Detail label="Description" wide>
              {editing ? (
                <textarea rows={4} className={inputClass} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              ) : (
                lead.description ?? '—'
              )}
            </Detail>
          </dl>
        </div>
      )}

      {tab === 'notes' && (
        <div className="space-y-4">
          <form onSubmit={addNote} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={3}
              placeholder="Add a note…"
              className={inputClass}
            />
            <div className="flex justify-end mt-2">
              <button
                type="submit"
                disabled={savingNote || !newNote.trim()}
                className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {savingNote ? 'Adding…' : 'Add Note'}
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {(lead.notes ?? []).length === 0 && (
              <div className="text-sm text-gray-400 text-center py-8">No notes yet</div>
            )}
            {(lead.notes ?? []).map((note) => (
              <div key={note.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-gray-400 mt-2">
                  {note.author?.name ?? 'Anonymous'} · {new Date(note.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'emails' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => { setEmailForm({ to: lead.email ?? '', subject: '', body: '' }); setShowSendModal(true); }} className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90">Send Email</button>
            <button onClick={() => setShowLogModal(true)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Log Email</button>
          </div>

          {emailsLoading ? (
            <div className="text-sm text-gray-400 text-center py-8">Loading...</div>
          ) : emails.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8 bg-white rounded-xl border border-gray-100">No emails yet</div>
          ) : (
            <div className="space-y-2">
              {emails.map((em) => (
                <div key={em.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${em.direction === 'inbound' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {em.direction === 'inbound' ? 'Received' : 'Sent'}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{em.subject ?? '(no subject)'}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {em.direction === 'inbound' ? `From: ${em.fromEmail ?? '—'}` : `To: ${em.toEmail ?? '—'}`}
                    {' '}· {new Date(em.sentAt).toLocaleString()}
                  </div>
                  {em.body && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap line-clamp-3">{em.body}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Send Email Modal */}
          {showSendModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSendModal(false)}>
              <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Send Email</h3>
                <form onSubmit={handleSendEmail} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                    <input type="email" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} className={inputClass} required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                    <input value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} className={inputClass} required />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-gray-600">Body</label>
                      <div className="flex items-center gap-1">
                        <select
                          value={aiTone}
                          onChange={(e) => setAiTone(e.target.value as 'professional' | 'friendly' | 'formal')}
                          className="px-2 py-1 text-[11px] border border-gray-200 rounded-md bg-white text-gray-600"
                        >
                          <option value="professional">Professional</option>
                          <option value="friendly">Friendly</option>
                          <option value="formal">Formal</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleAiDraftEmail}
                          disabled={aiDrafting}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-md hover:bg-violet-100 disabled:opacity-50"
                        >
                          {aiDrafting ? (
                            <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                            </svg>
                          )}
                          {aiDrafting ? 'Drafting...' : 'Draft with AI'}
                        </button>
                      </div>
                    </div>
                    <textarea rows={5} value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} className={inputClass} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setShowSendModal(false)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                    <button type="submit" disabled={sendingEmail} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">{sendingEmail ? 'Sending...' : 'Send'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Log Email Modal */}
          {showLogModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLogModal(false)}>
              <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Log Email</h3>
                <form onSubmit={handleLogEmail} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
                    <select value={logForm.direction} onChange={(e) => setLogForm({ ...logForm, direction: e.target.value })} className={inputClass}>
                      <option value="outbound">Sent (Outbound)</option>
                      <option value="inbound">Received (Inbound)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                    <input value={logForm.fromEmail} onChange={(e) => setLogForm({ ...logForm, fromEmail: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                    <input value={logForm.toEmail} onChange={(e) => setLogForm({ ...logForm, toEmail: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                    <input value={logForm.subject} onChange={(e) => setLogForm({ ...logForm, subject: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                    <textarea rows={4} value={logForm.body} onChange={(e) => setLogForm({ ...logForm, body: e.target.value })} className={inputClass} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setShowLogModal(false)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                    <button type="submit" disabled={sendingEmail} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">{sendingEmail ? 'Saving...' : 'Log Email'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          {(lead.activities ?? []).length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">No activity yet</div>
          ) : (
            <ul className="space-y-3">
              {(lead.activities ?? []).map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 bg-primary rounded-full mt-1.5" />
                  <div className="flex-1">
                    <p className="text-gray-800">{a.description}</p>
                    <p className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-gray-500 mb-1">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
