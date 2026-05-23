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
 * TaxJar provider — raw `fetch`, no SDK dependency (matches the AI module's
 * style). Fully implemented.
 *
 * Endpoint: POST https://api.taxjar.com/v2/taxes
 * Auth:     Authorization: Bearer <api_token>
 * Docs:     https://developer.taxjar.com/api/reference/#post-calculate-sales-tax-for-an-order
 *
 * TaxJar returns `tax.amount_to_collect` (the total tax) and `tax.rate`
 * (the combined effective rate as a FRACTION, e.g. 0.08875). We surface the
 * rate as a percentage to match how manual `Tax.rate` is stored.
 *
 * NOTE: TaxJar's `/v2/taxes` requires US/CA/EU/AU addresses with at least a
 * zip+country (US) or country (intl). When the address is incomplete the API
 * returns a 4xx, which we turn into a TaxProviderError so the caller can
 * degrade gracefully.
 */
export class TaxJarProvider implements TaxProvider {
  private static readonly ENDPOINT = 'https://api.taxjar.com/v2/taxes';

  constructor(private readonly apiToken: string) {}

  async calculate(input: TaxCalcInput): Promise<TaxCalcResult> {
    const lineSum = input.lineItems.reduce(
      (s, li) => s + (Number(li.amount) || 0),
      0,
    );
    const shipping = Number(input.shipping ?? 0) || 0;

    const body = {
      from_country: country(input.fromAddress),
      from_zip: input.fromAddress.zip ?? undefined,
      from_state: input.fromAddress.state ?? undefined,
      from_city: input.fromAddress.city ?? undefined,
      from_street: input.fromAddress.street ?? undefined,
      to_country: country(input.toAddress),
      to_zip: input.toAddress.zip ?? undefined,
      to_state: input.toAddress.state ?? undefined,
      to_city: input.toAddress.city ?? undefined,
      to_street: input.toAddress.street ?? undefined,
      amount: round2(lineSum),
      shipping: round2(shipping),
      line_items: input.lineItems.map((li, i) => ({
        id: li.ref ?? String(i + 1),
        quantity: li.quantity ?? 1,
        unit_price: round2(
          (Number(li.amount) || 0) / Math.max(1, li.quantity ?? 1),
        ),
      })),
    };

    let res: Response;
    try {
      res = await fetch(TaxJarProvider.ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // Bound the upstream call so a stalled TaxJar endpoint can't hang the
        // invoice create/update HTTP response. On timeout `fetch` rejects with
        // an AbortError, which lands in this catch and becomes a normal
        // TaxProviderError — the invoice-save path then degrades gracefully to
        // the manual/zero tax already persisted.
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      throw new TaxProviderError(
        `TaxJar request failed: ${(err as Error).message ?? err}`,
        undefined,
        'TAXJAR',
      );
    }

    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new TaxProviderError(
        `TaxJar ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        'TAXJAR',
      );
    }

    const data: any = await res.json();
    const tax = data?.tax;
    if (!tax || typeof tax.amount_to_collect !== 'number') {
      throw new TaxProviderError(
        'TaxJar returned an unexpected payload (no tax.amount_to_collect)',
        res.status,
        'TAXJAR',
      );
    }

    const taxAmount = round2(tax.amount_to_collect);
    // TaxJar `rate` is a fraction (0.08875). Convert to a percentage.
    const ratePct = round4((Number(tax.rate) || 0) * 100);

    const jurisdictions = buildJurisdictions(tax);

    return {
      taxAmount,
      rate: ratePct,
      breakdown: { jurisdictions, raw: tax },
    };
  }
}

function country(addr: TaxAddress): string {
  return (addr.country && addr.country.trim()) || 'US';
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/**
 * Flatten TaxJar's nested breakdown (state/county/city/special) into a flat
 * jurisdiction list. TaxJar nests these under `tax.breakdown`; not all are
 * present for every order.
 */
function buildJurisdictions(tax: any): TaxJurisdiction[] {
  const out: TaxJurisdiction[] = [];
  const bd = tax?.breakdown;
  if (!bd) return out;

  const push = (name: string, ratePart: any, amountPart: any, type: string) => {
    const amount = Number(amountPart);
    const rate = Number(ratePart);
    if (!amount && !rate) return;
    out.push({ name, rate: round4((rate || 0) * 100), amount: round2(amount || 0), type });
  };

  push('State', bd.state_tax_rate, bd.state_tax_collectable, 'state');
  push('County', bd.county_tax_rate, bd.county_tax_collectable, 'county');
  push('City', bd.city_tax_rate, bd.city_tax_collectable, 'city');
  push(
    'Special district',
    bd.special_district_tax_rate ?? bd.special_tax_rate,
    bd.special_district_tax_collectable ?? bd.special_tax_collectable,
    'special',
  );
  // EU / intl VAT lands under `country_tax_*`.
  push('Country / VAT', bd.country_tax_rate, bd.country_tax_collectable, 'country');

  return out;
}
