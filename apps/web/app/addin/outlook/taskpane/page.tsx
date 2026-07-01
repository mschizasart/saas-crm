'use client';

import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Outlook add-in taskpane (sidebar). Renders at /addin/outlook/taskpane and is
// deliberately kept OUTSIDE every (admin)/(auth)/(portal) route group so no
// route-group layout gates it behind a session — it must load raw inside the
// Outlook add-in host (an iframe / webview) with no CRM chrome.
//
// Auth model (v1): the add-in user logs in *inside* the taskpane
// (email + password -> POST /auth/login) and we stash the JWT in localStorage
// under 'access_token' (same key the rest of the app uses). We then call the
// add-in API with plain fetch + `Authorization: Bearer <token>` (NEVER the
// app's apiFetch, which auto-redirects to /login on 401 — that would break the
// embedded host). Office SSO (getAccessToken) is a future enhancement.
// ---------------------------------------------------------------------------

// Office.js is injected at runtime (see loadOffice) and has no @types package
// installed — declaring it `any` keeps this typecheck-clean with no new dep.
declare const Office: any;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const APP_BASE =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== 'undefined' ? window.location.origin : '');

const TOKEN_KEY = 'access_token';
const OFFICE_JS = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';

// ── Types (mirror the add-in API contract) ──
interface RecentActivity {
  type: string;
  direction: string;
  subject: string;
  occurredAt: string;
}

interface AddinContext {
  found: boolean;
  type?: string; // 'lead' | 'client' | ...
  record?: {
    id?: string;
    name?: string;
    company?: string;
    email?: string;
    phone?: string;
  } | null;
  contactId?: string;
  recentActivity?: RecentActivity[];
  canCreateLead?: boolean;
}

