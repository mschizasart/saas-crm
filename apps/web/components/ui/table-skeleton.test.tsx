import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TableSkeleton } from './table-skeleton';

function renderInTable(ui: React.ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>,
  );
}

describe('TableSkeleton component', () => {
  it('renders 6 rows by default', () => {
    const { container } = renderInTable(<TableSkeleton />);
    const rows = container.querySelectorAll('tr');
    expect(rows.length).toBe(6);
  });

  it('renders the requested number of rows', () => {
    const { container } = renderInTable(<TableSkeleton rows={3} />);
    expect(container.querySelectorAll('tr').length).toBe(3);
  });

  it('renders the requested number of columns when columns prop is set', () => {
    const { container } = renderInTable(<TableSkeleton rows={1} columns={4} />);
    expect(container.querySelectorAll('td').length).toBe(4);
  });

  it('falls back to 5 columns when neither columns nor columnWidths are provided', () => {
    const { container } = renderInTable(<TableSkeleton rows={1} />);
    expect(container.querySelectorAll('td').length).toBe(5);
  });

  it('uses columnWidths.length as the column count when columns prop is omitted', () => {
    const { container } = renderInTable(
      <TableSkeleton rows={1} columnWidths={['25%', '50%', '25%']} />,
    );
    expect(container.querySelectorAll('td').length).toBe(3);
  });

  it('applies columnWidths to the inner skeleton bars', () => {
    const { container } = renderInTable(
      <TableSkeleton rows={1} columnWidths={['10%', '70%']} />,
    );
    const bars = container.querySelectorAll('td > div');
    expect(bars.length).toBe(2);
    expect((bars[0] as HTMLElement).style.width).toBe('10%');
    expect((bars[1] as HTMLElement).style.width).toBe('70%');
  });

  it('animates each row with animate-pulse', () => {
    const { container } = renderInTable(<TableSkeleton rows={2} />);
    container.querySelectorAll('tr').forEach((tr) => {
      expect(tr.className).toContain('animate-pulse');
    });
  });
});
