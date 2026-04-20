import * as React from 'react';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dotOnly?: boolean;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default:
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  success:
    'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  warning:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  error:
    'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  info:
    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  muted:
    'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-gray-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  muted: 'bg-gray-400',
};

const BASE_CLASSES =
  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';

export function Badge({
  variant = 'default',
  dotOnly = false,
  className = '',
  children,
  ...rest
}: BadgeProps) {
  if (dotOnly) {
    const dotClass = [
      'inline-block w-2.5 h-2.5 rounded-full flex-shrink-0',
      DOT_CLASSES[variant],
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return <span className={dotClass} aria-hidden="true" {...rest} />;
  }

  const classes = [BASE_CLASSES, VARIANT_CLASSES[variant], className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

export default Badge;
