'use client';

/**
 * New Work Order — Wave H1 (Field Service).
 *
 * Builds a draft work order: client + optional opportunity, location,
 * priority, optional technician + scheduled window, and a list of
 * estimated lines (services + parts). On submit POSTs /work-orders;
 * the server recomputes line totals and generates the WO-YYYY-NNNN
 * number.
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
interface TechnicianLite {
  id: string;
  firstName: string;
  lastName: string;
}

interface LineInput {
  type: 'service' | 'part';
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

function toNum(v: number | string): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyLine(): LineInput {
  return {
    type: 'service',
    productId: undefined,
    description: '',
    quantity: 1,
    unitPrice: 0,
  };
}

export default function NewWorkOrderPage() {
  const router = useRouter();

  const [clients, setClients] = useState<ClientLite[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([]);

  const [clientId, setClientId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [priority, setPriority] = useState<
    'low' | 'normal' | 'high' | 'urgent'
  >('normal');
  const [description, setDescription] = useState('');
  const [lineItems, setLineItems] = useState<LineInput[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const today = new Date();
        const past = new Date(today.getTime() - 1 * 86400_000).toISOString();
        const future = new Date(today.getTime() + 60 * 86400_000).toISOString();
        const [cRes, oRes, pRes, tRes] = await Promise.all([
          apiFetch('/api/v1/clients?limit=200'),
          apiFetch('/api/v1/opportunities?limit=200'),
          apiFetch('/api/v1/products?limit=200'),
          apiFetch(`/api/v1/dispatch/board?from=${past}&to=${future}`),
        ]);
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
        if (oRes.ok) setOpportunities((await oRes.json()).data ?? []);
        if (pRes.ok) setProducts((await pRes.json()).data ?? []);
        if (tRes.ok) {
          const data = await tRes.json();
          setTechnicians(data.technicians ?? []);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load refs');
      }
    })();
  }, []);

  const addLine = () => setLineItems((rows) => [...rows, emptyLine()]);
  const removeLine = (idx: number) =>
    setLineItems((rows) => rows.filter((_, i) => i !== idx));

  const updateLine = <K extends keyof LineInput>(
    idx: number,
    key: K,
    value: LineInput[K],
  ) => {
    setLineItems((rows) =>
      rows.map((r, i) => {
        if (i !== idx) return r;
        const next: LineInput = { ...r, [key]: value };
        if (key === 'productId' && value) {
          const p = products.find((x) => x.id === value);
          if (p) {
            next.unitPrice = toNum(p.unitPrice);
            if (!next.description) next.description = p.name;
          }
        }
        return next;
      }),
    );
  };

  const { subtotal } = useMemo(() => {
    let sub = 0;
    for (const l of lineItems) {
      const t = l.quantity * l.unitPrice;
      if (Number.isFinite(t)) sub += t;
    }
    return { subtotal: Math.round(sub * 100) / 100 };
  }, [lineItems]);

  const visibleOpps = useMemo(
    () =>
      clientId
        ? opportunities.filter((o) => !o.clientId || o.clientId === clientId)
        : opportunities,
    [clientId, opportunities],
  );

  const submit = async () => {
    setError(null);
    if (!clientId) {
      setError('Pick a client');
      return;
    }
    if (scheduledStart && scheduledEnd) {
      if (new Date(scheduledEnd) <= new Date(scheduledStart)) {
        setError('Scheduled end must be after scheduled start');
        return;
      }
    }
    for (const li of lineItems) {
      if (!li.description.trim()) {
        setError('Each line needs a description');
        return;
      }
      if (li.quantity < 0) {
        setError('Quantity must be >= 0');
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        clientId,
        opportunityId: opportunityId || undefined,
        locationAddress: locationAddress.trim() || undefined,
        scheduledStart: scheduledStart
          ? new Date(scheduledStart).toISOString()
          : undefined,
        scheduledEnd: scheduledEnd
          ? new Date(scheduledEnd).toISOString()
          : undefined,
        technicianId: technicianId || undefined,
        priority,
        description: description.trim() || undefined,
        lineItems: lineItems
          .filter((li) => li.description.trim())
          .map((li, idx) => ({
            type: li.type,
            productId: li.productId || undefined,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            order: idx,
          })),
      };
      const res = await apiFetch('/api/v1/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create work order');
      }
      const created = await res.json();
      router.push(`/work-orders/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">New work order</h1>
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
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1">
            Site address (optional)
          </label>
          <input
            type="text"
            value={locationAddress}
            onChange={(e) => setLocationAddress(e.target.value)}
            placeholder="123 Main St, Apt 4B…"
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            Technician (optional)
          </label>
          <select
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          >
            <option value="">Unassigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as typeof priority)
            }
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            Scheduled start
          </label>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            Scheduled end
          </label>
          <input
            type="datetime-local"
            value={scheduledEnd}
            onChange={(e) => setScheduledEnd(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1">
            Description / scope of work
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">
            Estimated line items (services + parts)
          </h2>
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
              <div className="col-span-6 md:col-span-2">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Type
                </label>
                <select
                  value={li.type}
                  onChange={(e) =>
                    updateLine(
                      idx,
                      'type',
                      e.target.value as LineInput['type'],
                    )
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                >
                  <option value="service">Service</option>
                  <option value="part">Part</option>
                </select>
              </div>
              <div className="col-span-6 md:col-span-3">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Product (optional)
                </label>
                <select
                  value={li.productId || ''}
                  onChange={(e) =>
                    updateLine(idx, 'productId', e.target.value || undefined)
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
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
              <div className="col-span-4 md:col-span-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">
                  Qty
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={li.quantity}
                  onChange={(e) =>
                    updateLine(
                      idx,
                      'quantity',
                      Math.max(0, Number(e.target.value) || 0),
                    )
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
                />
              </div>
              <div className="col-span-4 md:col-span-2">
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
              <div className="col-span-4 md:col-span-1 flex md:justify-end">
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

      <div className="border rounded p-4 bg-gray-50 dark:bg-gray-900 flex items-center justify-between text-sm">
        <span>Estimated subtotal</span>
        <span className="font-mono text-base font-semibold">
          {subtotal.toFixed(2)}
        </span>
      </div>
      <p className="text-[10px] text-gray-400">
        Preview only — final totals are computed server-side after the
        technician closes the WO with the actual materials used.
      </p>
    </div>
  );
}
