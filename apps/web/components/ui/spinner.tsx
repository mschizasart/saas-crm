import * as React from 'react';
import { Loader2 } from 'lucide-react';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

export function Spinner({
  size = 'md',
  label,
  className = '',
  ...rest
}: SpinnerProps) {
  const classes = ['inline-flex items-center text-primary', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} role="status" {...rest}>
      <Loader2
        className={`${SIZE_CLASSES[size]} animate-spin`}
        aria-hidden="true"
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export default Spinner;
