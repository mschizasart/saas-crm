import * as React from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export function Card({
  padding = 'none',
  className = '',
  children,
  ...rest
}: CardProps) {
  const classes = [
    'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden',
    PADDING_CLASSES[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export interface CardSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export function CardHeader({
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardSectionProps) {
  const classes = [
    'border-b border-gray-100 dark:border-gray-800',
    PADDING_CLASSES[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardSectionProps) {
  const classes = [PADDING_CLASSES[padding], className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardSectionProps) {
  const classes = [
    'border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/60',
    PADDING_CLASSES[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export default Card;
