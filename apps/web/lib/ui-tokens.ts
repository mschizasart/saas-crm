import { STATUS_VARIANT_MAP } from '@/components/ui/status-badge';
import type { BadgeVariant } from '@/components/ui/badge';

/**
 * Shared typography aliases for consistent text styling.
 * Prefer these over ad-hoc className strings.
 */
export const typography = {
  h1: 'text-3xl font-bold text-gray-900 dark:text-gray-100',
  h2: 'text-2xl font-bold text-gray-900 dark:text-gray-100',
  h3: 'text-lg font-semibold text-gray-900 dark:text-gray-100',
  body: 'text-sm text-gray-700 dark:text-gray-300',
  bodyMuted: 'text-sm text-gray-500 dark:text-gray-400',
  caption: 'text-xs text-gray-500 dark:text-gray-400',
  label: 'text-sm font-medium text-gray-700 dark:text-gray-300',
} as const;

export type TypographyKey = keyof typeof typography;

/**
 * Max-width wrappers for common page layouts.
 */
export const containerWidth = {
  form: 'max-w-3xl',
  detail: 'max-w-6xl',
  list: '',
  settings: 'max-w-4xl',
} as const;

export type ContainerWidthKey = keyof typeof containerWidth;

/**
 * Standard spacing hooks for page-level layout.
 */
export const spacing = {
  pageY: 'py-6',
  sectionGap: 'space-y-6',
  fieldGap: 'gap-4',
} as const;

/**
 * Status string -> Badge variant mapping.
 *
 * Re-exported from `components/ui/status-badge.tsx` so both the typed
 * StatusBadge wrapper and the token registry share a single source of truth.
 */
export const statusColors: Record<string, BadgeVariant> = STATUS_VARIANT_MAP;
