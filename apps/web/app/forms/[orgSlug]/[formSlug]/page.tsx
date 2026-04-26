'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Public hosted lead form — renders at /forms/{orgSlug}/{formSlug} and is
// intentionally kept outside every (admin) / (auth) / (portal) group so it
// stays accessible without a session. No middleware is in play in this app,
// and the route group check lives inside (admin)/layout.tsx, so this file
// is inherently public.
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select';

interface PublicField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
}

interface PublicForm {
  name: string;
  title: string;
  description: string | null;
  fields: PublicField[];
  captchaEnabled: boolean;
  redirectUrl?: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function PublicLeadFormPage() {
  const params = useParams<{ orgSlug: string; formSlug: string }>();
  const orgSlug = params?.orgSlug;
  const formSlug = params?.formSlug;

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/public/lead-forms/${encodeURIComponent(orgSlug!)}/${encodeURIComponent(formSlug!)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (res.status === 404) throw new Error('This form is not available.');
          throw new Error(`Failed to load form (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) setForm(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, formSlug]);

  const canSubmit = useMemo(() => {
    if (!form) return false;
    for (const f of form.fields) {
      if (f.required && !(values[f.key] && values[f.key].trim())) return false;
    }
    return true;
  }, [form, values]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/public/lead-forms/${encodeURIComponent(orgSlug!)}/${encodeURIComponent(formSlug!)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, website }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = 'Submission failed. Please try again.';
        try {
          const j = JSON.parse(text);
          if (typeof j?.message === 'string') msg = j.message;
          else if (Array.isArray(j?.message)) msg = j.message.join(', ');
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const data: { ok: boolean; redirectUrl?: string } = await res.json();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-12">Loading…</p>
          ) : loadError || !form ? (
            <div className="text-center py-10">
              <h1 className="text-lg font-semibold text-gray-900">Form not available</h1>
              <p className="text-sm text-gray-500 mt-2">{loadError}</p>
            </div>
          ) : submitted ? (
            <div className="text-center py-8">
              <div className="mx-auto w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-4">
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M16.704 5.29a1 1 0 010 1.42l-7.3 7.3a1 1 0 01-1.42 0l-3.3-3.3a1 1 0 011.42-1.42l2.59 2.59 6.59-6.59a1 1 0 011.42 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Thank you!</h1>
              <p className="text-sm text-gray-500 mt-2">
                Your submission has been received. We’ll be in touch soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <h1 className="text-xl font-semibold text-gray-900">{form.title}</h1>
              {form.description && (
                <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{form.description}</p>
              )}

              {/* Honeypot — invisible to real users, attractive to bots. */}
              <div
                aria-hidden="true"
                style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
              >
                <label>
                  Website (leave this blank)
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

              <div className="mt-5 space-y-4">
                {form.fields.map((f) => {
                  const id = `field-${f.key}`;
                  const common = {
                    id,
                    name: f.key,
                    required: !!f.required,
                    value: values[f.key] ?? '',
                    onChange: (
                      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
                    ) => setValues((prev) => ({ ...prev, [f.key]: e.target.value })),
                    className:
                      'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white',
                  };
                  return (
                    <div key={f.key}>
                      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
                        {f.label}
                        {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea {...common} rows={4} />
                      ) : f.type === 'select' ? (
                        <select {...common}>
                          <option value="">Select…</option>
                          {(f.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          {...common}
                          type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {submitError && (
                <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="mt-6 w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>

              <p className="text-[11px] text-gray-400 text-center mt-4">
                Powered by AppoinlyCRM
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
