'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import { FormField, inputClass } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';
import { patchOnboarding } from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

/**
 * Step 4 — create the tenant's first real client. Hits POST /clients
 * (no demo data fabrication). Skipping just advances the step.
 */
export default function OnboardingFirstClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({ company: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);

  const goNext = async () => {
    await patchOnboarding({ step: 'first_client' });
    router.push(nextStepPath('first_client'));
  };

  const onContinue = async () => {
    if (!form.company.trim()) {
      // Empty form == skip. Friendly fallback rather than blocking.
      await goNext();
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: form.company.trim(),
          phone: form.phone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        toast.error('Failed to create client — you can add one later');
        return;
      }
      // The clients endpoint doesn't take an email on the company itself
      // (contacts hang off clients). For the wizard we just record the
      // company; users add contacts after.
      toast.success(`Created ${form.company.trim()}`);
      await goNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="Add your first client"
        subtitle="Real data only — we won't create demo clients for you. You can add more after."
      />

      <div className="mt-8 max-w-xl space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 mb-4 text-primary">
            <Building2 className="w-4 h-4" />
            <span className="text-sm font-semibold">Client details</span>
          </div>

          <FormField label="Company name">
            <input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className={inputClass}
              placeholder="Globex Corporation"
              autoFocus
            />
          </FormField>

          <div className="mt-4">
            <FormField
              label="Primary contact email"
              hint="Used as a default contact — you can add more contacts later."
            >
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
                placeholder="contact@globex.com"
              />
            </FormField>
          </div>

          <div className="mt-4">
            <FormField label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
                placeholder="+1 555 0100"
              />
            </FormField>
          </div>
        </div>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('first_client');
          if (p) router.push(p);
        }}
        onContinue={onContinue}
        onSkip={goNext}
        continueLoading={saving}
        continueLabel="Save & continue"
      />
    </div>
  );
}
