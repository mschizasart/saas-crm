import * as React from 'react';
import { Badge, type BadgeVariant } from './badge';

export const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  // invoices / billing
  draft: 'default',
  sent: 'info',
  paid: 'success',
  overdue: 'error',
  cancelled: 'muted',
  canceled: 'muted',

  // subscriptions
  active: 'success',
  paused: 'warning',

  // proposals / estimates
  accepted: 'success',
  declined: 'error',
  rejected: 'error',
  expired: 'muted',

  // tickets
  open: 'info',
  closed: 'muted',
  in_progress: 'warning',
  pending: 'warning',
  resolved: 'success',

  // leads / deals
  won: 'success',
  lost: 'error',

  // generic
  inactive: 'muted',
  completed: 'success',
  failed: 'error',
  processing: 'info',
  scheduled: 'info',
};

const DEFAULT_LABELS: Record<string, string> = {
  in_progress: 'In progress',
};

function formatLabel(status: string) {
  if (DEFAULT_LABELS[status]) return DEFAULT_LABELS[status];
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

export interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const key = (status || '').toLowerCase();
  const variant = STATUS_VARIANT_MAP[key] ?? 'default';
  return (
    <Badge variant={variant} className={className}>
      {label ?? formatLabel(status)}
    </Badge>
  );
}

export default StatusBadge;
