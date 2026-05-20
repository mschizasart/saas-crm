'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ExternalLink } from 'lucide-react';
import { patchOnboarding } from '../wizard-context';
import { nextStepPath, prevStepPath } from '../steps';
import { StepHeader, WizardFooter } from '../_components';

/**
 * Step 7 — AI. Like the email step, the full provider/key form lives at
 * /settings/ai. The wizard explains the BYO-key option and lets the user
 * either jump there or continue on the platform default.
 */
export default function OnboardingAiPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const goNext = async () => {
    setSaving(true);
    try {
      await patchOnboarding({ step: 'ai' });
      router.push(nextStepPath('ai'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="AI features"
        subtitle="Lead scoring, inbox summaries, and the text-improve tools run on AI. Use the platform default, or bring your own Anthropic / OpenAI key."
      />

      <div className="mt-8 max-w-xl space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 mb-3 text-primary">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-semibold">AI provider</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            AI works out of the box on the platform&apos;s shared allowance
            (subject to availability). To control cost and model choice, add
            your own Anthropic or OpenAI key — usage is then billed to your
            provider account, and you can pick a faster or higher-quality model.
          </p>
          <Link
            href="/settings/ai"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Configure AI settings
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <WizardFooter
        onBack={() => {
          const p = prevStepPath('ai');
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
