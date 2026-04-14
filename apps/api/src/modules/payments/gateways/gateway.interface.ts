export interface CreateCheckoutParams {
  invoiceId: string;
  amount: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface WebhookResult {
  invoiceId?: string;
  amount?: number;
  transactionId?: string;
  status: 'success' | 'failed' | 'pending';
}

export interface PaymentGateway {
  readonly name: string;

  // Create a checkout session for an invoice payment
  createCheckout(
    params: CreateCheckoutParams,
  ): Promise<{ checkoutUrl: string; sessionId: string }>;

  // Handle a webhook from the gateway (returns payment details if successful)
  handleWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookResult | null>;
}
