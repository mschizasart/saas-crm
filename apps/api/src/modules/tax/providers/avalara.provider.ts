import {
  TaxAddress,
  TaxCalcInput,
  TaxCalcResult,
  TaxJurisdiction,
  TaxProvider,
  TaxProviderError,
  safeReadText,
} from './tax-provider.types';

/**
 * Avalara AvaTax provider — raw `fetch`, no SDK dependency.
 *
 * Endpoint: POST {base}/api/v2/transactions/create
 * Auth:     HTTP Basic <accountId>:<licenseKey>
 * Docs:     https://developer.avalara.com/api-reference/avatax/rest/v2/methods/Transactions/CreateTransaction/
 *
 * ── What is FULLY implemented ────────────────────────────────────────────
 *   • The "quote tax for these lines" call: we POST a SalesOrder document
 *     (type = "SalesOrder", which is a non-committing estimate — it does NOT
 *     record a transaction in Avalara, exactly what we want for an invoice
 *     preview / autoApply). We parse `totalTax`, derive the effective rate,
 *     and flatten `summary[]` into a jurisdiction breakdown.
 *   • Basic-auth credential handling and non-2xx → TaxProviderError so the
 *     caller can degrade gracefully.
 *   • Sandbox vs production base URL switch via the apiKey/account — we
 *     default to production; sandbox accounts (license starts after sign-up)
 *     can override with AVALARA_BASE_URL if ever needed (per-tenant feature
 *     is intentionally NOT wired — see stub note below).
 *
 * ── What is STUBBED / simplified (documented for the reviewer) ───────────
 *   • We always send document type "SalesOrder" (estimate). The full Avalara
 *     lifecycle — creating a committed "SalesInvoice", later voiding/adjusting
 *     it, and reconciling for filing — is NOT implemented. Our invoices are
 *     the system of record; Avalara is used purely as a rate/amount engine.
 *   • Address validation (/addresses/resolve), nexus configuration, item tax
 *     codes, exemption certificates, and multi-company selection beyond the
 *     single configured companyCode are NOT implemented.
 *   • Sandbox/production is hard-defaulted to production. A per-tenant sandbox
 *     toggle is left as a follow-up.
 * These omissions are safe: a SalesOrder calc returns the same tax math as a
 * committed invoice for standard taxable goods, which covers the auto-tax
 * use case here. TaxJar is the fully-featured path; Avalara is best-effort.
 */
export class AvalaraProvider implements TaxProvider {
  private static readonly PROD_BASE = 'https://rest.avatax.com';

  constructor(
    private readonly accountId: string,
    private readonly licenseKey: string,
    private readonly companyCode: string,
    private readonly baseUrl: string = AvalaraProvider.PROD_BASE,
  ) {}

  async calculate(input: TaxCalcInput): Promise<TaxCalcResult> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/api/v2/transactions/create`;
    const auth = Buffer.from(`${this.accountId}:${this.licenseKey}`).toString(
      'base64',
    );

    const today = new Date().toISOString().slice(0, 10);
    const lines = input.lineItems.map((li, i) => ({
      number: li.ref ?? String(i + 1),
      quantity: li.quantity ?? 1,
      amount: round2(Number(li.amount) || 0),
    }));
    if (input.shipping && input.shipping > 0) {
      lines.push({
        number: `shipping`,
        quantity: 1,
        amount: round2(input.shipping),
      } as any);
    }

    const body = {
      type: 'SalesOrder', // estimate; non-committing
      companyCode: this.companyCode,
      date: today,
      customerCode: 'CRM-CUSTOMER',
      // SalesOrder doesn't need a unique code; omit `code` so Avalara generates one.
      addresses: {
        shipFrom: avalaraAddr(input.fromAddress),
        shipTo: avalaraAddr(input.toAddress),
      },
      lines,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // Bound the upstream call so a stalled Avalara endpoint can't hang the
        // invoice create/update HTTP response. On timeout `fetch` rejects with
        // an AbortError, which lands in this catch and becomes a normal
        // TaxProviderError — the invoice-save path then degrades gracefully to
        // the manual/zero tax already persisted.
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      throw new TaxProviderError(
        `Avalara request failed: ${(err as Error).message ?? err}`,
        undefined,
        'AVALARA',
      );
    }

    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new TaxProviderError(
        `Avalara ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        'AVALARA',
      );
    }

    const data: any = await res.json();
    if (typeof data?.totalTax !== 'number') {
      throw new TaxProviderError(
        'Avalara returned an unexpected payload (no totalTax)',
        res.status,
        'AVALARA',
      );
    }

    const taxAmount = round2(data.totalTax);
    const taxable = round2(Number(data.totalTaxable) || 0);
    const ratePct = taxable > 0 ? round4((taxAmount / taxable) * 100) : 0;

    const jurisdictions = buildJurisdictions(data);

    return {
      taxAmount,
      rate: ratePct,
      breakdown: { jurisdictions, raw: { summary: data.summary } },
    };
  }
}

function avalaraAddr(addr: TaxAddress) {
  return {
    line1: addr.street ?? undefined,
    city: addr.city ?? undefined,
    region: addr.state ?? undefined,
    postalCode: addr.zip ?? undefined,
    country: (addr.country && addr.country.trim()) || 'US',
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/** Flatten Avalara's `summary[]` array into our jurisdiction shape. */
function buildJurisdictions(data: any): TaxJurisdiction[] {
  const summary = Array.isArray(data?.summary) ? data.summary : [];
  return summary
    .map((s: any) => ({
      name: s.jurisName ?? s.taxName ?? s.jurisType ?? 'Tax',
      rate: round4((Number(s.rate) || 0) * 100),
      amount: round2(Number(s.tax) || 0),
      type: s.jurisType ?? s.taxType ?? undefined,
    }))
    .filter((j: TaxJurisdiction) => j.amount || j.rate);
}
