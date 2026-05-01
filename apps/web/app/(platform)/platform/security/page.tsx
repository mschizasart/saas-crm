'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, KeyRound, X, Copy } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Status {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
}

/**
 * Platform admin: TOTP-based 2FA management.
 *
 * Backend endpoints (all under /api/v1/platform/2fa):
 *   GET  /status
 *   POST /setup
 *   POST /verify-setup
 *   POST /disable
 *   POST /regenerate-recovery
 */
export default function PlatformSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Setup state
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);

  // Regenerate state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);

  const token = () =>
    typeof window === 'undefined' ? null : localStorage.getItem('platform_token');

  const fetchJson = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
    return body;
  };

  const loadStatus = async () => {
    try {
      setErr(null);
      const s = await fetchJson('/api/v1/platform/2fa/status');
      setStatus({
        enabled: !!s.enabled,
        enrolledAt: s.enrolledAt ?? null,
        recoveryCodesRemaining: s.recoveryCodesRemaining ?? 0,
      });
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load 2FA status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSetup = async () => {
    setSetupBusy(true);
    try {
      const data = await fetchJson('/api/v1/platform/2fa/setup', { method: 'POST' });
      setSetupData(data);
      setSetupCode('');
      setRecoveryCodes(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Setup failed');
    } finally {
      setSetupBusy(false);
    }
  };

  const verifySetup = async () => {
    if (setupCode.length !== 6) return;
    setSetupBusy(true);
    try {
      const body = await fetchJson('/api/v1/platform/2fa/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code: setupCode }),
      });
      setRecoveryCodes(body.recoveryCodes ?? []);
      await loadStatus();
    } catch (e: any) {
      setErr(e?.message ?? 'Invalid code');
    } finally {
      setSetupBusy(false);
    }
  };

  const closeSetup = () => {
    setSetupData(null);
    setSetupCode('');
    setRecoveryCodes(null);
  };

  const disable = async () => {
    if (!disablePassword || disableCode.length !== 6) return;
    setDisableBusy(true);
    try {
      await fetchJson('/api/v1/platform/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } catch (e: any) {
      setErr(e?.message ?? 'Disable failed');
    } finally {
      setDisableBusy(false);
    }
  };

  const regenerate = async () => {
    if (regenCode.length !== 6) return;
    setRegenBusy(true);
    try {
      const body = await fetchJson('/api/v1/platform/2fa/regenerate-recovery', {
        method: 'POST',
        body: JSON.stringify({ code: regenCode }),
      });
      setRecoveryCodes(body.recoveryCodes ?? []);
      setRegenCode('');
      setRegenOpen(false);
      await loadStatus();
    } catch (e: any) {
      setErr(e?.message ?? 'Regenerate failed');
    } finally {
      setRegenBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Security</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage how this platform admin account signs in.
        </p>
      </div>

      {err && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <header className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Two-factor authentication
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Require a TOTP code in addition to your password.
          </p>
        </header>
        <div className="p-5 flex items-center gap-3">
          {status?.enabled ? (
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-500" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {status?.enabled ? '2FA is enabled' : '2FA is not enabled'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {status?.enabled
                ? `Enrolled ${
                    status.enrolledAt
                      ? new Date(status.enrolledAt).toLocaleString()
                      : ''
                  } · ${status.recoveryCodesRemaining} recovery codes left`
                : 'Add a TOTP app such as 1Password, Authy, or Google Authenticator.'}
            </p>
          </div>
          {status?.enabled ? (
            <div className="flex gap-2">
              <button
                onClick={() => setRegenOpen(true)}
                className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Regenerate recovery codes
              </button>
              <button
                onClick={() => setDisableOpen(true)}
                className="px-3 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Disable 2FA
              </button>
            </div>
          ) : (
            <button
              onClick={startSetup}
              disabled={setupBusy}
              className="px-3 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1"
            >
              {setupBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Enable 2FA
            </button>
          )}
        </div>
      </section>

      {/* Setup modal */}
      {setupData && (
        <Modal title="Enable two-factor authentication" onClose={closeSetup}>
          {recoveryCodes ? (
            <RecoveryCodesPanel codes={recoveryCodes} onClose={closeSetup} />
          ) : (
            <div className="space-y-4">
              <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal pl-4">
                <li>Open your authenticator app and scan the QR code below.</li>
                <li>Enter the 6-digit code your app shows.</li>
                <li>Save the recovery codes shown after confirmation.</li>
              </ol>
              <div className="flex flex-col items-center gap-3 p-4 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setupData.qrDataUrl} alt="2FA QR code" className="w-44 h-44" />
                <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Can&apos;t scan? Enter this key manually:
                  <div className="mt-1 font-mono text-[11px] tracking-wider text-gray-700 dark:text-gray-300 break-all">
                    {setupData.secret}
                  </div>
                </div>
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={closeSetup}
                  className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={verifySetup}
                  disabled={setupBusy}
                  className="px-3 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1"
                >
                  {setupBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Verify and enable
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Disable modal */}
      {disableOpen && (
        <Modal title="Disable two-factor authentication" onClose={() => setDisableOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Confirm your password and enter a current 6-digit code from your authenticator
              to turn 2FA off.
            </p>
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              placeholder="Password"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisableOpen(false)}
                className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={disable}
                disabled={disableBusy}
                className="px-3 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 flex items-center gap-1"
              >
                {disableBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Disable
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Regenerate modal */}
      {regenOpen && (
        <Modal title="Regenerate recovery codes" onClose={() => setRegenOpen(false)}>
          {recoveryCodes ? (
            <RecoveryCodesPanel
              codes={recoveryCodes}
              onClose={() => {
                setRegenOpen(false);
                setRecoveryCodes(null);
              }}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Existing recovery codes will be invalidated. Enter a current 6-digit code
                to confirm.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRegenOpen(false)}
                  className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={regenerate}
                  disabled={regenBusy}
                  className="px-3 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1"
                >
                  {regenBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ─── small components ──────────────────────────────────────────── */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function RecoveryCodesPanel({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const download = () => {
    const blob = new Blob(
      [
        'AppoinlyCRM platform admin — recovery codes\n' +
          'Each code may be used ONCE in place of a TOTP code.\n\n' +
          text +
          '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'platform-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-xs dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-200">
        Save these recovery codes. We will never show them again.
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <div
            key={c}
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 text-center tracking-wider"
          >
            {c}
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={download}
            className="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Download
          </button>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