// ── Helpers ──
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Dynamically inject Office.js and resolve once it's ready. Resolves with
// `false` (rather than rejecting) if Office never initializes — that lets the
// page render fine in a plain browser for local testing.
function loadOffice(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    const w = window as any;
    const done = () => {
      try {
        if (w.Office && typeof w.Office.onReady === 'function') {
          w.Office.onReady(() => resolve(true));
        } else {
          resolve(false);
        }
      } catch {
        resolve(false);
      }
    };
    // Already present?
    if (w.Office) {
      done();
      return;
    }
    // Already injected by a previous mount?
    const existing = document.querySelector(
      `script[src="${OFFICE_JS}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = OFFICE_JS;
    s.async = true;
    s.onload = done;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    // Safety net: if Office never signals ready, don't hang the UI forever.
    setTimeout(() => resolve(false), 6000);
  });
}

export default function OutlookTaskpanePage() {
  const [officeReady, setOfficeReady] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Sender info read from the open Outlook message.
  const [senderEmail, setSenderEmail] = useState<string>('');
  const [senderName, setSenderName] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [messageId, setMessageId] = useState<string | undefined>(undefined);

  // Auth
  const [authed, setAuthed] = useState<boolean>(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Context
  const [ctx, setCtx] = useState<AddinContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);

  // Actions
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [logging, setLogging] = useState(false);
  const [emailLogged, setEmailLogged] = useState(false);

  // Create-lead form
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [creatingLead, setCreatingLead] = useState(false);
  const [createdLead, setCreatedLead] = useState<{ id?: string; name?: string } | null>(null);

  // ── Mount: load Office.js, read the open message, check auth ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuthed(!!getToken());
      const ready = await loadOffice();
      if (cancelled) return;
      setOfficeReady(ready);

      if (ready) {
        try {
          const item = Office?.context?.mailbox?.item;
          const from = item?.from;
          if (from?.emailAddress) {
            setSenderEmail(from.emailAddress);
            setLeadEmail(from.emailAddress);
          }
          if (from?.displayName) {
            setSenderName(from.displayName);
            setLeadName(from.displayName);
          }
          if (item?.subject) setSubject(item.subject);
          if (item?.itemId) setMessageId(item.itemId);
        } catch {
          // Office present but no readable item (e.g. no message selected).
        }
      }
      setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch CRM context once authed + we know the sender ──
  const loadContext = useCallback(async () => {
    if (!authed || !senderEmail) return;
    setCtxLoading(true);
    setCtxError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/addin/context`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          senderEmail,
          subject: subject || undefined,
          messageId,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setAuthed(false);
        return;
      }
      if (!res.ok) throw new Error(`Failed to load CRM context (${res.status})`);
      const data: AddinContext = await res.json();
      setCtx(data);
      // Prefill create-lead company if we happen to know it.
      if (!data.found && data.record?.company) setLeadCompany(data.record.company);
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : 'Failed to load CRM context');
    } finally {
      setCtxLoading(false);
    }
  }, [authed, senderEmail, subject, messageId]);

  useEffect(() => {
    if (authed && senderEmail) loadContext();
  }, [authed, senderEmail, loadContext]);

  // ── Login ──
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false || !body?.accessToken) {
        throw new Error(body?.message || 'Invalid email or password');
      }
      localStorage.setItem(TOKEN_KEY, body.accessToken);
      if (body.refreshToken) localStorage.setItem('refresh_token', body.refreshToken);
      setAuthed(true);
      setLoginPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setAuthed(false);
    setCtx(null);
    setStatus(null);
    setEmailLogged(false);
  }

  // ── Log this email as an activity ──
  async function handleLogEmail(relatedToType?: string, relatedToId?: string) {
    setLogging(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/addin/log-email`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          relatedToType,
          relatedToId,
          senderEmail: senderEmail || undefined,
          subject: subject || '(no subject)',
          body: `Email from ${senderName || senderEmail} logged from Outlook add-in.`,
          direction: 'inbound',
          occurredAt: new Date().toISOString(),
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setAuthed(false);
        return;
      }
      if (!res.ok) throw new Error(`Failed to log email (${res.status})`);
      setEmailLogged(true);
      setStatus({ kind: 'ok', msg: 'Email logged to CRM.' });
      loadContext();
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed to log email' });
    } finally {
      setLogging(false);
    }
  }

  // ── Create a lead from the sender ──
  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    setCreatingLead(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/addin/create-lead`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: leadName,
          email: leadEmail.trim() || undefined,
          phone: leadPhone.trim() || undefined,
          company: leadCompany.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setAuthed(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = Array.isArray(body?.message)
          ? body.message.join(', ')
          : body?.message || `Failed to create lead (${res.status})`;
        throw new Error(msg);
      }
      setCreatedLead({ id: body?.id, name: body?.name ?? leadName });
      setStatus({ kind: 'ok', msg: 'Lead created.' });
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed to create lead' });
    } finally {
      setCreatingLead(false);
    }
  }

  // Build a link into the CRM for a matched (or freshly created) record.
  function recordUrl(type: string | undefined, id: string | undefined): string | null {
    if (!id) return null;
    const t = (type || '').toLowerCase();
    if (t === 'client') return `${APP_BASE}/clients/${id}`;
    // default to lead for leads and anything else lead-like
    return `${APP_BASE}/leads/${id}`;
  }

  // ── Render ──
  const inputCls =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';
  const btnPrimary =
    'w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-sm px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
              A
            </div>
            <span className="text-sm font-semibold text-gray-900">Appoinly CRM</span>
          </div>
          {authed && (
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              Sign out
            </button>
          )}
        </div>

        {/* Global status */}
        {status && (
          <div
            className={`mb-3 px-3 py-2 text-sm rounded-lg border ${
              status.kind === 'ok'
                ? 'bg-green-50 border-green-100 text-green-700'
                : 'bg-red-50 border-red-100 text-red-600'
            }`}
          >
            {status.msg}
          </div>
        )}

        {/* ── Not authed: login form ── */}
        {!authed ? (
          <form
            onSubmit={handleLogin}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4"
          >
            <h1 className="text-base font-semibold text-gray-900 mb-1">Sign in</h1>
            <p className="text-xs text-gray-500 mb-4">
              Sign in to your CRM account to see contact context for this email.
            </p>
            {loginError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
                {loginError}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className={inputCls}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className={inputCls}
                  autoComplete="current-password"
                />
              </div>
            </div>
            <button type="submit" disabled={loggingIn} className={`${btnPrimary} mt-4`}>
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <>
            {/* Sender summary */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                Email sender
              </p>
              {senderEmail ? (
                <>
                  <p className="text-sm font-medium text-gray-900 break-words">
                    {senderName || senderEmail}
                  </p>
                  {senderName && (
                    <p className="text-xs text-gray-500 break-words">{senderEmail}</p>
                  )}
                  {subject && (
                    <p className="text-xs text-gray-400 mt-2 break-words">
                      Re: <span className="text-gray-600">{subject}</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  {officeReady
                    ? 'No message selected. Open an email to see its sender.'
                    : 'Running outside Outlook — no email context available.'}
                </p>
              )}
            </div>

            {/* Context */}
            {senderEmail && (
              <>
                {ctxLoading ? (
                  <div className="text-sm text-gray-400 py-8 text-center">
                    Looking up contact…
                  </div>
                ) : ctxError ? (
                  <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
                    {ctxError}
                  </div>
                ) : ctx && ctx.found ? (
                  // ── Matched record ──
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 break-words">
                          {ctx.record?.name || senderName || senderEmail}
                        </p>
                        {ctx.record?.company && (
                          <p className="text-xs text-gray-500 break-words">
                            {ctx.record.company}
                          </p>
                        )}
                      </div>
                      {ctx.type && (
                        <span className="flex-shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary uppercase">
                          {ctx.type}
                        </span>
                      )}
                    </div>

                    <dl className="text-xs text-gray-600 space-y-1 mb-3">
                      {ctx.record?.email && (
                        <div className="flex gap-2">
                          <dt className="text-gray-400 w-14 flex-shrink-0">Email</dt>
                          <dd className="break-words">{ctx.record.email}</dd>
                        </div>
                      )}
                      {ctx.record?.phone && (
                        <div className="flex gap-2">
                          <dt className="text-gray-400 w-14 flex-shrink-0">Phone</dt>
                          <dd className="break-words">{ctx.record.phone}</dd>
                        </div>
                      )}
                    </dl>

                    {/* Recent activity */}
                    {ctx.recentActivity && ctx.recentActivity.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                          Recent activity
                        </p>
                        <ul className="space-y-1.5">
                          {ctx.recentActivity.slice(0, 5).map((a, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span
                                className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  a.direction === 'outbound' ? 'bg-blue-400' : 'bg-green-400'
                                }`}
                              />
                              <span className="min-w-0">
                                <span className="text-gray-700 break-words">
                                  {a.subject || a.type}
                                </span>
                                <span className="block text-gray-400">
                                  {a.type} · {fmtDate(a.occurredAt)}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleLogEmail(ctx.type, ctx.record?.id ?? ctx.contactId)}
                        disabled={logging || emailLogged}
                        className={btnPrimary}
                      >
                        {emailLogged
                          ? 'Email logged ✓'
                          : logging
                            ? 'Logging…'
                            : 'Log this email'}
                      </button>
                      {recordUrl(ctx.type, ctx.record?.id ?? ctx.contactId) && (
                        <a
                          href={recordUrl(ctx.type, ctx.record?.id ?? ctx.contactId) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full text-center px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Open in CRM
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  // ── No match: create lead ──
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    {createdLead ? (
                      <>
                        <h2 className="text-sm font-semibold text-gray-900 mb-1">
                          Lead created ✓
                        </h2>
                        <p className="text-xs text-gray-500 mb-3">
                          {createdLead.name} was added to your CRM.
                        </p>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => handleLogEmail('lead', createdLead.id)}
                            disabled={logging || emailLogged}
                            className={btnPrimary}
                          >
                            {emailLogged
                              ? 'Email logged ✓'
                              : logging
                                ? 'Logging…'
                                : 'Log this email'}
                          </button>
                          {recordUrl('lead', createdLead.id) && (
                            <a
                              href={recordUrl('lead', createdLead.id) as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-full text-center px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              Open in CRM
                            </a>
                          )}
                        </div>
                      </>
                    ) : (
                      <form onSubmit={handleCreateLead}>
                        <h2 className="text-sm font-semibold text-gray-900 mb-1">
                          No contact found
                        </h2>
                        <p className="text-xs text-gray-500 mb-3">
                          Create a lead from this sender.
                        </p>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={leadName}
                              onChange={(e) => setLeadName(e.target.value)}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Email
                            </label>
                            <input
                              type="email"
                              value={leadEmail}
                              onChange={(e) => setLeadEmail(e.target.value)}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Phone
                            </label>
                            <input
                              type="tel"
                              value={leadPhone}
                              onChange={(e) => setLeadPhone(e.target.value)}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Company
                            </label>
                            <input
                              type="text"
                              value={leadCompany}
                              onChange={(e) => setLeadCompany(e.target.value)}
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={creatingLead || !leadName.trim()}
                          className={`${btnPrimary} mt-4`}
                        >
                          {creatingLead ? 'Creating…' : 'Create lead from sender'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <p className="text-[11px] text-gray-400 text-center mt-6">Powered by AppoinlyCRM</p>
      </div>
    </div>
  );
}
