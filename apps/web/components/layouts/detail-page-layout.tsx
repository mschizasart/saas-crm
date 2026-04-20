'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageHeader, type PageHeaderAction } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { containerWidth, spacing } from '@/lib/ui-tokens';

export interface DetailPageBreadcrumb {
  label: string;
  href?: string;
}

export interface DetailPageLayoutProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: DetailPageBreadcrumb[];
  /** Status badge rendered inline with the title. */
  badge?: React.ReactNode;
  /** Action bar — a list of buttons rendered with small Button variants. */
  actions?: PageHeaderAction[];
  /** Right-hand column (client info, stats, etc.). */
  sidebar?: React.ReactNode;
  /** Main detail content (tabs, sections). */
  children: React.ReactNode;
  className?: string;
}

function renderActionButton(action: PageHeaderAction, key: React.Key) {
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

export function DetailPageLayout({
  title,
  subtitle,
  breadcrumbs,
  badge,
  actions,
  sidebar,
  children,
  className = '',
}: DetailPageLayoutProps) {
  const wrapperClasses = [
    containerWidth.detail,
    'mx-auto',
    spacing.sectionGap,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const titleNode = badge ? (
    <span className="inline-flex items-center gap-2">
      <span>{title}</span>
      <span className="inline-flex items-center">{badge}</span>
    </span>
  ) : (
    title
  );

  return (
    <div className={wrapperClasses}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 dark:text-gray-400">
          <ol className="flex items-center gap-1 flex-wrap">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
                  {crumb.href && !isLast ? (
                    <Link href={crumb.href} className="hover:text-primary transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? 'text-gray-700 dark:text-gray-300' : ''}>{crumb.label}</span>
                  )}
                  {!isLast ? <span aria-hidden="true">/</span> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <PageHeader title={titleNode} subtitle={subtitle} />

      {actions && actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((a, i) => renderActionButton(a, `detail-action-${i}`))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={sidebar ? 'md:col-span-2' : 'md:col-span-3'}>{children}</div>
        {sidebar ? <aside className="md:col-span-1">{sidebar}</aside> : null}
      </div>
    </div>
  );
}

export default DetailPageLayout;
