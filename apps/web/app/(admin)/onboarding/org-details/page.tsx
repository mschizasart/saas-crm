'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FormField, inputClass } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';
import {
  patchOnboarding,
  useOnboardingState,
} from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

interface CurrencyRow {
  id: string;
  name: string;
  symbol: string;
}

/**
 * Step 2 — collect/edit org basics. Pre-fills from Organization row.
 * Persists via `PATCH /onboarding { step:'org_details', orgUpdates:{...} }`
 * which writes both column fields and (timezone, defaultCurrencyId)
 * into settings JSON.
 */
export default function OnboardingOrgDetailsPage() {
  const router = useRouter();
  const { state, loading } = useOnboardingState();
  const [form, setForm] = useState({
    name: '',
    logo: '',
    address: '',
    city: '',
    country: '',
    timezone: '',
    defaultCurrencyId: '',
  });
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    setForm({
      name: state.organization.name ?? '',
      logo: state.organization.logo ?? '',
      address: state.organization.address ?? '',
      city: state.organization.city ?? '',
      country: state.organization.country ?? '',
      timezone:
        state.organization.timezone ??
        (typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : ''),
      defaultCurrencyId: state.organization.defaultCurrencyId ?? '',
    });
  }, [state]);

  // Currencies live on Organization — populated by org bootstrap. Empty
  // list is fine; the dropdown just shows "(none yet)".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch('/api/v1/organizations/currencies').catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => []);
      if (!cancelled) setCurrencies(Array.isArray(data) ? data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onContinue = async () => {
    if (!form.name.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    const ok = await patchOnboarding({
      step: 'org_details',
      orgUpdates: {
        name: form.name.trim(),
        logo: form.logo.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        country: form.country.trim() || undefined,
        timezone: form.timezone || undefined,
        defaultCurrencyId: form.defaultCurrencyId || undefined,
      },
    });
    setSaving(false);
    if (!ok) {
      toast.error('Could not save — please try again');
      return;
    }
    toast.success('Saved');
    router.push(nextStepPath('org_details'));
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Loading…</div>;
  }

  return (
    <div>
      <StepHeader
        title="Your company"
        subtitle="Tell us a few basics. You can change these anytime in Settings."
      />

      <div className="mt-8 space-y-4 max-w-xl">
        <FormField label="Company name" required>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
            placeholder="Acme Inc."
            autoFocus
          />
        </FormField>

        <FormField label="Logo URL" hint="A public URL to your logo image (we don't host uploads in this step).">
          <input
            value={form.logo}
            onChange={(e) => setForm({ ...form, logo: e.target.value })}
            className={inputClass}
            placeholder="https://example.com/logo.png"
          />
        </FormField>

        <FormField label="Address">
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className={inputClass}
            placeholder="123 Market St"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="City">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className={inputClass}
            />
          </FormField>
          <FormField label="Country">
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className={inputClass}
              placeholder="United States"
            />
          </FormField>
        </div>

        <FormField label="Timezone" hint="Used for scheduling and reports.">
          <input
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            className={inputClass}
            placeholder="Europe/Athens"
          />
        </FormField>

        <FormField
          label="Default currency"
          hint={
            currencies.length === 0
              ? 'No currencies set up yet — you can add them later in Settings.'
              : undefined
          }
        >
          <select
            value={form.defaultCurrencyId}
            onChange={(e) =>
              setForm({ ...form, defaultCurrencyId: e.target.value })
            }
            className={inputClass}
            disabled={currencies.length === 0}
          >
            <option value="">— select —</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.symbol})
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('org_details');
          if (p) router.push(p);
        }}
        onContinue={onContinue}
        continueLoading={saving}
      />
    </div>
  );
}

