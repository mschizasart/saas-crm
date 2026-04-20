'use client';

import * as React from 'react';
import { AlertCircle, X } from 'lucide-react';

export interface ErrorBannerProps {
  message: React.ReactNode;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
  className = '',
}: ErrorBannerProps) {
  const classes = [
    'flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="alert">
      <AlertCircle
        className="w-4 h-4 mt-0.5 flex-shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium underline hover:no-underline flex-shrink-0"
        >
          Retry
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="text-red-400 hover:text-red-600 dark:text-red-300/70 dark:hover:text-red-200 flex-shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default ErrorBanner;
