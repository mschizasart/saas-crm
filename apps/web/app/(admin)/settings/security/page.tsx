'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, ShieldAlert, KeyRound, X, Copy } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';

interface MeResponse {
  id: string;
  email: string;
}

interface TwoFactorStatus {
  enabled: boolean;
  enrolledAt: string | null;
}

/**
 * Account security: TOTP-based 2FA management.
 *
 * Backend endpoints used (all under /api/v1/auth/2fa):
 *   POST /setup                   — generate QR + secret (pending)
 *   POST /verify-setup            — confirm + return recovery codes
 *   POST /disable                 — body: { password, code }
 *   POST /regenerate-recovery     — body: { code }
 */
export default function SecuritySettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup wizard state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable modal state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);

  // Regenerate modal state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load account');
      const body = await res.json();
      setMe({ id: body.id, email: body.email });
      // /me doesn't expose 2FA flags directly; fetch the small status from the user record
      // by reading from the JWT payload alternative — re-use /me which does include id.
      // Backend /auth/me returns the JwtStrategy projection without 2FA flags, so we
      // call the dedicated endpoint when available; otherwise infer false. To keep
      // the surface area minimal we read from a second endpoint:
      const r2 = await apiFetch('/api/v1/auth/2fa/status').catch(() => null);
      if (r2 && r2.ok) {
        const s = await r2.json();
        setStatus({ enabled: !!s.enabled, enrolledAt: s.enrolledAt ?? null });
      } else {
        setStatus({ enabled: false, enrolledAt: null });
      }
    } catch (e) {
      toast.error('Failed to load security settings');
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
      const res = await apiFetch('/api/v1/auth/2fa/setup', { method: 'POST' });
      if (!res.ok) throw new Error('Setup failed');
      const data = await res.json();
      setSetupData(data);
      setSetupOpen(true);
      setSetupCode('');
      setRecoveryCodes(null);
    } catch (e) {
      toast.error('Could not start 2FA setup');
    } finally {
      setSetupBusy(false);
    }
  };

  const verifySetup = async () => {
    if (setupCode.length !== 6) {
      toast.error('Enter the 6-digit code from your authenticator');
      return;
    }
    setSetupBusy(true);
    try {
      const res = await apiFetch('/api/v1/auth/2fa/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: setupCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Invalid code');
        return;
      }
      setRecoveryCodes(body.recoveryCodes ?? []);
      toast.success('Two-factor authentication enabled');
      await loadStatus();
    } finally {
      setSetupBusy(false);
    }
  };

  const closeSetup = () => {
    setSetupOpen(false);
    setSetupData(null);
    setSetupCode('');
    setRecoveryCodes(null);
  };

  const disable2fa = async () => {
    if (!disablePassword || disableCode.length !== 6) {
      toast.error('Password and 6-digit code required');
      return;
    }
    setDisableBusy(true);
    try {
      const res = await apiFetch('/api/v1/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Could not disable 2FA');
        return;
      }
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } finally {
      setDisableBusy(false);
    }
  };

  const regenerate = async () => {
    if (regenCode.length !== 6) {
      toast.error('Enter the 6-digit code');
      return;
    }
    setRegenBusy(true);
    try {
      const res = await apiFetch('/api/v1/auth/2fa/regenerate-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: regenCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Could not regenerate codes');
        return;
      }
      setRecoveryCodes(body.recoveryCodes ?? []);
      setRegenCode('');
      setRegenOpen(false);
      toast.success('New recovery codes generated');
    } finally {
      setRegenBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SettingsPageLayout title="Security" description="Manage how you sign in to your account.">
      <SettingsSection
        title="Two-factor authentication"
        description="Protect your account with a second factor in addition to your password."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
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
                    }`
                  : 'Add a TOTP app such as 1Password, Authy, or Google Authenticator.'}
              </p>
            </div>
            {status?.enabled ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setRegenOpen(true)}>
                  Regenerate recovery codes
                </Button>
                <Button variant="destructive" onClick={() => setDisableOpen(true)}>
                  Disable 2FA
                </Button>
              </div>
            ) : (
              <Button onClick={startSetup} loading={setupBusy}>
                Enable 2FA
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* ─── Setup modal ─────────────────────────────────────── */}
      {setupOpen && setupData && (
        <Modal title="Enable two-factor authentication" onClose={closeSetup}>
          {recoveryCodes ? (
            <RecoveryCodesPanel
              codes={recoveryCodes}
              onClose={closeSetup}
              accountEmail={me?.email}
            />
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
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeSetup}>
                  Cancel
                </Button>
                <Button onClick={verifySetup} loading={setupBusy}>
                  Verify and enable
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ─── Disable modal ───────────────────────────────────── */}
      {disableOpen && (
        <Modal title="Disable two-factor authentication" onClose={() => setDisableOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Confirm your password and enter a current 6-digit code from your authenticator
              to turn 2FA off.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="000000"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDisableOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={disable2fa} loading={disableBusy}>
                Disable
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Regenerate recovery codes modal ─────────────────── */}
      {regenOpen && (
        <Modal title="Regenerate recovery codes" onClose={() => setRegenOpen(false)}>
          {recoveryCodes ? (
            <RecoveryCodesPanel
              codes={recoveryCodes}
              onClose={() => {
                setRegenOpen(false);
                setRecoveryCodes(null);
              }}
              accountEmail={me?.email}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This invalidates any previous recovery codes. Enter a current 6-digit code
                to confirm.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="000000"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setRegenOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={regenerate} loading={regenBusy}>
                  Regenerate
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </SettingsPageLayout>
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
  accountEmail,
}: {
  codes: string[];
  onClose: () => void;
  accountEmail?: string;
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
        `AppoinlyCRM — recovery codes for ${accountEmail ?? 'your account'}\n` +
          'Each code may be used ONCE in place of a TOTP code if you lose your authenticator.\n' +
          'Store them somewhere safe.\n\n' +
          text +
          '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'appoinly-recovery-codes.txt';
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
          <Button variant="secondary" onClick={copy} icon={<Copy className="w-3.5 h-3.5" />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" onClick={download}>
            Download
          </Button>
        </div>
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
