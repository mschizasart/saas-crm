/**
 * Provider-agnostic sales-tax / VAT calculation contract.
 *
 * Both TaxJarProvider and AvalaraProvider implement this so TaxConfigService
 * doesn't care which upstream it's talking to — it builds a TaxCalcInput from
 * the invoice + addresses and calls `calculate()`.
 *
 * Deliberately a single non-streaming "quote the tax for these lines"
 * call: it's the lowest common denominator across the TaxJar `/v2/taxes`
 * endpoint and the Avalara AvaTax `/transactions/create` endpoint, and it's
 * all the invoice integration needs.
 */

export interface TaxAddress {
  street?: string | null;
  city?: string | null;
  /** State / province / region code, e.g. "NY", "CA". */
  state?: string | null;
  zip?: string | null;
  /** ISO 3166-1 alpha-2 country code, e.g. "US", "GB". Defaults to "US". */
  country?: string | null;
}

export interface TaxLineItem {
  /** Line total (qty * rate), pre-tax, in the document currency. */
  amount: number;
  /** Quantity for this line. Defaults to 1. */
  quantity?: number;
  /** Opaque line reference (invoice item id) echoed back in the breakdown. */
  ref?: string;
}

export interface TaxCalcInput {
  fromAddress: TaxAddress;
  toAddress: TaxAddress;
  lineItems: TaxLineItem[];
  /** Optional shipping charge, taxed per the provider's rules. */
  shipping?: number;
}

/** A single jurisdiction's contribution to the total tax. */
export interface TaxJurisdiction {
  name: string;
  /** Rate as a fraction (0.04 = 4%) OR percentage — see `rate` on the result. */
  rate: number;
  amount: number;
  type?: string;
}

export interface TaxCalcResult {
  /** Total tax for the whole document, in the document currency. */
  taxAmount: number;
  /** Effective combined rate as a PERCENTAGE, e.g. 8.875. */
  rate: number;
  /** Jurisdiction breakdown + the raw upstream payload for the audit row. */
  breakdown: {
    jurisdictions: TaxJurisdiction[];
    /** Verbatim upstream response (trimmed) for debugging / audit. */
    raw?: unknown;
  };
}

export interface TaxProvider {
  calculate(input: TaxCalcInput): Promise<TaxCalcResult>;
}

/**
 * Thrown on a non-2xx upstream response (or transport failure). Carries the
 * upstream HTTP status + a (truncated) upstream message so the caller can
 * decide whether to surface the error or degrade gracefully to manual/zero
 * tax. Mirrors AiProviderError in the AI module.
 */
export class TaxProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = 'TaxProviderError';
  }
}

/** Best-effort body read that never throws. */
export async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
