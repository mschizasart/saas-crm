'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { containerWidth, spacing, typography } from '@/lib/ui-tokens';

export interface SettingsPageLayoutProps {
  title: string;
  description?: string;
  /** Multiple <SettingsSection> blocks usually. */
  children: React.ReactNode;
  className?: string;
}

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Save button row — rendered below a divider. */
  footer?: React.ReactNode;
  className?: string;
}

export function SettingsPageLayout({
  title,
  description,
  children,
  className = '',
}: SettingsPageLayoutProps) {
  const wrapperClasses = [
    containerWidth.settings,
    'mx-auto',
    spacing.sectionGap,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <div>
        <h1 className={typography.h2}>{title}</h1>
        {description ? (
          <p className={`${typography.bodyMuted} mt-1`}>{description}</p>
        ) : null}
      </div>

      <div className={spacing.sectionGap}>{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  footer,
  className = '',
}: SettingsSectionProps) {
  return (
    <Card padding="none" className={className}>
      <div className="p-6 border-b border-gray-100 dark:border-gray-800">
        <h2 className={typography.h3}>{title}</h2>
        {description ? (
          <p className={`${typography.bodyMuted} mt-1`}>{description}</p>
        ) : null}
      </div>

      <div className="p-6">{children}</div>

      {footer ? (
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/60 flex items-center justify-end gap-2">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export default SettingsPageLayout;
