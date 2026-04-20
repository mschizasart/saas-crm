'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from './button';

export interface PageHeaderAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  backHref?: string;
  className?: string;
  children?: React.ReactNode;
}

function renderAction(action: PageHeaderAction, key?: React.Key) {
  const variant = action.variant ?? 'secondary';
  const sharedClass =
    variant === 'primary'
      ? 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90'
      : 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-4 py-2 text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 bg-white dark:bg-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800';

  if (action.href) {
    return (
      <Link key={key} href={action.href} className={sharedClass}>
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
      onClick={action.onClick}
      icon={action.icon}
      disabled={action.disabled}
    >
      {action.label}
    </Button>
  );
}

export function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  backHref,
  className = '',
  children,
}: PageHeaderProps) {
  const classes = [
    'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary mb-1 transition-colors"
          >
            <span aria-hidden="true">&larr;</span>
            Back
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {children}
        {secondaryActions?.map((a, i) => renderAction(a, `sec-${i}`))}
        {primaryAction ? renderAction({ ...primaryAction, variant: primaryAction.variant ?? 'primary' }, 'primary') : null}
      </div>
    </div>
  );
}

export default PageHeader;
