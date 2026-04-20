'use client';

import * as React from 'react';
import { PageHeader, type PageHeaderAction } from '@/components/ui/page-header';
import { containerWidth, spacing } from '@/lib/ui-tokens';

export interface ListPageLayoutProps {
  title: string;
  subtitle?: string;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  /** Search input, filter chips, tabs — rendered under the header, above the content. */
  filters?: React.ReactNode;
  /** The table / cards / kanban etc. */
  children: React.ReactNode;
  /** Bottom pagination — renders under the content. */
  pagination?: React.ReactNode;
  className?: string;
  /** When true, the content area stretches to fill available vertical space — needed for kanban boards. */
  fullHeight?: boolean;
}

export function ListPageLayout({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  filters,
  children,
  pagination,
  className = '',
  fullHeight = false,
}: ListPageLayoutProps) {
  const wrapperClasses = [
    containerWidth.list,
    spacing.sectionGap,
    fullHeight ? 'flex flex-col h-full min-h-0' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />

      {filters ? <div className="mb-4">{filters}</div> : null}

      <div className={fullHeight ? 'flex-1 min-h-0' : ''}>{children}</div>

      {pagination ? <div>{pagination}</div> : null}
    </div>
  );
}

export default ListPageLayout;
