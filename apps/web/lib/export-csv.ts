/**
 * Shared helper for admin list-page CSV exports.
 *
 * Each admin list page has an "Export CSV" secondary action that calls this
 * helper. It hits the entity's `GET /api/v1/<entity>/export` route with the
 * currently applied filters, receives a text/csv blob, and triggers a browser
 * download via an anchor element.
 *
 * We deliberately use `fetch` + manual Authorization header instead of the
 * standard `apiFetch()` wrapper — `apiFetch` is fine for JSON, but for binary
 * streaming we want full control of the Response object so we can read the
 * `X-Export-Count` / `X-Export-Truncated` headers and hand the blob straight
 * to the DOM. (Same pattern as the bulk-PDF download on the invoices page.)
 */
import { toast } from 'sonner';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Firefox has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ExportCsvOptions {
  /** Noun shown in toasts, e.g. "clients", "invoices". Falls back to "rows". */
  entityLabel?: string;
  /** Override the label shown in the success toast. */
  successMessage?: (count: number | null, truncated: boolean) => string;
}

/**
 * Download a CSV from an `/export` endpoint.
 *
 * @param path      e.g. `/api/v1/clients/export?search=acme`
 * @param filename  e.g. `clients-2026-04-23.csv`
 */
export async function exportCsv(
  path: string,
  filename: string,
  opts: ExportCsvOptions = {},
): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    toast.error('Not signed in — refresh and try again');
    return;
  }

  const entityLabel = opts.entityLabel ?? 'rows';
  const url = buildUrl(path);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/csv',
      },
    });

    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      // Try to surface a JSON error body if the API returned one
      try {
        const body = await res.json();
        if (body?.message) msg = String(body.message);
      } catch {
        /* body wasn't JSON — keep the status-code message */
      }
      toast.error(msg);
      return;
    }

    const blob = await res.blob();

    // Prefer the server-set row count; fall back to `null` if absent.
    const countHeader = res.headers.get('X-Export-Count');
    const truncatedHeader = res.headers.get('X-Export-Truncated');
    const count = countHeader ? Number(countHeader) : null;
    const truncated = truncatedHeader === 'true' || truncatedHeader === '1';

    triggerDownload(blob, filename);

    if (opts.successMessage) {
      toast.success(opts.successMessage(count, truncated));
    } else if (count != null && Number.isFinite(count)) {
      toast.success(`Exported ${count.toLocaleString()} ${entityLabel}`, {
        description: truncated
          ? 'Result was capped at 10,000 rows — narrow the filter to export the rest.'
          : undefined,
      });
    } else {
      toast.success('Export downloaded', {
        description: truncated ? 'Result was capped at 10,000 rows.' : undefined,
      });
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Export failed');
  }
}
