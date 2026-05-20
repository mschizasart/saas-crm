'use client';

// Shared chrome bits for the wizard steps — header + footer button row.
// Kept in `_components.tsx` (underscore prefix) so Next.js doesn't treat
// the file as a route.

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function StepHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function WizardFooter({
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  continueLoading,
}: {
  onBack?: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  continueLoading?: boolean;
}) {
  return (
    <div className="mt-10 flex items-center justify-between gap-3 max-w-xl">
      {onBack ? (
        <Button
          variant="ghost"
          onClick={onBack}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button variant="secondary" onClick={onSkip}>
            Skip — I&apos;ll do this later
          </Button>
        )}
        <Button
          variant="primary"
          onClick={onContinue}
          loading={continueLoading}
          icon={!continueLoading ? <ArrowRight className="w-4 h-4" /> : undefined}
        >
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
