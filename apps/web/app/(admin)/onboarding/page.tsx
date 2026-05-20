'use client';

import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { patchOnboarding, useSkipOnboarding } from './wizard-context';
import { nextStepPath } from './steps';

/**
 * Step 1 — welcome.
 *
 * Persists `step=welcome` server-side and routes to `/org-details`.
 * Note: we mark the welcome step done EAGERLY on click so the back-pill
 * for "Welcome" becomes a re-visit link if the user wants to look again.
 */
export default function OnboardingWelcomePage() {
  const router = useRouter();
  const skip = useSkipOnboarding();

  const start = async () => {
    await patchOnboarding({ step: 'welcome' });
    router.push(nextStepPath('welcome'));
  };

  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-6">
        <Sparkles className="w-8 h-8" aria-hidden="true" />
      </div>
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">
        Welcome to Appoinly CRM
      </h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400 text-base md:text-lg max-w-xl mx-auto">
        Let&apos;s get you set up in about 5 minutes. We&apos;ll cover the basics,
        invite your team, and connect email and AI so you can see value fast.
      </p>

      <div className="mt-8 grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
        <Feature title="Your company" desc="Logo, address, default currency." />
        <Feature title="Your team" desc="Invite teammates by email." />
        <Feature title="Email & AI" desc="Bring your own provider, or use ours." />
      </div>

      <div className="mt-10 flex items-center justify-center gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={start}
          icon={<ArrowRight className="w-4 h-4" />}
        >
          Get started
        </Button>
        <Button variant="ghost" size="lg" onClick={skip}>
          Skip for now
        </Button>
      </div>
      <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
        You can re-run this tour any time from Settings.
      </p>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</div>
    </div>
  );
}
