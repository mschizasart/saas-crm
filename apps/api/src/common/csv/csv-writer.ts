/**
 * Minimal RFC-4180 CSV writer.
 *
 * Used by the per-entity `GET /<entity>/export` routes to build downloadable
 * CSVs that Excel, Google Sheets, and Numbers will open cleanly.
 *
 * Design choices:
 * - Fields that contain `,`, `"`, `\r`, or `\n` are wrapped in double quotes;
 *   embedded `"` is escaped by doubling (`""`). Everything else is written raw.
 * - Rows are separated by `\r\n` (RFC-4180's "shall" line terminator) so that
 *   Excel on Windows parses the file identically to macOS/Linux.
 * - A UTF-8 BOM (\ufeff) is prepended to the output. Without this, Excel
 *   opens non-ASCII characters (é, €, ö, …) as mojibake. The BOM is invisible
 *   to every modern CSV reader we care about.
 * - Null/undefined values render as empty strings.
 * - Dates are formatted as ISO YYYY-MM-DD (no timezone drift). Numbers are
 *   written as-is via String(). Booleans render as `Yes`/`No`.
 * - Objects/arrays (if they somehow slip into a cell) are JSON.stringify'd so
 *   the output is still valid CSV.
 */

export interface CsvColumn {
  /** Key on the row object to pull the value from. Supports dotted paths, e.g. `client.company`. */
  key: string;
  /** Header label written on row 1. */
  label: string;
  /** Optional formatter override (given the raw value, returns the string to write). */
  format?: (value: any, row: any) => string;
}

export interface BuildCsvInput {
  columns: CsvColumn[];
  rows: any[];
}

const NEEDS_QUOTE_RE = /[",\r\n]/;

function pickByPath(row: any, path: string): any {
  if (row == null) return undefined;
  if (!path.includes('.')) return row[path];
  let cur: any = row;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function defaultFormat(value: any): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'object') {
    // Decimal (Prisma) exposes toString; fall back to JSON for unknown objects.
    if (typeof (value as any).toString === 'function' && (value as any).toString !== Object.prototype.toString) {
      const s = (value as any).toString();
      if (s !== '[object Object]') return s;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeField(raw: string): string {
  if (raw === '') return '';
  if (!NEEDS_QUOTE_RE.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV string with a UTF-8 BOM and CRLF line terminators.
 */
export function buildCsv({ columns, rows }: BuildCsvInput): string {
  const out: string[] = [];

  // Header row
  out.push(columns.map((c) => escapeField(c.label)).join(','));

  // Data rows
  for (const row of rows) {
    const line = columns
      .map((col) => {
        const raw = pickByPath(row, col.key);
        const formatted = col.format ? col.format(raw, row) : defaultFormat(raw);
        return escapeField(formatted ?? '');
      })
      .join(',');
    out.push(line);
  }

  return '\ufeff' + out.join('\r\n');
}

/**
 * Build a conventional filename `<entity>-<YYYY-MM-DD>.csv`.
 */
export function csvFilename(entity: string, date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `${entity}-${iso}.csv`;
}

/**
 * Maximum rows returned from an export endpoint. If the underlying query would
 * exceed this, the caller should set the `X-Export-Truncated` response header
 * and log a warning. Kept generous (10k) so typical SMB tenants never hit it.
 */
export const EXPORT_ROW_CAP = 10000;
