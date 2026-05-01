'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 2FA prompt state
  const [requires2fa, setRequires2fa] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const finishLogin = (data: { accessToken: string; admin: any }) => {
    localStorage.setItem('platform_token', data.accessToken);
    localStorage.setItem('platform_admin', JSON.stringify(data.admin));
    router.replace('/platform');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 401) {
        setError('Invalid credentials');
        return;
      }
      if (!res.ok) {
        setError('Login failed. Please try again.');
        return;
      }
      const data = await res.json();
      if (data.requires2fa) {
        setTwoFactorToken(data.twoFactorToken);
        setRequires2fa(true);
        return;
      }
      finishLogin(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit2fa = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/2fa/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twoFactorToken, code: twoFaCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Invalid verification code');
        return;
      }
      finishLogin(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex w-12 h-12 bg-indigo-500 rounded-xl items-center justify-center mb-3">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Platform Admin</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to manage all organizations</p>
        </div>

        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          {!requires2fa ? (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="admin@platform.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit2fa} className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Two-factor authentication
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {useRecoveryCode
                    ? 'Enter one of your saved recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>
              <input
                type="text"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                maxLength={useRecoveryCode ? 12 : 6}
                value={twoFaCode}
                onChange={(e) =>
                  setTwoFaCode(
                    useRecoveryCode
                      ? e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
                      : e.target.value.replace(/\D/g, ''),
                  )
                }
                placeholder={useRecoveryCode ? 'XXXXX-XXXXX' : '000000'}
                className="w-full px-3 py-2 text-center text-lg tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                autoFocus
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryCode((v) => !v);
                  setTwoFaCode('');
                  setError(null);
                }}
                className="w-full text-xs text-indigo-600 hover:underline"
              >
                {useRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRequires2fa(false);
                  setTwoFactorToken('');
                  setTwoFaCode('');
                  setUseRecoveryCode(false);
                  setError(null);
                }}
                className="w-full text-xs text-gray-500 dark:text-gray-400 hover:underline"
              >
                Back to login
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
