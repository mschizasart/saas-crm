import * as React from 'react';

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  columnWidths?: string[];
}

export function TableSkeleton({
  rows = 6,
  columns,
  columnWidths,
}: TableSkeletonProps) {
  const resolvedColumns = columns ?? columnWidths?.length ?? 5;
  const widths = columnWidths ?? [];

  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr
          key={r}
          className="border-b border-gray-100 dark:border-gray-800 last:border-0 animate-pulse"
        >
          {Array.from({ length: resolvedColumns }).map((__, c) => {
            const width = widths[c] ?? (c === 0 ? '60%' : '40%');
            return (
              <td key={c} className="px-4 py-3">
                <div
                  className="h-4 bg-gray-100 dark:bg-gray-800 rounded"
                  style={{ width }}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export default TableSkeleton;
