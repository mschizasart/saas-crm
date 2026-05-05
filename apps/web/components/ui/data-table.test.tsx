import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  age: number;
}

const baseColumns: Array<DataTableColumn<Row>> = [
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age', align: 'right' },
];

const rows: Row[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
];

describe('DataTable component', () => {
  it('renders the column headers', () => {
    render(<DataTable columns={baseColumns} rows={rows} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Age' })).toBeInTheDocument();
  });

  it('renders one row per data item with default column lookup', () => {
    render(<DataTable columns={baseColumns} rows={rows} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('uses a custom render function when provided', () => {
    const cols: Array<DataTableColumn<Row>> = [
      {
        key: 'name',
        label: 'Person',
        render: (r) => <strong data-testid={`person-${r.id}`}>{r.name.toUpperCase()}</strong>,
      },
    ];
    render(<DataTable columns={cols} rows={rows} />);
    expect(screen.getByTestId('person-1')).toHaveTextContent('ALICE');
    expect(screen.getByTestId('person-2')).toHaveTextContent('BOB');
  });

  it('fires onRowClick with the row when a row is clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={baseColumns} rows={rows} onRowClick={onRowClick} />);
    await user.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('renders the empty state when rows.length === 0', () => {
    render(
      <DataTable
        columns={baseColumns}
        rows={[]}
        empty={{ title: 'No people yet', description: 'Add one to begin.' }}
      />,
    );
    expect(screen.getByText('No people yet')).toBeInTheDocument();
    expect(screen.getByText('Add one to begin.')).toBeInTheDocument();
  });

  it('falls back to a generic "No results" when no empty prop is supplied', () => {
    render(<DataTable columns={baseColumns} rows={[]} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders the skeleton when loading', () => {
    const { container } = render(
      <DataTable columns={baseColumns} rows={[]} loading loadingRows={3} />,
    );
    // table-skeleton produces .animate-pulse cells
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // headers still rendered
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    // empty-state copy must NOT be visible while loading
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
  });

  it('uses the rowKey function when provided (no React key warnings)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <DataTable
        columns={baseColumns}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('applies right-alignment class when column align="right"', () => {
    const { container } = render(<DataTable columns={baseColumns} rows={rows} />);
    const ageHeader = screen.getByRole('columnheader', { name: 'Age' });
    expect(ageHeader.className).toContain('text-right');
    // first body cell of the second column
    const cells = container.querySelectorAll('tbody td');
    expect(cells[1].className).toContain('text-right');
  });
});
