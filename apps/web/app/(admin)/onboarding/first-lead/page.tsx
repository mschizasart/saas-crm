'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Target } from 'lucide-react';
import { FormField, inputClass } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';
import { patchOnboarding } from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

/**
 * Step 5 — create the first lead. Same UX shape as first-client, but
 * hits POST /leads. Skipping just advances the step.
 */
export default function OnboardingFirstLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
  });
  const [saving, setSaving] = useState(false);

  const goNext = async () => {
    await patchOnboarding({ step: 'first_lead' });
    router.push(nextStepPath('first_lead'));
  };

  const onContinue = async () => {
    if (!form.name.trim()) {
      await goNext();
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          company: form.company.trim() || undefined,
          status: 'new',
        }),
      });
      if (!res.ok) {
        toast.error('Failed to create lead — you can add one later');
        return;
      }
      toast.success(`Added lead ${form.name.trim()}`);
      await goNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="Add your first lead"
        subtitle="A lead is a potential customer you're tracking. Add one now or skip."
      />

      <div className="mt-8 max-w-xl space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 mb-4 text-primary">
            <Target className="w-4 h-4" />
            <span className="text-sm font-semibold">Lead details</span>
          </div>

          <FormField label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              placeholder="Jane Doe"
              autoFocus
            />
          </FormField>

          <div className="mt-4">
            <FormField label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
                placeholder="jane@example.com"
              />
            </FormField>
          </div>

          <div className="mt-4">
            <FormField label="Company">
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className={inputClass}
                placeholder="Initech"
              />
            </FormField>
          </div>
        </div>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('first_lead');
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
