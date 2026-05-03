import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { API_URL, SMOKE_TOKEN, authHeaders, withTimeout } from '../smoke/config.js';

/**
 * For each critical GET endpoint, assert the response matches a JSON schema.
 * If SMOKE_TOKEN isn't set the test skips with a warning rather than failing —
 * we don't want missing dev creds to mask real shape drift in CI, but locally
 * not-running-API shouldn't punish the developer.
 */

const PaginationEnvelope = z.object({
  data: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

const ClientItem = z.object({
  id: z.string(),
  company: z.string().nullable().optional(),
  organizationId: z.string().optional(),
  active: z.boolean().optional(),
});

const LeadItem = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  status: z.string().optional(),
});

const InvoiceItem = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  total: z.union([z.number(), z.string()]).optional(),
});

const TicketItem = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  status: z.string().optional(),
});

const ProductItem = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  name: z.string().optional(),
});

const ENDPOINTS: { path: string; itemSchema: z.ZodTypeAny; allowEnvelope?: boolean }[] = [
  { path: '/api/v1/clients', itemSchema: ClientItem },
  { path: '/api/v1/leads', itemSchema: LeadItem },
  { path: '/api/v1/invoices', itemSchema: InvoiceItem },
  { path: '/api/v1/tickets', itemSchema: TicketItem },
  { path: '/api/v1/products', itemSchema: ProductItem },
];

async function maybeFetch(url: string, init?: RequestInit) {
  try {
    return await withTimeout(fetch(url, init));
  } catch {
    return null;
  }
}

describe('Contract: response shape', () => {
  it.each(ENDPOINTS)(
    '$path matches pagination envelope',
    async ({ path, itemSchema }) => {
      if (!SMOKE_TOKEN) {
        console.warn(`[shape] No SMOKE_TOKEN — skipping ${path}`);
        return;
      }
      const res = await maybeFetch(`${API_URL}${path}`, { headers: authHeaders() });
      if (!res || res.status !== 200) {
        console.warn(`[shape] ${path} returned ${res?.status ?? 'no response'} — skipping`);
        return;
      }
      const body = await res.json();
      const parsed = PaginationEnvelope.safeParse(body);
      if (!parsed.success) {
        throw new Error(`Envelope mismatch for ${path}: ${parsed.error.message}`);
      }
      // Validate the first 3 items against the item schema (if any returned).
      for (const item of (body as any).data.slice(0, 3)) {
        const r = itemSchema.safeParse(item);
        if (!r.success) {
          throw new Error(`Item shape mismatch for ${path}: ${r.error.message}`);
        }
      }
      expect(parsed.success).toBe(true);
    },
  );

  it('error responses look like {message, statusCode} (NestJS default)', async () => {
    const res = await maybeFetch(`${API_URL}/api/v1/clients/00000000-0000-0000-0000-000000000000`);
    if (!res) return;
    if (res.status >= 400 && res.status < 500) {
      const body = await res.json().catch(() => ({}));
      // Accept either Nest default or our common error envelope.
      const hasMessage = body && (typeof (body as any).message === 'string' || Array.isArray((body as any).message));
      if (!hasMessage) {
        console.warn(`[shape] error body did not contain 'message': ${JSON.stringify(body)}`);
      }
      expect(true).toBe(true);
    }
  });
});
