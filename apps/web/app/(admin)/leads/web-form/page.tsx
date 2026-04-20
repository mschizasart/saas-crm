'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PUBLIC_API_HOST = 'http://api.appoinlycrm.net';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

interface FieldConfig {
  key: string;
  label: string;
  type: string;
  required: boolean;
  alwaysOn?: boolean;
  enabled: boolean;
}

const DEFAULT_FIELDS: FieldConfig[] = [
  { key: 'name', label: 'Your Name', type: 'text', required: true, alwaysOn: true, enabled: true },
  { key: 'email', label: 'Email', type: 'email', required: true, alwaysOn: true, enabled: true },
  { key: 'phone', label: 'Phone', type: 'tel', required: false, enabled: true },
  { key: 'company', label: 'Company', type: 'text', required: false, enabled: true },
  { key: 'message', label: 'Message', type: 'textarea', required: false, enabled: true },
];

export default function WebFormPage() {
  const [orgSlug, setOrgSlug] = useState<string>('');
  const [fields, setFields] = useState<FieldConfig[]>(DEFAULT_FIELDS);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const slug = data.organization?.slug ?? data.org?.slug ?? '';
          setOrgSlug(slug);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  function toggleField(key: string) {
    setFields(prev =>
      prev.map(f => f.key === key && !f.alwaysOn ? { ...f, enabled: !f.enabled } : f),
    );
  }

  const formAction = `${PUBLIC_API_HOST}/api/v1/leads/web-form?orgSlug=${orgSlug || 'YOUR_SLUG'}`;

  const embedCode = useMemo(() => {
    const enabled = fields.filter(f => f.enabled);
    const inputLines = enabled.map(f => {
      if (f.type === 'textarea') {
        return `  <textarea name="${f.key}" placeholder="${f.label}"${f.required ? ' required' : ''} style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:14px;resize:vertical;min-height:80px"></textarea>`;
      }
      return `  <input name="${f.key}" type="${f.type}" placeholder="${f.label}"${f.required ? ' required' : ''} style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:14px" />`;
    });

    return `<form action="${formAction}" method="POST" style="max-width:420px;font-family:system-ui,sans-serif">
${inputLines.join('\n')}
  <button type="submit" style="width:100%;padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer">Submit</button>
</form>`;
  }, [fields, formAction]);

  function copyCode() {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/leads" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary">
          ← Back to leads
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Web-to-Lead Form</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Generate an embeddable HTML form that captures leads directly into your CRM without requiring authentication.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Field Configuration</h2>
            <div className="space-y-3">
              {fields.map(f => (
                <label key={f.key} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={f.alwaysOn}
                    onChange={() => toggleField(f.key)}
                    className="rounded border-gray-300"
                  />
                  <span className={f.enabled ? 'text-gray-900' : 'text-gray-400'}>
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                    {f.alwaysOn && <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">(always on)</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Embed Code</h2>
              <button
                onClick={copyCode}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
            <pre className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
              {embedCode}
            </pre>
            {!orgSlug && (
              <p className="mt-3 text-xs text-amber-600">
                Could not detect your organization slug. Replace YOUR_SLUG in the code above with your actual organization slug.
              </p>
            )}
          </div>
        </div>

        {/* Preview */}
        <div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Form Preview</h2>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-gray-50 dark:bg-gray-900">
              <div style={{ maxWidth: 420, fontFamily: 'system-ui, sans-serif' }}>
                {fields.filter(f => f.enabled).map(f => (
                  <div key={f.key} style={{ marginBottom: 10 }}>
                    {f.type === 'textarea' ? (
                      <textarea
                        placeholder={f.label}
                        disabled
                        style={{
                          width: '100%',
                          padding: 10,
                          border: '1px solid #ddd',
                          borderRadius: 6,
                          fontFamily: 'inherit',
                          fontSize: 14,
                          resize: 'vertical',
                          minHeight: 80,
                          background: '#fff',
                        }}
                      />
                    ) : (
                      <input
                        type={f.type}
                        placeholder={f.label}
                        disabled
                        style={{
                          width: '100%',
                          padding: 10,
                          border: '1px solid #ddd',
                          borderRadius: 6,
                          fontFamily: 'inherit',
                          fontSize: 14,
                          background: '#fff',
                        }}
                      />
                    )}
                  </div>
                ))}
                <button
                  disabled
                  style={{
                    width: '100%',
                    padding: '10px 20px',
                    background: '#4f46e5',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: 'not-allowed',
                    opacity: 0.8,
                  }}
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
