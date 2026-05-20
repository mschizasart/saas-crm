'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Building2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/use-i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

interface OrgMembershipChoice {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
  isPrimary: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [showPassword, setShowPassword] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  // Legacy step-1 token (old field name `tempToken`) is kept for backward
  // compatibility with previously-enrolled users; new TOTP flow uses
  // `twoFactorToken`. Whichever the API returns is what we send back.
  const [tempToken, setTempToken] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [loading, setLoading] = useState(false);

  // Multi-org selection state.
  //
  // The API returns { requiresOrgSelection: true, orgSelectionToken, memberships }
  // either directly from /login (no 2FA) or from /auth/2fa/login (after a
  // successful 2FA verification). In both cases we drop into this branch.
  const [orgSelection, setOrgSelection] = useState<{
    token: string;
    memberships: OrgMembershipChoice[];
  } | null>(null);
  const [pickingOrgId, setPickingOrgId] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  async function saveTokens(accessToken: string, refreshToken?: string) {
    localStorage.setItem('access_token', accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
  }

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(body.message || 'Login failed');
        return;
      }
      // API returns {success: false} on invalid credentials with 200
      if (body.success === false) {
        toast.error(body.message || 'Invalid email or password');
        return;
      }
      if (body.requires2fa) {
        // New TOTP flow returns `twoFactorToken`; legacy flow returns `tempToken`.
        if (body.twoFactorToken) setTwoFactorToken(body.twoFactorToken);
        if (body.tempToken) setTempToken(body.tempToken);
        setRequires2fa(true);
        return;
      }
      if (body.requiresOrgSelection) {
        // Multi-org user, no 2FA. Layer "select organization" UI before
        // the dashboard. The API has NOT issued an access token yet —
        // we'll receive one from /auth/select-org.
        setOrgSelection({
          token: body.orgSelectionToken,
          memberships: body.memberships ?? [],
        });
        return;
      }
      await saveTokens(body.accessToken, body.refreshToken);
      toast.success('Welcome back!');
      window.location.href = '/dashboard';
    } catch (e) {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handle2faVerify = async () => {
    if (!useRecoveryCode && twoFaCode.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }
    if (useRecoveryCode && twoFaCode.replace(/[\s-]/g, '').length < 8) {
      toast.error('Enter a recovery code');
      return;
    }
    setLoading(true);
    try {
      const useNewFlow = !!twoFactorToken;
      const url = useNewFlow
        ? `${API_BASE}/api/v1/auth/2fa/login`
        : `${API_BASE}/api/v1/auth/2fa/verify`;
      const payload = useNewFlow
        ? { twoFactorToken, code: twoFaCode }
        : { tempToken, code: twoFaCode };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        toast.error(body.message || 'Invalid verification code');
        return;
      }
      if (body.requiresOrgSelection) {
        // 2FA passed but the user belongs to multiple orgs. Hop into the
        // org-select step before granting access. NB: at this point the
        // API still hasn't minted an access token.
        setRequires2fa(false);
        setUseRecoveryCode(false);
        setTwoFaCode('');
        setOrgSelection({
          token: body.orgSelectionToken,
          memberships: body.memberships ?? [],
        });
        return;
      }
      await saveTokens(body.accessToken, body.refreshToken);
      window.location.href = '/dashboard';
    } catch {
      toast.error('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOrgPick = async (m: OrgMembershipChoice) => {
    if (!orgSelection) return;
    setPickingOrgId(m.orgId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/select-org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSelectionToken: orgSelection.token,
          orgId: m.orgId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        toast.error(body.message || 'Could not enter that organization');
        return;
      }
      await saveTokens(body.accessToken, body.refreshToken);
      toast.success(`Welcome to ${m.orgName}`);
      window.location.href = '/dashboard';
    } catch {
      toast.error('Could not enter that organization');
    } finally {
      setPickingOrgId(null);
    }
  };

  if (orgSelection) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Choose an organization
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Your account belongs to multiple organizations. Pick one to continue.
        </p>
        <div className="space-y-2">
          {orgSelection.memberships.map((m) => {
            const busy = pickingOrgId === m.orgId;
            return (
              <button
                key={m.orgId}
                onClick={() => handleOrgPick(m)}
                disabled={busy}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left disabled:opacity-60"
              >
                <Building2 className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {m.orgName}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {m.role}
                    {m.isPrimary ? ' · primary' : ''}
                  </div>
                </div>
                {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => {
            setOrgSelection(null);
            setPickingOrgId(null);
          }}
          className="w-full mt-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm"
        >
          {t('auth.backToLogin')}
        </button>
      </div>
    );
  }

  if (requires2fa) {
    const supportsRecovery = !!twoFactorToken; // recovery codes only work with the new flow
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t('auth.twoFactor')}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          {useRecoveryCode
            ? 'Enter one of your saved recovery codes.'
            : t('auth.twoFactorPrompt')}
        </p>
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
          className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 mb-4 font-mono"
        />
        <button
          onClick={handle2faVerify}
          disabled={loading}
          className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('auth.verify')}
        </button>
        {supportsRecovery && (
          <button
            onClick={() => {
              setUseRecoveryCode((v) => !v);
              setTwoFaCode('');
            }}
            className="w-full mt-3 py-2 text-primary text-sm hover:underline"
          >
            {useRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code'}
          </button>
        )}
        <button
          onClick={() => {
            setRequires2fa(false);
            setUseRecoveryCode(false);
            setTwoFaCode('');
            setTempToken('');
            setTwoFactorToken('');
          }}
          className="w-full mt-1 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm"
        >
          {t('auth.backToLogin')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('auth.welcomeBack')}</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">{t('auth.signInToAccount')}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('auth.email')}</label>
          <input
            {...register('email')}
            type="email"
            autoComplete="email"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            placeholder="you@company.com"
          />
          {errors.email && (
            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('auth.password')}</label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <input
              {...register('password')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="w-full px-4 py-3 pr-10 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('auth.login')}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('auth.newUser')}{' '}
        <Link href="/register" className="text-primary font-medium hover:underline">
          {t('auth.startTrial')}
        </Link>
      </p>
    </div>
  );
}
