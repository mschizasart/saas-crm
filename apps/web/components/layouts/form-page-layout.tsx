'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { containerWidth, spacing, typography } from '@/lib/ui-tokens';

export interface FormPageLayoutProps {
  title: string;
  /** "← Back" link at the top. */
  backHref?: string;
  /** Defaults to "Back". */
  backLabel?: string;
  /** Form fields, wrapped in a Card inside. */
  children: React.ReactNode;
  /** Save/cancel buttons — rendered below the Card. */
  footer?: React.ReactNode;
  /** If set, wraps children in a <form onSubmit={...}>. */
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
}

export function FormPageLayout({
  title,
  backHref,
  backLabel = 'Back',
  children,
  footer,
  onSubmit,
  className = '',
}: FormPageLayoutProps) {
  const wrapperClasses = [
    containerWidth.form,
    'mx-auto',
    spacing.sectionGap,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <Card padding="lg">{children}</Card>
      {footer ? <div className="flex items-center justify-end gap-2">{footer}</div> : null}
    </>
  );

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

      <h1 className={typography.h2}>{title}</h1>

      {onSubmit ? (
        <form onSubmit={onSubmit} className={spacing.sectionGap}>
          {body}
        </form>
      ) : (
        body
      )}
    </div>
  );
}

export default FormPageLayout;
