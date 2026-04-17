'use client';

import { useState, useEffect, FormEvent, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ClientOption {
  id: string;
  company?: string;
  company_name?: string;
  name?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
  shippingStreet?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingCountry?: string;
}

interface TaxOption {
  id: string;
  name: string;
  rate: number;
}

interface StaffOption {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  name?: string;
}

interface SavedItem {
  id: string;
  description: string;
  rate: number;
  taxRate: number;
  unit?: string;
  longDescription?: string;
  _source?: 'saved' | 'product';
  _productId?: string;
}

interface LineItem {
  description: string;
  longDescription: string;
  showLongDesc: boolean;
  qty: string;
  rate: string;
  taxId: string;
  taxId2: string;
  unit: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EMPTY_ITEM: LineItem = {
  description: '',
  longDescription: '',
  showLongDesc: false,
  qty: '1',
  rate: '0',
  taxId: '',
  taxId2: '',
  unit: '',
};

const today = () => new Date().toISOString().slice(0, 10);

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function NewEstimatePage() {
  const router = useRouter();

  // Form state
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [estimatePrefix, setEstimatePrefix] = useState('EST-');
  const [estimateNumber, setEstimateNumber] = useState('0001');
  const [estimateDate, setEstimateDate] = useState(today());
  const [validUntil, setValidUntil] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [currency, setCurrency] = useState('USD');

  // Address fields
  const [billStreet, setBillStreet] = useState('');
  const [billCity, setBillCity] = useState('');
  const [billState, setBillState] = useState('');
  const [billZip, setBillZip] = useState('');
  const [billCountry, setBillCountry] = useState('');
  const [shipStreet, setShipStreet] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipState, setShipState] = useState('');
  const [shipZip, setShipZip] = useState('');
  const [shipCountry, setShipCountry] = useState('');

  // Right column
  const [tags, setTags] = useState('');
  const [saleAgentId, setSaleAgentId] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [clientNote, setClientNote] = useState('');
  const [terms, setTerms] = useState('');

  // Line items
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [quantityLabel, setQuantityLabel] = useState<'qty' | 'hours'>('qty');

  // Lookup data
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [taxes, setTaxes] = useState<TaxOption[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffOption[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveItemMsg, setSaveItemMsg] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Autocomplete
  const [activeAutocomplete, setActiveAutocomplete] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SavedItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    const headers = { Authorization: `Bearer ${getToken()}` };

    fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers })
      .then((r) => r.json())
      .then((d) => setClients(d.data ?? []))
      .catch(() => {});

    fetch(`${API_BASE}/api/v1/organizations/taxes`, { headers })
      .then((r) => r.json())
      .then((d) => setTaxes(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => {});

    fetch(`${API_BASE}/api/v1/users?limit=100`, { headers })
      .then((r) => r.json())
      .then((d) => setStaffMembers(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => {});

    fetch(`${API_BASE}/api/v1/estimates?limit=1&page=1`, { headers })
      .then((r) => r.json())
      .then((d) => {
        const total = d.total ?? d.data?.length ?? 0;
        setEstimateNumber(String(total + 1).padStart(4, '0'));
      })
      .catch(() => {});
  }, []);

  // ─── Client selection ─────────────────────────────────────────────────────

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter((c) =>
      (c.company ?? c.company_name ?? c.name ?? '').toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

  function selectClient(client: ClientOption) {
    setClientId(client.id);
    setClientSearch(client.company ?? client.company_name ?? client.name ?? '');
    setShowClientDropdown(false);

    fetch(`${API_BASE}/api/v1/clients/${client.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const c = data.data ?? data;
        setBillStreet(c.billingStreet ?? '');
        setBillCity(c.billingCity ?? '');
        setBillState(c.billingState ?? '');
        setBillZip(c.billingZip ?? '');
        setBillCountry(c.billingCountry ?? '');
        setShipStreet(c.shippingStreet ?? '');
        setShipCity(c.shippingCity ?? '');
        setShipState(c.shippingState ?? '');
        setShipZip(c.shippingZip ?? '');
        setShipCountry(c.shippingCountry ?? '');
      })
      .catch(() => {});
  }

  // ─── Line item helpers ────────────────────────────────────────────────────

  function updateItem(idx: number, key: keyof LineItem, value: string | boolean) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  // ─── Saved item search ────────────────────────────────────────────────────

  const searchSavedItems = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [savedRes, productRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/saved-items?search=${encodeURIComponent(query)}`, { headers }),
        fetch(`${API_BASE}/api/v1/products/search?q=${encodeURIComponent(query)}`, { headers }),
      ]);
      let allItems: SavedItem[] = [];
      if (savedRes.ok) {
        const data = await savedRes.json();
        const arr = Array.isArray(data) ? data : (data.data ?? []);
        allItems = arr.map((s: any) => ({ ...s, _source: 'saved' as const }));
      }
      if (productRes.ok) {
        const products = await productRes.json();
        const productItems = (Array.isArray(products) ? products : []).map((p: any) => ({
          id: `product_${p.id}`,
          description: p.name,
          rate: Number(p.unitPrice ?? p.rate ?? 0),
          taxRate: Number(p.taxRate ?? 0),
          unit: p.unit,
          longDescription: p.description,
          _source: 'product' as const,
          _productId: p.id,
        }));
        allItems = [...allItems, ...productItems];
      }
      setSuggestions(allItems);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleDescriptionChange(idx: number, value: string) {
    updateItem(idx, 'description', value);
    setActiveAutocomplete(idx);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSavedItems(value), 300);
  }

  function applySavedItem(idx: number, saved: SavedItem) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              description: saved.description,
              longDescription: saved.longDescription ?? '',
              rate: String(saved.rate),
              unit: saved.unit ?? '',
            }
          : it,
      ),
    );
    setSuggestions([]);
    setActiveAutocomplete(null);
  }

  async function saveAsItem(idx: number) {
    const item = items[idx];
    if (!item.description) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          description: item.description,
          longDescription: item.longDescription,
          rate: Number(item.rate) || 0,
          taxRate: 0,
          unit: item.unit,
        }),
      });
      if (res.ok) {
        setSaveItemMsg('Item saved for future use');
        setTimeout(() => setSaveItemMsg(null), 3000);
      }
    } catch {}
  }

  // ─── Totals ───────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    let subtotal = 0;
    const taxBreakdown: Record<string, { name: string; rate: number; amount: number }> = {};

    for (const item of items) {
      const q = parseFloat(item.qty) || 0;
      const r = parseFloat(item.rate) || 0;
      const lineTotal = q * r;
      subtotal += lineTotal;

      for (const taxField of [item.taxId, item.taxId2]) {
        if (taxField) {
          const tax = taxes.find((t) => t.id === taxField);
          if (tax) {
            const taxAmt = (lineTotal * Number(tax.rate)) / 100;
            if (!taxBreakdown[tax.id]) {
              taxBreakdown[tax.id] = { name: tax.name, rate: Number(tax.rate), amount: 0 };
            }
            taxBreakdown[tax.id].amount += taxAmt;
          }
        }
      }
    }

    const totalTax = Object.values(taxBreakdown).reduce((sum, t) => sum + t.amount, 0);
    const discountVal = parseFloat(discount) || 0;
    const discountAmount = discountType === 'percent' ? (subtotal * discountVal) / 100 : discountVal;
    const total = Math.max(0, subtotal + totalTax - discountAmount);

    return { subtotal, taxBreakdown, totalTax, discountAmount, total };
  }, [items, taxes, discount, discountType]);

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent, asDraft = false) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        clientId: clientId || undefined,
        number: `${estimatePrefix}${estimateNumber}`,
        referenceNumber: referenceNumber || undefined,
        date: estimateDate,
        expiryDate: validUntil || undefined,
        currency,
        status: 'draft',
        discount: Number(discount) || 0,
        discountType,
        adminNote: adminNote || undefined,
        clientNote: clientNote || undefined,
        terms: terms || undefined,
        tags: tags || undefined,
        saleAgentId: saleAgentId || undefined,
        items: items.map((it, index) => ({
          description: it.description,
          longDescription: it.longDescription || undefined,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          tax1: it.taxId || undefined,
          tax2: it.taxId2 || undefined,
          unit: it.unit || undefined,
          order: index,
        })),
      };

      const res = await fetch(`${API_BASE}/api/v1/estimates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }

      const created = await res.json();
      const createdId = created.id ?? created.data?.id;
      router.push(`/estimates/${createdId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create estimate');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <Link href="/estimates" className="text-sm text-gray-500 hover:text-primary">
          &larr; Back to Estimates
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Estimate</h1>

      <form onSubmit={(e) => handleSubmit(e)} className="space-y-6">
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">
            {error}
          </div>
        )}
        {saveItemMsg && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 text-sm text-green-700 rounded-lg">
            {saveItemMsg}
          </div>
        )}

        {/* ─── Top Section: Two Columns ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT COLUMN */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
            {/* Customer */}
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                Customer <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  if (!e.target.value) setClientId('');
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                placeholder="Search customer..."
                className={inputClass}
                required={!clientId}
              />
              {showClientDropdown && filteredClients.length > 0 && (
                <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 border-b border-gray-50 last:border-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectClient(c);
                      }}
                    >
                      {c.company ?? c.company_name ?? c.name ?? c.id}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bill To / Ship To */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                  Bill To
                </label>
                <input placeholder="Street" value={billStreet} onChange={(e) => setBillStreet(e.target.value)} className={inputClass + ' mb-1'} />
                <div className="grid grid-cols-2 gap-1">
                  <input placeholder="City" value={billCity} onChange={(e) => setBillCity(e.target.value)} className={inputClass} />
                  <input placeholder="State" value={billState} onChange={(e) => setBillState(e.target.value)} className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <input placeholder="ZIP" value={billZip} onChange={(e) => setBillZip(e.target.value)} className={inputClass} />
                  <input placeholder="Country" value={billCountry} onChange={(e) => setBillCountry(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                  Ship To
                </label>
                <input placeholder="Street" value={shipStreet} onChange={(e) => setShipStreet(e.target.value)} className={inputClass + ' mb-1'} />
                <div className="grid grid-cols-2 gap-1">
                  <input placeholder="City" value={shipCity} onChange={(e) => setShipCity(e.target.value)} className={inputClass} />
                  <input placeholder="State" value={shipState} onChange={(e) => setShipState(e.target.value)} className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <input placeholder="ZIP" value={shipZip} onChange={(e) => setShipZip(e.target.value)} className={inputClass} />
                  <input placeholder="Country" value={shipCountry} onChange={(e) => setShipCountry(e.target.value)} className={inputClass} />
                </div>
              </div>
            </div>

            {/* Estimate Number */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                Estimate Number
              </label>
              <div className="flex gap-1">
                <input value={estimatePrefix} onChange={(e) => setEstimatePrefix(e.target.value)} className={inputClass + ' w-20 flex-shrink-0'} />
                <input value={estimateNumber} onChange={(e) => setEstimateNumber(e.target.value)} className={inputClass} />
              </div>
            </div>

            {/* Reference # */}
            <Field label="Reference #">
              <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className={inputClass} placeholder="Optional reference" />
            </Field>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Estimate Date" required>
                <input type="date" required value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Valid Until">
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
              </Field>
            </div>

            {/* Currency */}
            <Field label="Currency">
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} placeholder="USD" />
            </Field>
          </div>

          {/* RIGHT COLUMN */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
            {/* Tags */}
            <Field label="Tags">
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} placeholder="Comma-separated tags" />
            </Field>

            {/* Sale Agent */}
            <Field label="Sale Agent">
              <select value={saleAgentId} onChange={(e) => setSaleAgentId(e.target.value)} className={inputClass}>
                <option value="">-- None --</option>
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName && s.lastName ? `${s.firstName} ${s.lastName}` : s.name ?? s.email ?? s.id}
                  </option>
                ))}
              </select>
            </Field>

            {/* Discount */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Discount</label>
              <div className="flex gap-1">
                <input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} />
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percent')} className={inputClass + ' w-24 flex-shrink-0'}>
                  <option value="fixed">Fixed</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>

            {/* Admin Note */}
            <Field label="Admin Note (internal)">
              <textarea rows={3} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} className={inputClass} placeholder="Not visible to the client" />
            </Field>
          </div>
        </div>

        {/* ─── Line Items ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Line Items</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">Show quantity as:</span>
              <button
                type="button"
                onClick={() => setQuantityLabel(quantityLabel === 'qty' ? 'hours' : 'qty')}
                className={`text-xs px-2 py-1 rounded border ${quantityLabel === 'hours' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600'}`}
              >
                {quantityLabel === 'qty' ? 'Default' : 'Hours'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="pb-2 pr-2 w-10">#</th>
                  <th className="pb-2 pr-2">Item</th>
                  <th className="pb-2 pr-2 w-48">Description</th>
                  <th className="pb-2 pr-2 w-20">{quantityLabel === 'hours' ? 'Hours' : 'Qty'}</th>
                  <th className="pb-2 pr-2 w-28">Rate</th>
                  <th className="pb-2 pr-2 w-40">Tax</th>
                  <th className="pb-2 pr-2 w-28 text-right">Amount</th>
                  <th className="pb-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const lineAmount = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
                  return (
                    <tr
                      key={idx}
                      className={`border-b border-gray-100 align-top ${dragIdx === idx ? 'opacity-50' : ''}`}
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-t-2', 'border-primary'); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('border-t-2', 'border-primary'); }}
                      onDrop={(e) => {
                        e.currentTarget.classList.remove('border-t-2', 'border-primary');
                        if (dragIdx === null || dragIdx === idx) return;
                        setItems((prev) => { const r = [...prev]; const [m] = r.splice(dragIdx, 1); r.splice(idx, 0, m); return r; });
                        setDragIdx(null);
                      }}
                      onDragEnd={() => setDragIdx(null)}
                    >
                      <td className="py-3 pr-2 text-gray-400 cursor-grab select-none"><span className="text-xs">{idx + 1}</span></td>
                      <td className="py-3 pr-2 relative">
                        <input
                          value={item.description}
                          onChange={(e) => handleDescriptionChange(idx, e.target.value)}
                          onBlur={() => setTimeout(() => { if (activeAutocomplete === idx) setActiveAutocomplete(null); }, 200)}
                          onFocus={() => { if (item.description.length >= 2) { setActiveAutocomplete(idx); searchSavedItems(item.description); } }}
                          className={inputClass}
                          placeholder="Search items..."
                        />
                        {activeAutocomplete === idx && suggestions.length > 0 && (
                          <div className="absolute z-20 left-0 right-2 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {suggestions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 border-b border-gray-50 last:border-0 flex items-center gap-2"
                                onMouseDown={(e) => { e.preventDefault(); applySavedItem(idx, s); }}
                              >
                                <span className="font-medium text-gray-900 flex-1">{s.description}</span>
                                <span className="text-gray-500 text-xs">{Number(s.rate).toFixed(2)}</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${s._source === 'product' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {s._source === 'product' ? 'Product' : 'Saved'}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        <button type="button" className="text-[10px] text-primary hover:underline mt-1" onClick={() => updateItem(idx, 'showLongDesc', !item.showLongDesc)}>
                          {item.showLongDesc ? 'Hide long description' : '+ Long description'}
                        </button>
                        {item.showLongDesc && (
                          <textarea rows={2} value={item.longDescription} onChange={(e) => updateItem(idx, 'longDescription', e.target.value)} className={inputClass + ' mt-1 text-xs'} placeholder="Long description..." />
                        )}
                      </td>
                      <td className="py-3 pr-2">
                        <input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className={inputClass} placeholder="Description" />
                      </td>
                      <td className="py-3 pr-2">
                        <input type="number" step="0.01" min="0" value={item.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} className={inputClass} />
                      </td>
                      <td className="py-3 pr-2">
                        <input type="number" step="0.01" min="0" value={item.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} className={inputClass} />
                      </td>
                      <td className="py-3 pr-2">
                        <select value={item.taxId} onChange={(e) => updateItem(idx, 'taxId', e.target.value)} className={inputClass + ' mb-1'}>
                          <option value="">No Tax</option>
                          {taxes.map((t) => (<option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>))}
                        </select>
                        <select value={item.taxId2} onChange={(e) => updateItem(idx, 'taxId2', e.target.value)} className={inputClass + ' text-xs'}>
                          <option value="">Tax 2 (optional)</option>
                          {taxes.map((t) => (<option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>))}
                        </select>
                      </td>
                      <td className="py-3 pr-2 text-right tabular-nums font-medium text-gray-900">{lineAmount.toFixed(2)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => saveAsItem(idx)} className="text-gray-400 hover:text-primary p-1" title="Save as reusable item">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path d="M3.75 3A1.75 1.75 0 002 4.75v10.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-8.5A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75z" />
                            </svg>
                          </button>
                          <button type="button" onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500 p-1 text-lg leading-none" aria-label="Remove">&times;</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <button type="button" onClick={addItem} className="text-sm text-primary hover:underline font-medium">+ Add Item</button>
          </div>

          {/* Totals */}
          <div className="flex justify-end mt-6">
            <div className="w-72 space-y-1 text-sm">
              <TotalRow label="Sub Total" value={totals.subtotal.toFixed(2)} />
              {totals.discountAmount > 0 && (
                <TotalRow label={`Discount${discountType === 'percent' ? ` (${discount}%)` : ''}`} value={`-${totals.discountAmount.toFixed(2)}`} />
              )}
              {Object.entries(totals.taxBreakdown).map(([id, t]) => (
                <TotalRow key={id} label={`${t.name} (${t.rate}%)`} value={t.amount.toFixed(2)} />
              ))}
              <div className="border-t border-gray-200 mt-2 pt-2">
                <TotalRow label="Total" value={`${totals.total.toFixed(2)} ${currency}`} bold />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Notes & Terms ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Client Note">
            <textarea rows={4} value={clientNote} onChange={(e) => setClientNote(e.target.value)} className={inputClass} placeholder="Visible to the client" />
          </Field>
          <Field label="Terms & Conditions">
            <textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass} />
          </Field>
        </div>

        {/* ─── Bottom Buttons ─────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3 pt-2">
          <Link href="/estimates" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
          <button
            type="button"
            onClick={(e) => handleSubmit(e as any, true)}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 border border-gray-200"
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 shadow-sm">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Shared sub-components ──────────────────────────────────────────────────

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-gray-900 text-base' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
