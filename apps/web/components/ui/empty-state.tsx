'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from './button';

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  const classes = [
    'flex flex-col items-center justify-center text-center py-12 px-6 gap-3',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const actionVariant = action?.variant ?? 'primary';

  return (
    <div className={classes}>
      {icon ? (
        <div className="text-gray-400 dark:text-gray-500 opacity-70" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {description ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">{description}</p>
      ) : null}
      {action ? (
        action.href ? (
          <Link
            href={action.href}
            className={
              actionVariant === 'primary'
                ? 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90'
                : 'inline-flex items-center gap-1.5 transition-colors rounded-lg font-medium px-4 py-2 text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 bg-white dark:bg-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800'
            }
          >
            {action.label}
          </Link>
        ) : (
          <Button variant={actionVariant} onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}

export default EmptyState;
