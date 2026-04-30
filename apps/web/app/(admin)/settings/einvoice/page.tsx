'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

type Format = 'PEPPOL_UBL_2_1' | 'FACTUR_X' | 'GENERIC_UBL';

interface EInvoiceSettings {
  id?: string;
  organizationId?: string;
  format: Format;
  senderId: string | null;
  senderIdScheme: string | null;
  senderName: string | null;
  senderTaxId: string | null;
  senderAddress: string | null;
  senderCity: string | null;
  senderPostcode: string | null;
  senderCountry: string | null;
  defaultCurrency: string | null;
  paymentMeansCode: string | null;
  customXmlSnippet: string | null;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_FORM: EInvoiceSettings = {
  format: 'PEPPOL_UBL_2_1',
  senderId: '',
  senderIdScheme: '0088',
  senderName: '',
  senderTaxId: '',
  senderAddress: '',
  senderCity: '',
  senderPostcode: '',
  senderCountry: '',
  defaultCurrency: 'EUR',
  paymentMeansCode: '30',
  customXmlSnippet: '',
  enabled: false,
};

// PEPPOL ICD scheme codes — partial list of the most-used ones. Tenants who
// need an exotic scheme can paste it into the input directly (free-form).
const PEPPOL_SCHEMES: Array<{ code: string; label: string }> = [
  { code: '0088', label: '0088 — GLN (Global Location Number)' },
  { code: '0184', label: '0184 — DK CVR' },
  { code: '0007', label: '0007 — SE Organisationsnummer' },
  { code: '0192', label: '0192 — NO Organisasjonsnummer' },
  { code: '0208', label: '0208 — BE Crossroads Bank Enterprise number' },
  { code: '0201', label: '0201 — IT Codice IPA' },
  { code: '0009', label: '0009 — FR SIRET' },
  { code: '9930', label: '9930 — DE Umsatzsteuer-Identifikationsnummer' },
  { code: '0204', label: '0204 — DE Leitweg-ID' },
];

// UN/CEFACT 4461 — short list. Tenants may paste any numeric code.
const PAYMENT_MEANS_HINT =
  'UN/CEFACT 4461 code. Common values: 30 = Credit transfer, 31 = Debit transfer, 42 = Payment to bank account, 48 = Bank card, 49 = Direct debit, 58 = SEPA credit transfer, 59 = SEPA direct debit.';

export default function EInvoiceSettingsPage() {
  const [form, setForm] = useState<EInvoiceSettings>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewXml, setPreviewXml] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // ─── Initial load ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/einvoice/settings');
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const data = await res.json();
        setForm({ ...DEFAULT_FORM, ...data });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to load e-invoice settings',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof EInvoiceSettings>(
    key: K,
    value: EInvoiceSettings[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  // ─── Save ─────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true);
    try {
      const body = {
        ...form,
        // Normalize empty strings → null to match API expectations.
        senderId: form.senderId || null,
        senderIdScheme: form.senderIdScheme || null,
        senderName: form.senderName || null,
        senderTaxId: form.senderTaxId || null,
        senderAddress: form.senderAddress || null,
        senderCity: form.senderCity || null,
        senderPostcode: form.senderPostcode || null,
        senderCountry: form.senderCountry
          ? form.senderCountry.toUpperCase()
          : null,
        defaultCurrency: form.defaultCurrency
          ? form.defaultCurrency.toUpperCase()
          : null,
        paymentMeansCode: form.paymentMeansCode || null,
        customXmlSnippet: form.customXmlSnippet || null,
      };
      const res = await apiFetch('/api/v1/einvoice/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Save failed (${res.status})`);
      }
      const data = await res.json();
      setForm({ ...DEFAULT_FORM, ...data });
      toast.success('E-Invoice settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ─── Preview ──────────────────────────────────────────────────────────
  async function generateSample() {
    setPreviewing(true);
    try {
      const res = await apiFetch('/api/v1/einvoice/sample');
      if (!res.ok) throw new Error(`Sample failed (${res.status})`);
      const data: { xml: string } = await res.json();
      setPreviewXml(data.xml);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sample failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function generateForInvoice(invoiceId: string) {
    setPreviewing(true);
    setPickerOpen(false);
    try {
      const res = await apiFetch(`/api/v1/einvoice/preview/${invoiceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Preview failed (${res.status})`);
      }
      const data: { xml: string } = await res.json();
      setPreviewXml(data.xml);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  function downloadSample() {
    if (!previewXml) {
      toast.error('Generate a sample first');
      return;
    }
    const blob = new Blob([previewXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <SettingsPageLayout
      title="E-Invoice (UBL XML)"
      description="Configure how the CRM emits machine-readable e-invoices for EU compliance (PEPPOL BIS Billing 3.0, Factur-X, or generic UBL). Settings here only affect the XML output — your PDF templates are unchanged."
    >
      <div className="mb-[-0.5rem]">
        <Link
          href="/settings"
          className={`${typography.bodyMuted} hover:text-primary`}
        >
          ← Settings
        </Link>
      </div>

      {/* ── Format ─────────────────────────────────────────────── */}
      <SettingsSection
        title="Format"
        description="Pick the e-invoice profile your customers expect. PEPPOL BIS 3.0 is the default for most EU B2B / B2G."
      >
        <div className="space-y-3">
          <FormatRadio
            current={form.format}
            value="PEPPOL_UBL_2_1"
            label="PEPPOL UBL 2.1 (BIS Billing 3.0)"
            desc="Standard for EU B2B / B2G via the PEPPOL network. Compliant with EN 16931."
            onChange={(v) => set('format', v)}
          />
          <FormatRadio
            current={form.format}
            value="FACTUR_X"
            label="Factur-X"
            desc="Hybrid format used by FR and DE governments. We emit the EN 16931 XML payload only — PDF/A-3 wrapping is not yet supported."
            onChange={(v) => set('format', v)}
          />
          <FormatRadio
            current={form.format}
            value="GENERIC_UBL"
            label="Generic UBL 2.1"
            desc="Plain UBL Invoice without PEPPOL CustomizationID — for tenants integrating with custom or non-EU pipelines."
            onChange={(v) => set('format', v)}
          />
        </div>
      </SettingsSection>

      {/* ── Enabled toggle ─────────────────────────────────────── */}
      <SettingsSection
        title="Activation"
        description="When disabled, the XML generator falls back to organization defaults — useful while you're still setting things up."
      >
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
          />
          E-Invoice generation is active for this organization
        </label>
      </SettingsSection>

      {/* ── Sender ─────────────────────────────────────────────── */}
      <SettingsSection
        title="Sender (your organization)"
        description="These fields populate the AccountingSupplierParty block of the UBL document. Leave blank to inherit from the org's general settings."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <Label>PEPPOL ID scheme</Label>
              <select
                value={form.senderIdScheme ?? ''}
                onChange={(e) => set('senderIdScheme', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900"
              >
                <option value="">— select —</option>
                {PEPPOL_SCHEMES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
                {form.senderIdScheme &&
                  !PEPPOL_SCHEMES.some(
                    (s) => s.code === form.senderIdScheme,
                  ) && (
                    <option value={form.senderIdScheme}>
                      {form.senderIdScheme} (custom)
                    </option>
                  )}
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                4-digit ICD code. Need a scheme not listed? Type the code in
                the participant id box below as <code>NNNN:value</code>.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Participant ID"
                value={form.senderId ?? ''}
                onChange={(v) => set('senderId', v)}
                placeholder="1234567890123"
              />
            </div>
          </div>

          <Field
            label="Legal name"
            value={form.senderName ?? ''}
            onChange={(v) => set('senderName', v)}
            placeholder="Acme NV"
          />
          <Field
            label="VAT / Tax ID"
            value={form.senderTaxId ?? ''}
            onChange={(v) => set('senderTaxId', v)}
            placeholder="BE0123456789"
          />
          <Field
            label="Street address"
            value={form.senderAddress ?? ''}
            onChange={(v) => set('senderAddress', v)}
            placeholder="Rue de la Loi 16"
          />
          <Field
            label="City"
            value={form.senderCity ?? ''}
            onChange={(v) => set('senderCity', v)}
            placeholder="Brussels"
          />
          <Field
            label="Postcode"
            value={form.senderPostcode ?? ''}
            onChange={(v) => set('senderPostcode', v)}
            placeholder="1000"
          />
          <Field
            label="Country (ISO 3166-1 alpha-2)"
            value={form.senderCountry ?? ''}
            onChange={(v) => set('senderCountry', v.toUpperCase().slice(0, 2))}
            placeholder="BE"
          />
        </div>
      </SettingsSection>

      {/* ── Document defaults ──────────────────────────────────── */}
      <SettingsSection
        title="Document defaults"
        description="Applied when an invoice does not specify these explicitly."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Default currency (ISO 4217)"
            value={form.defaultCurrency ?? ''}
            onChange={(v) =>
              set('defaultCurrency', v.toUpperCase().slice(0, 3))
            }
            placeholder="EUR"
          />
          <div>
            <Label title={PAYMENT_MEANS_HINT}>
              Payment means code{' '}
              <span className="text-gray-400 cursor-help" aria-hidden="true">
                (?)
              </span>
            </Label>
            <input
              type="text"
              value={form.paymentMeansCode ?? ''}
              onChange={(e) => set('paymentMeansCode', e.target.value)}
              placeholder="30"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900"
            />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {PAYMENT_MEANS_HINT}
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* ── Custom XML extension snippet ───────────────────────── */}
      <SettingsSection
        title="Custom XML snippet"
        description="Free-form XML appended into the document's UBLExtensions block. Useful for country-specific extensions (e.g. national tax authority blocks)."
      >
        <textarea
          value={form.customXmlSnippet ?? ''}
          onChange={(e) => set('customXmlSnippet', e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'<MyCustomElement>value</MyCustomElement>'}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900 whitespace-pre"
        />
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          Inserted into the document extension point. Invalid XML breaks
          compliance — validate externally first.
        </p>
      </SettingsSection>

      {/* ── Save bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>

      {/* ── Preview ────────────────────────────────────────────── */}
      <SettingsSection
        title="Preview XML"
        description="Generate a sample document to inspect the schema, or render the XML for an existing invoice using the current settings."
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button
            variant="secondary"
            onClick={generateSample}
            loading={previewing}
          >
            Generate sample
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPickerOpen(true)}
            disabled={previewing}
          >
            Generate from invoice…
          </Button>
          <Button
            variant="secondary"
            onClick={downloadSample}
            disabled={!previewXml}
          >
            Download as sample.xml
          </Button>
        </div>

        <pre
          className="text-[11px] font-mono whitespace-pre overflow-auto max-h-[28rem] bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-gray-800 dark:text-gray-200"
          aria-label="Generated XML preview"
        >
          {previewXml ||
            '// No preview yet — click Generate sample or Generate from invoice…'}
        </pre>
      </SettingsSection>

      {pickerOpen && (
        <InvoicePickerModal
          onPick={generateForInvoice}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </SettingsPageLayout>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

function FormatRadio({
  current,
  value,
  label,
  desc,
  onChange,
}: {
  current: Format;
  value: Format;
  label: string;
  desc: string;
  onChange: (v: Format) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border-2 transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      }`}
    >
      <span
        className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
          selected ? 'border-primary bg-primary' : 'border-gray-300'
        }`}
        aria-hidden="true"
      />
      <div>
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {label}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {desc}
        </p>
      </div>
    </button>
  );
}

function Label({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <label
      title={title}
      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
    >
      {children}
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        value={value as string}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900"
      />
    </div>
  );
}

// ─── Invoice picker modal ──────────────────────────────────────────────────
// Light search by number / client. Hits /api/v1/invoices?search=…&limit=20.
// We deliberately keep this simple — full-fledged invoice browsing already
// lives at /invoices.

interface InvoiceRow {
  id: string;
  number: string;
  client?: { name?: string; company?: string } | null;
  total?: number | string;
  date?: string;
}

function InvoicePickerModal({
  onPick,
  onClose,
}: {
  onPick: (invoiceId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useModalA11y(true, onClose);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useMemo(() => q.trim(), [q]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (search) params.set('search', search);
        const res = await apiFetch(`/api/v1/invoices?${params.toString()}`);
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = await res.json();
        // The list endpoint returns either `{ data: [...] }` or `[…]` depending
        // on filters — handle both shapes defensively.
        const list: InvoiceRow[] = Array.isArray(data) ? data : data?.data ?? [];
        setRows(list);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="einvoice-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-xl flex flex-col max-h-[80vh]"
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2
            id="einvoice-picker-title"
            className="text-base font-semibold text-gray-800 dark:text-gray-200"
          >
            Pick an invoice to preview
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Search by invoice number or client name.
          </p>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <p className="p-4 text-xs text-gray-500 dark:text-gray-400">
              Searching…
            </p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-xs text-gray-500 dark:text-gray-400">
              No invoices match.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick(r.id)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {r.number}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {r.client?.company ?? r.client?.name ?? '—'}
                      </div>
                    </div>
                    {r.date && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {new Date(r.date).toLocaleDateString()}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
