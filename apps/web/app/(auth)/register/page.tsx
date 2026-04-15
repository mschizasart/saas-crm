'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, CheckCircle2 } from 'lucide-react';

const registerSchema = z.object({
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters'),
  slug: z
    .string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterForm = z.infer<typeof registerSchema>;

const FEATURES = [
  'Invoices, estimates & proposals',
  'Client & lead management',
  'Project & task tracking',
  'Support tickets',
  'Contracts with e-signing',
  '14-day free trial, no card needed',
];

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  // Auto-generate slug from org name
  const orgName = watch('organizationName');
  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setValue('organizationName', name);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setValue('slug', slug);
  };

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.message || 'Registration failed');
        return;
      }

      const { accessToken, refreshToken } = await res.json();
      // Store tokens and redirect
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);

      toast.success('Account created! Welcome aboard.');
      router.push('/dashboard');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Start your free trial</h2>
      <p className="text-gray-500 mb-2 text-sm">14 days free. No credit card required.</p>

      <ul className="mb-6 space-y-1">
        {FEATURES.map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization name</label>
          <input
            {...register('organizationName')}
            onChange={handleOrgNameChange}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            placeholder="Acme Inc."
          />
          {errors.organizationName && (
            <p className="mt-1 text-xs text-destructive">{errors.organizationName.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subdomain</label>
          <div className="flex">
            <input
              {...register('slug')}
              className="flex-1 px-4 py-2.5 border border-r-0 border-gray-200 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="acme"
            />
            <span className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-r-lg text-sm text-gray-500">
              .yoursaas.com
            </span>
          </div>
          {errors.slug && (
            <p className="mt-1 text-xs text-destructive">{errors.slug.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
            <input
              {...register('firstName')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="John"
            />
            {errors.firstName && (
              <p className="mt-1 text-xs text-destructive">{errors.firstName.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
            <input
              {...register('lastName')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="Doe"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
          <input
            {...register('email')}
            type="email"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            placeholder="john@acme.com"
          />
          {errors.email && (
            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            {...register('password')}
            type="password"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            placeholder="At least 8 characters"
          />
          {errors.password && (
            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm mt-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Create your account
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-gray-500">
        Already have an account?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
