'use client';

// Thin wrapper around the onboarding REST endpoints + shared helpers
// used by every wizard step. We deliberately keep this as plain hooks
// (no React Query) — the wizard is short-lived and each step's network
// pattern is trivial.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export interface OnboardingState {
  completedAt: string | null;
  currentStep: string | null;
  skipped: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
    phone: string | null;
    website: string | null;
    vatNumber: string | null;
    timezone: string | null;
    defaultCurrencyId: string | null;
  };
}

export function useOnboardingState() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/me/onboarding');
        if (!res.ok) return;
        const data = (await res.json()) as OnboardingState;
        if (!cancelled) setState(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, setState, loading };
}

export interface PatchPayload {
  step?: string;
  skip?: boolean;
  complete?: boolean;
  orgUpdates?: Record<string, any>;
}

export async function patchOnboarding(body: PatchPayload): Promise<boolean> {
  const res = await apiFetch('/api/v1/organizations/me/onboarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function useSkipOnboarding() {
  const router = useRouter();
  return useCallback(async () => {
    await patchOnboarding({ skip: true });
    router.replace('/dashboard');
  }, [router]);
}
