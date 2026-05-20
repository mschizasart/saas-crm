'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { patchOnboarding } from '../wizard-context';

/**
 * Step 8 — done. Marks onboarding complete on mount (so a refresh here
 * doesn't bounce the user back into the wizard) and offers a CTA to the
 * dashboard. No confetti dependency — a CSS pulse keeps the bundle lean.
 */
export default function OnboardingDonePage() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await patchOnboarding({ step: 'done', complete: true });
      if (!cancelled) setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col items-center text-center py-10">
      <div className="relative">
        <span className="absolute inset-0 rounded-full bg-green-400/30 animate-ping" />
        <CheckCircle2 className="relative w-16 h-16 text-green-500" />
      </div>

      <h1 className="mt-6 text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
        You&apos;re all set
      </h1>
      <p className="mt-2 max-w-md text-gray-600 dark:text-gray-400 text-sm md:text-base">
        Your workspace is ready. You can revisit any of these steps later from
        Settings. Time to get to work.
      </p>

      <Button
        variant="primary"
        className="mt-8"
        onClick={() => router.replace('/dashboard')}
        loading={!done}
        icon={done ? <ArrowRight className="w-4 h-4" /> : undefined}
      >
        Open dashboard
      </Button>
    </div>
  );
}
