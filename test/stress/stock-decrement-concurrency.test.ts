/**
 * Stress scenario: stock decrement under concurrent invoice send.
 *
 * 50 invoices, each referencing the same product (1 unit). Product
 * starts with 30 units of stock. We POST /invoices/:id/send for all 50
 * concurrently.
 *
 * Asserts: the FINAL stockQuantity is deterministic across runs.
 *   - Acceptable end-states are 0 (decrement was clamped at zero) or
 *     -20 (oversells were allowed by design).
 *   - The unacceptable failure is *non-determinism*: two runs producing
 *     two different non-equal end states would mean the stock-movement
 *     write is racy (e.g. UPDATE without WHERE locking, or a SELECT
 *     ...; UPDATE pattern with no row-level lock).
 *
 * Because we can only run once per invocation, this scenario:
 *   - Reads the initial stock.
 *   - Fans out the 50 sends.
 *   - Reads the final stock.
 *   - Computes the *expected band* and compares.
 *   - Sums the recorded stock movements; their sum should equal
 *     (initial - final) exactly.
 *
 * If sum-of-movements != initial-final, that's the smoking gun for a
 * race in the stock-movement insert.
 */
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';

const INITIAL_STOCK = 30;
const INVOICES = 50;

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'stock-decrement-concurrency',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // 1. Create a product with INITIAL_STOCK.
  const productRes = await fetch(`${STRESS_API_URL}/api/v1/products`, {
    method: 'POST',
    headers: bearer(tokens.tokenA),
    body: JSON.stringify({
      name: `stress-stock-${Date.now()}`,
      sku: `SS-${Date.now()}`,
      price: 1,
      stockQuantity: INITIAL_STOCK,
      trackStock: true,
    }),
  });
  if (productRes.status < 200 || productRes.status >= 300) {
    return finish({
      name: 'stock-decrement-concurrency',
      passed: false,
      skipped: true,
      skipReason: `Could not create product: ${productRes.status}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }
  const product = (await productRes.json()) as any;

  // 2. Find or create a client.
  const clientList = await fetch(`${STRESS_API_URL}/api/v1/clients?limit=1`, {
    headers: bearer(tokens.tokenA),
  });
  const clientBody = (await clientList.json().catch(() => ({}))) as any;
  let clientId = clientBody?.data?.[0]?.id;
  if (!clientId) {
    const created = await fetch(`${STRESS_API_URL}/api/v1/clients`, {
      method: 'POST',
      headers: bearer(tokens.tokenA),
      body: JSON.stringify({ name: `stock-test-client-${Date.now()}` }),
    });
    clientId = ((await created.json().catch(() => ({}))) as any)?.id;
  }
  if (!clientId) {
    return finish({
      name: 'stock-decrement-concurrency',
      passed: false,
      skipped: true,
      skipReason: 'Could not find or create a client',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // 3. Create 50 invoices each with 1 unit of the product.
  const invoiceIds: string[] = [];
  for (let i = 0; i < INVOICES; i++) {
    const r = await fetch(`${STRESS_API_URL}/api/v1/invoices`, {
      method: 'POST',
      headers: bearer(tokens.tokenA),
      body: JSON.stringify({
        clientId,
        items: [
          { productId: product.id, quantity: 1, unitPrice: 1, description: 'stress' },
        ],
      }),
    });
    const body = (await r.json().catch(() => ({}))) as any;
    if (body?.id) invoiceIds.push(body.id);
  }

  if (invoiceIds.length < INVOICES * 0.6) {
    return finish({
      name: 'stock-decrement-concurrency',
      passed: false,
      skipped: true,
      skipReason: `Could only create ${invoiceIds.length}/${INVOICES} invoices`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // 4. Concurrent sends.
  const sendStatuses = await Promise.all(
    invoiceIds.map((id) =>
      fetch(`${STRESS_API_URL}/api/v1/invoices/${id}/send`, {
        method: 'POST',
        headers: bearer(tokens.tokenA),
        body: JSON.stringify({}),
      })
        .then((r) => r.status)
        .catch(() => 0),
    ),
  );

  // Settle.
  await new Promise((r) => setTimeout(r, 1000));

  // 5. Read final stock.
  const finalRes = await fetch(`${STRESS_API_URL}/api/v1/products/${product.id}`, {
    headers: bearer(tokens.tokenA),
  });
  const finalBody = (await finalRes.json().catch(() => ({}))) as any;
  const finalStock = Number(finalBody?.stockQuantity ?? NaN);

  // 6. Read movements.
  const movRes = await fetch(
    `${STRESS_API_URL}/api/v1/products/${product.id}/stock/movements?limit=200`,
    { headers: bearer(tokens.tokenA) },
  );
  const movBody = (await movRes.json().catch(() => ({}))) as any;
  const movements: any[] = movBody?.data ?? movBody ?? [];
  const sumDeltas = movements.reduce(
    (acc, m) => acc + Number(m?.delta ?? m?.quantity ?? 0),
    0,
  );

  // 7. Cross-check: stock change must equal sum of movement deltas.
  const observedDelta = INITIAL_STOCK - finalStock;
  const movementsConsistent = sumDeltas === -observedDelta || sumDeltas === observedDelta;
  // Some schemas store the delta as a signed delta (negative), some as a
  // positive quantity with a separate "type". Accept either sign.

  // Acceptable final stock states: 0 (clamped) OR -20 (oversells allowed)
  // OR INITIAL_STOCK - successful_sends if sends were partially rejected.
  const successfulSends = sendStatuses.filter((s) => s >= 200 && s < 300).length;
  const acceptableFinals = new Set<number>([
    0,
    INITIAL_STOCK - INVOICES, // -20 oversell case
    INITIAL_STOCK - successfulSends, // partial-reject case
  ]);

  const finalStockAcceptable = acceptableFinals.has(finalStock);

  const passed = !Number.isNaN(finalStock) && finalStockAcceptable && movementsConsistent;

  const failure = passed
    ? undefined
    : [
        Number.isNaN(finalStock) && 'Could not read final stock',
        !finalStockAcceptable &&
          `Final stock ${finalStock} not in acceptable set ${[...acceptableFinals]} — non-deterministic race likely.`,
        !movementsConsistent &&
          `Sum of movement deltas (${sumDeltas}) inconsistent with stock change (${observedDelta}).`,
      ]
        .filter(Boolean)
        .join('; ');

  return finish({
    name: 'stock-decrement-concurrency',
    passed,
    failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      productId: product.id,
      initialStock: INITIAL_STOCK,
      invoicesCreated: invoiceIds.length,
      sendStatusCounts: tally(sendStatuses),
      successfulSends,
      finalStock,
      acceptableFinals: [...acceptableFinals],
      movementCount: movements.length,
      sumDeltas,
      observedDelta,
    },
  });
}

function tally(arr: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of arr) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

