import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, STATUS_VARIANT_MAP } from './status-badge';

describe('StatusBadge component', () => {
  it('renders known statuses with the matching variant class', () => {
    const { rerender } = render(<StatusBadge status="paid" />);
    let badge = screen.getByText('Paid');
    // success variant -> green-100 / green-700
    expect(badge.className).toContain('bg-green-100');

    rerender(<StatusBadge status="overdue" />);
    badge = screen.getByText('Overdue');
    expect(badge.className).toContain('bg-red-100');

    rerender(<StatusBadge status="open" />);
    badge = screen.getByText('Open');
    expect(badge.className).toContain('bg-blue-100');
  });

  it('formats labels by splitting/capitalising the status key', () => {
    render(<StatusBadge status="in_progress" />);
    // DEFAULT_LABELS has explicit "In progress" mapping
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('capitalises generic statuses without an explicit label', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('falls back to the default variant for an unknown status', () => {
    render(<StatusBadge status="zonk" />);
    const badge = screen.getByText('Zonk');
    // default variant uses gray-100
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-700');
  });

  it('honours an explicit label prop over the auto-formatted one', () => {
    render(<StatusBadge status="paid" label="All settled up" />);
    expect(screen.getByText('All settled up')).toBeInTheDocument();
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
  });

  it('is case-insensitive on the status key', () => {
    render(<StatusBadge status="PAID" />);
    const badge = screen.getByText('Paid');
    expect(badge.className).toContain('bg-green-100');
  });

  it('exposes a STATUS_VARIANT_MAP with the documented keys', () => {
    expect(STATUS_VARIANT_MAP.paid).toBe('success');
    expect(STATUS_VARIANT_MAP.overdue).toBe('error');
    expect(STATUS_VARIANT_MAP.cancelled).toBe('muted');
    expect(STATUS_VARIANT_MAP.canceled).toBe('muted');
  });
});
