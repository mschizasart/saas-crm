'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/use-i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [showPassword, setShowPassword] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [loading, setLoading] = useState(false);

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
        setTempToken(body.tempToken);
        setRequires2fa(true);
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
    if (twoFaCode.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code: twoFaCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        toast.error(body.message || 'Invalid verification code');
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

  if (requires2fa) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('auth.twoFactor')}</h2>
        <p className="text-gray-500 mb-6">{t('auth.twoFactorPrompt')}</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={twoFaCode}
          onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 mb-4"
        />
        <button
          onClick={handle2faVerify}
          disabled={loading || twoFaCode.length !== 6}
          className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('auth.verify')}
        </button>
        <button
          onClick={() => setRequires2fa(false)}
          className="w-full mt-3 py-3 text-gray-600 hover:text-gray-900 text-sm"
        >
          {t('auth.backToLogin')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('auth.welcomeBack')}</h2>
      <p className="text-gray-500 mb-6">{t('auth.signInToAccount')}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
          <input
            {...register('email')}
            type="email"
            autoComplete="email"
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            placeholder="you@company.com"
          />
          {errors.email && (
            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">{t('auth.password')}</label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <input
              {...register('password')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="w-full px-4 py-3 pr-10 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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

      <p className="mt-8 text-center text-sm text-gray-500">
        {t('auth.newUser')}{' '}
        <Link href="/register" className="text-primary font-medium hover:underline">
          {t('auth.startTrial')}
        </Link>
      </p>
    </div>
  );
}
