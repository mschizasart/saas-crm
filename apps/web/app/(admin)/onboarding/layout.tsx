'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { WIZARD_STEPS, stepIndex } from './steps';
import { useSkipOnboarding } from './wizard-context';
import { apiFetch } from '@/lib/api';

/**
 * Wizard-only chrome: thin top bar with the step indicator + "Skip"
 * button. Lives inside the (admin) route group so it inherits the
 * auth gate, but `app/(admin)/layout.tsx` recognises the /onboarding
 * prefix and strips the sidebar before rendering us.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const skip = useSkipOnboarding();

  // Find which step the current URL corresponds to.
  const currentIndex = (() => {
    const i = WIZARD_STEPS.findIndex((s) => s.path === pathname);
    return i < 0 ? 0 : i;
  })();

  // Server-side furthest-step-completed — controls which step pills are
  // clickable (already done) vs. disabled (still ahead).
  const [furthestIndex, setFurthestIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/me/onboarding');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setFurthestIndex(stepIndex(data.currentStep));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Stop the "Done" step from showing the Skip button — confetti is the
  // happy path, not a thing to dismiss.
  const onDone = pathname === '/onboarding/done';

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              Appoinly CRM
            </span>
          </div>

          <div className="hidden sm:block text-xs text-gray-400 dark:text-gray-500">/</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">
            Setup
          </div>

          <StepIndicator
            currentIndex={currentIndex}
            furthestIndex={furthestIndex}
          />

          {!onDone && (
            <button
              type="button"
              onClick={skip}
              className="ml-auto text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Skip onboarding"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Skip onboarding
            </button>
          )}
        </div>
        <div className="max-w-5xl mx-auto px-4 md:px-6 pb-2 text-xs text-gray-500 dark:text-gray-400 sm:hidden">
          Step {currentIndex + 1} of {WIZARD_STEPS.length}
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}

function StepIndicator({
  currentIndex,
  furthestIndex,
}: {
  currentIndex: number;
  furthestIndex: number;
}) {
  // Steps already done (index <= furthestIndex) are clickable. Future
  // steps render as disabled pills so users can't skip ahead and break
  // the linear flow.
  return (
    <nav
      aria-label="Onboarding progress"
      className="hidden sm:flex items-center gap-1 ml-2"
    >
      {WIZARD_STEPS.map((step, i) => {
        const done = i < currentIndex || i <= furthestIndex;
        const current = i === currentIndex;
        const clickable = i <= furthestIndex || i < currentIndex;
        const base =
          'inline-flex items-center justify-center text-[11px] font-medium rounded-full transition-colors';
        const sizing = 'w-6 h-6';

        const classes = current
          ? `${base} ${sizing} bg-primary text-white ring-2 ring-primary/30`
          : done
            ? `${base} ${sizing} bg-primary/10 text-primary hover:bg-primary/20`
            : `${base} ${sizing} bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed`;

        const label = `Step ${i + 1} of ${WIZARD_STEPS.length}: ${step.label}`;

        const content = done && !current ? (
          <Check className="w-3 h-3" aria-hidden="true" />
        ) : (
          <span>{i + 1}</span>
        );

        if (clickable && !current) {
          return (
            <Link
              key={step.slug}
              href={step.path}
              className={classes}
              aria-label={label}
              title={step.label}
            >
              {content}
            </Link>
          );
        }
        return (
          <span
            key={step.slug}
            className={classes}
            aria-label={label}
            aria-current={current ? 'step' : undefined}
            title={step.label}
          >
            {content}
          </span>
        );
      })}
    </nav>
  );
}
