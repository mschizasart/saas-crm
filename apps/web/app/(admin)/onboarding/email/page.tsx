'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { patchOnboarding } from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

/**
 * Step 6 — email. We don't reproduce the full SMTP/OAuth form here (it
 * lives at /settings/email). The wizard just explains the choice: use the
 * platform default mailer now, or jump to the full settings to connect a
 * tenant mailbox. "Continue" advances using whatever's already configured
 * (platform default if untouched).
 */
export default function OnboardingEmailPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const goNext = async () => {
    setSaving(true);
    try {
      await patchOnboarding({ step: 'email' });
      router.push(nextStepPath('email'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="Set up email"
        subtitle="Invoices, estimates, and ticket replies are sent by email. Use our shared mailer to start, or connect your own for better deliverability."
      />

      <div className="mt-8 max-w-xl space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 mb-3 text-primary">
            <Mail className="w-4 h-4" />
            <span className="text-sm font-semibold">Email delivery</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            By default, mail goes out through the platform mailer — nothing to
            configure. To send from your own domain (recommended for
            deliverability), connect SMTP or Gmail/Microsoft via OAuth.
          </p>
          <Link
            href="/settings/email"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Configure email settings
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('email');
          if (p) router.push(p);
        }}
        onContinue={goNext}
        onSkip={goNext}
        continueLoading={saving}
        continueLabel="Use platform default & continue"
      />
    </div>
  );
}
