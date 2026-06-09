'use client';

/**
 * New quote — Wave F2 (CPQ).
 *
 * Builds a draft quote: client + optional opportunity, line items (each line
 * is a Product OR a Bundle), an optional quote-level discount, and a total
 * preview. On submit POSTs to /quotes — the server recomputes everything,
 * so the on-screen totals are only an estimate (and the source of truth
 * after creation is the API response).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface ClientLite {
  id: string;
  company: string;
}
interface OpportunityLite {
  id: string;
  name: string;
  clientId: string | null;
}
interface ProductLite {
  id: string;
  name: string;
  unitPrice: number | string;
}
interface BundleLite {
  id: string;
  name: string;
}

interface LineInput {
  // exactly one of these is set
  productId?: string;
  bundleId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

function toNum(v: number | string): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyLine(): LineInput {
  return {
    productId: '',
    bundleId: undefined,
    description: '',
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
  };
}

export default function NewQuotePage() {
  const router = useRouter();

  const [clients, setClients] = useState<ClientLite[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [bundles, setBundles] = useState<BundleLite[]>([]);

  const [clientId, setClientId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [validUntil, setValidUntil] = useState(
    new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  );
  const [discountPercent, setDiscountPercent] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineInput[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, oRes, pRes, bRes] = await Promise.all([
          apiFetch('/api/v1/clients?limit=200'),
          apiFetch('/api/v1/opportunities?limit=200'),
          apiFetch('/api/v1/products?limit=200'),
          apiFetch('/api/v1/product-bundles?limit=200'),
        ]);
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
        if (oRes.ok) setOpportunities((await oRes.json()).data ?? []);
        if (pRes.ok) setProducts((await pRes.json()).data ?? []);
        if (bRes.ok) setBundles((await bRes.json()).data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load refs');
      }
    })();
  }, []);

  const addLine = () =>
    setLineItems((rows) => [...rows, emptyLine()]);
  const removeLine = (idx: number) =>
    setLineItems((rows) => rows.filter((_, i) => i !== idx));

  // When a product is picked, pre-fill the unit price + description from the
  // product. Same for bundles (description only — bundle price is computed
  // server-side, so we leave unitPrice empty for the server to fill).
  const updateLine = <K extends keyof LineInput>(
    idx: number,
    key: K,
    value: LineInput[K],
  ) => {
    setLineItems((rows) =>
      rows.map((r, i) => {
        if (i !== idx) return r;
        const next: LineInput = { ...r, [key]: value };
        // XOR — switching between product/bundle clears the other side.
        if (key === 'productId' && value) {
          next.bundleId = undefined;
          const p = products.find((x) => x.id === value);
          if (p) {
            next.unitPrice = toNum(p.unitPrice);
            if (!next.description) next.description = p.name;
          }
        }
        if (key === 'bundleId' && value) {
          next.productId = undefined;
          const b = bundles.find((x) => x.id === value);
          if (b && !next.description) next.description = b.name;
        }
        return next;
      }),
    );
  };

  const { subtotal, total } = useMemo(() => {
    let sub = 0;
    for (const l of lineItems) {
      const t = l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100);
      if (Number.isFinite(t)) sub += t;
    }
    sub = Math.round(sub * 100) / 100;
    const tot = Math.round(sub * (1 - discountPercent / 100) * 100) / 100;
    return { subtotal: sub, total: tot };
  }, [lineItems, discountPercent]);

  const submit = async () => {
    setError(null);
    if (!clientId) {
      setError('Pick a client');
      return;
    }
    if (lineItems.length === 0) {
      setError('Add at least one line item');
      return;
    }
    // Client-side XOR + completeness check — server enforces too.
    for (const li of lineItems) {
      const hasP = !!li.productId;
      const hasB = !!li.bundleId;
      if (hasP === hasB) {
        setError('Each line must pick a product OR a bundle (not both, not neither)');
        return;
      }
      if (!li.quantity || li.quantity < 1) {
        setError('Each line needs a quantity ≥ 1');
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        clientId,
        opportunityId: opportunityId || undefined,
        validUntil,
        discountPercent: discountPercent || undefined,
        currency,
        notes: notes.trim() || undefined,
        lineItems: lineItems.map((li, idx) => ({
          productId: li.productId || undefined,
          bundleId: li.bundleId || undefined,
          description: li.description || undefined,
          quantity: li.quantity,
          unitPrice: li.unitPrice || undefined,
          discountPercent: li.discountPercent || undefined,
          order: idx,
        })),
      };
      const res = await apiFetch('/api/v1/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create quote');
      }
      const created = await res.json();
      router.push(`/quotes/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  // Narrow opportunity dropdown to ones for the chosen client (if any).
  const visibleOpps = useMemo(
    () =>
      clientId
        ? opportunities.filter((o) => !o.clientId || o.clientId === clientId)
        : opportunities,
    [clientId, opportunities],
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">New quote</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Client</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          >
            <option value="">Select client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            Opportunity (optional)
          </label>
          <select
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          >
            <option value="">None</option>
            {visibleOpps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Valid until</label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Currency</label>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={8}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Line items</h2>
          <Button variant="secondary" onClick={addLine} type="button">
            + Add line
          </Button>
        </div>
        <div className="space-y-2">
          {lineItems.map((li, idx) => (
            <div
              key={idx}
              className="border rounded p-3 grid grid-cols-12 gap-2 items-start"
            >
              <div className="col-span-12 md:col-span-3">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Product
                </label>
                <select
                  value={li.productId || ''}
                  onChange={(e) =>
                    updateLine(idx, 'productId', e.target.value || undefined)
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                  disabled={!!li.bundleId}
                >
                  <option value="">—</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-12 md:col-span-3">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  OR Bundle
                </label>
                <select
                  value={li.bundleId || ''}
                  onChange={(e) =>
                    updateLine(idx, 'bundleId', e.target.value || undefined)
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                  disabled={!!li.productId}
                >
                  <option value="">—</option>
                  {bundles.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-6 md:col-span-2">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={li.description}
                  onChange={(e) =>
                    updateLine(idx, 'description', e.target.value)
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Qty
                </label>
                <input
                  type="number"
                  min={1}
                  value={li.quantity}
                  onChange={(e) =>
                    updateLine(
                      idx,
                      'quantity',
                      Math.max(1, Number(e.target.value) || 1),
                    )
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Price
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={li.unitPrice}
                  onChange={(e) =>
                    updateLine(
                      idx,
                      'unitPrice',
                      Math.max(0, Number(e.target.value) || 0),
                    )
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Disc %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={li.discountPercent}
                  onChange={(e) =>
                    updateLine(
                      idx,
                      'discountPercent',
                      Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0),
                      ),
                    )
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                />
              </div>
              <div className="col-span-12 md:col-span-1 flex md:justify-end">
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  disabled={lineItems.length === 1}
                  className="text-xs text-red-600 disabled:opacity-40 mt-5"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div className="space-y-2 border rounded p-4 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center justify-between text-sm">
            <span>Subtotal</span>
            <span className="font-mono">{subtotal.toFixed(2)}</span>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Quote-level discount %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={discountPercent}
              onChange={(e) =>
                setDiscountPercent(
                  Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
            />
          </div>
          <div className="flex items-center justify-between text-base font-semibold border-t pt-2">
            <span>Total</span>
            <span className="font-mono">
              {total.toFixed(2)} {currency}
            </span>
          </div>
          <p className="text-[10px] text-gray-400">
            Preview only — final total is computed server-side.
          </p>
        </div>
      </div>
    </div>
  );
}
