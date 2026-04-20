'use client';

import * as React from 'react';

export const inputClass =
  'w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed';

export interface FormFieldProps {
  label?: React.ReactNode;
  required?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  label,
  required = false,
  error,
  hint,
  htmlFor,
  className = '',
  children,
}: FormFieldProps) {
  const autoId = React.useId();
  const baseId = htmlFor ?? autoId;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // Try to clone the child input to attach aria attributes + id.
  let enhancedChild: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<
      Record<string, unknown> & { id?: string }
    >;
    const existingDescribed = (child.props['aria-describedby'] as
      | string
      | undefined) ?? undefined;
    const mergedDescribed =
      [existingDescribed, describedBy].filter(Boolean).join(' ') || undefined;

    enhancedChild = React.cloneElement(child, {
      id: child.props.id ?? baseId,
      'aria-invalid': error ? true : (child.props['aria-invalid'] as boolean | undefined),
      'aria-required': required || (child.props['aria-required'] as boolean | undefined),
      'aria-describedby': mergedDescribed,
    } as Record<string, unknown>);
  }

  return (
    <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')}>
      {label ? (
        <label
          htmlFor={baseId}
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
          {required ? (
            <span className="text-red-500 ml-0.5" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {enhancedChild}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default FormField;
