'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageHeader, type PageHeaderAction } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { spacing } from '@/lib/ui-tokens';

export interface ComplexFormPageLayoutProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Back-link target. */
  backHref?: string;
  /** Defaults to "Back". */
  backLabel?: string;
  /** Right-aligned header action buttons (Save / Send / Cancel etc.). */
  actions?: PageHeaderAction[];
  /**
   * Alternate location for a Save/Cancel bar — rendered below children
   * with a top border.
   */
  footer?: React.ReactNode;
  /**
   * Pages supply their own Cards / grids / sections; the layout does
   * NOT wrap children in a Card.
   */
  children: React.ReactNode;
  className?: string;
  /** Override max-width (default: `max-w-6xl`). */
  widthClass?: string;
}

function renderHeaderAction(action: PageHeaderAction, key: React.Key) {
  const variant = action.variant ?? 'secondary';

  if (action.href) {
    const base =
      variant === 'primary'
        ? 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-3 py-1.5 text-xs bg-primary text-white hover:bg-primary/90'
        : 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-3 py-1.5 text-xs border border-gray-200 text-gray-700 hover:bg-gray-50 bg-white dark:bg-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800';
    return (
      <Link key={key} href={action.href} className={base}>
        {action.icon ? (
          <span className="inline-flex items-center" aria-hidden="true">
            {action.icon}
          </span>
        ) : null}
        {action.label}
      </Link>
    );
  }

  return (
    <Button
      key={key}
      variant={variant}
      size="sm"
      onClick={action.onClick}
      icon={action.icon}
      disabled={action.disabled}
    >
      {action.label}
    </Button>
  );
}

export function ComplexFormPageLayout({
  title,
  subtitle,
  backHref,
  backLabel = 'Back',
  actions,
  footer,
  children,
  className = '',
  widthClass = 'max-w-6xl',
}: ComplexFormPageLayoutProps) {
  const wrapperClasses = [
    widthClass,
    'mx-auto',
    spacing.sectionGap,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary transition-colors"
        >
          <span aria-hidden="true">&larr;</span>
          {backLabel}
        </Link>
      ) : null}

      <PageHeader title={title} subtitle={subtitle} />

      {actions && actions.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions.map((a, i) => renderHeaderAction(a, `complex-action-${i}`))}
        </div>
      ) : null}

      {children}

      {footer ? (
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-800">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export default ComplexFormPageLayout;
