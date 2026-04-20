'use client';

import * as React from 'react';
import { TableSkeleton } from './table-skeleton';
import { EmptyState, type EmptyStateProps } from './empty-state';

export interface DataTableColumn<T> {
  key: string;
  label: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  loading?: boolean;
  empty?: EmptyStateProps;
  rowKey?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  loadingRows?: number;
  className?: string;
}

function alignClass(align?: 'left' | 'right' | 'center') {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

export function DataTable<T>({
  columns,
  rows,
  loading = false,
  empty,
  rowKey,
  onRowClick,
  loadingRows = 6,
  className = '',
}: DataTableProps<T>) {
  const widths = columns.map((c) => c.width ?? '');

  return (
    <div className={['overflow-x-auto', className].filter(Boolean).join(' ')}>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  'px-4 py-3',
                  alignClass(col.align),
                  col.headerClassName ?? '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={col.width ? { width: col.width } : undefined}
                scope="col"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <TableSkeleton
              rows={loadingRows}
              columnWidths={widths.map((w) => w || '40%')}
            />
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8">
                {empty ? (
                  <EmptyState {...empty} />
                ) : (
                  <p className="text-center text-sm text-gray-400 dark:text-gray-500">
                    No results
                  </p>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const key = rowKey ? rowKey(row, idx) : String(idx);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={[
                    'border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                    onRowClick
                      ? 'cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-800/60'
                      : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/60',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        'px-4 py-3',
                        alignClass(col.align),
                        col.cellClassName ?? '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {col.render
                        ? col.render(row, idx)
                        : ((row as unknown as Record<string, React.ReactNode>)[
                            col.key
                          ] ?? null)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
