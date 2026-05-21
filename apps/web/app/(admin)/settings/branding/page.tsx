'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';

interface Branding {
  name: string;
  slug: string;
  logo: string | null;
  customDomain: string | null;
  brandPrimaryColor: string | null;
  brandSidebarColor: string | null;
  brandFaviconUrl: string | null;
  brandEmailFooter: string | null;
  whiteLabelEnabled: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_PRIMARY = '#3B82F6';
const DEFAULT_SIDEBAR = '#0F172A';

export default function BrandingSettingsPage() {
  const [form, setForm] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/me/branding');
        if (res.ok) setForm(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof Branding>(k: K, v: Branding[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    // Client-side guard mirrors the server's strict-hex validation.
    for (const [label, val] of [
      ['Primary color', form.brandPrimaryColor],
      ['Sidebar color', form.brandSidebarColor],
    ] as const) {
      if (val && !HEX.test(val)) {
        toast.error(`${label} must be a 6-digit hex value like #3B82F6`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/organizations/me/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo: form.logo,
          brandPrimaryColor: form.brandPrimaryColor,
          brandSidebarColor: form.brandSidebarColor,
          brandFaviconUrl: form.brandFaviconUrl,
          brandEmailFooter: form.brandEmailFooter,
          whiteLabelEnabled: form.whiteLabelEnabled,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Save failed (${res.status})`);
      }
      toast.success('Branding saved — reload to see it applied');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <SettingsPageLayout title="Branding" description="White-label this workspace.">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      </SettingsPageLayout>
    );
  }

  const primary = form.brandPrimaryColor || DEFAULT_PRIMARY;
  const sidebar = form.brandSidebarColor || DEFAULT_SIDEBAR;

  return (
    <SettingsPageLayout
      title="Branding"
      description="Make this workspace your own — logo, colors, and email footer. Changes apply to your whole organization."
    >
      <SettingsSection
        title="White-label"
        description="When off, the platform's default theme is used."
      >
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.whiteLabelEnabled}
            onChange={(e) => set('whiteLabelEnabled', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          <span className="text-gray-700 dark:text-gray-300">
            Enable custom branding for this organization
          </span>
        </label>
      </SettingsSection>

      <SettingsSection title="Logo" description="Shown in the sidebar and on emails.">
        <FormField label="Logo URL">
          <input
            value={form.logo ?? ''}
            onChange={(e) => set('logo', e.target.value || null)}
            className={inputClass}
            placeholder="https://…/logo.png"
          />
        </FormField>
        <div className="mt-3">
          <FormField label="Favicon URL">
            <input
              value={form.brandFaviconUrl ?? ''}
              onChange={(e) => set('brandFaviconUrl', e.target.value || null)}
              className={inputClass}
              placeholder="https://…/favicon.ico"
            />
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection title="Colors" description="6-digit hex, e.g. #3B82F6.">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Primary / accent</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX.test(primary) ? primary : DEFAULT_PRIMARY}
                onChange={(e) => set('brandPrimaryColor', e.target.value)}
                className="w-10 h-9 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
                aria-label="Primary color"
              />
              <input
                value={form.brandPrimaryColor ?? ''}
                onChange={(e) => set('brandPrimaryColor', e.target.value || null)}
                className={`${inputClass} w-32 font-mono`}
                placeholder={DEFAULT_PRIMARY}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Sidebar background</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX.test(sidebar) ? sidebar : DEFAULT_SIDEBAR}
                onChange={(e) => set('brandSidebarColor', e.target.value)}
                className="w-10 h-9 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
                aria-label="Sidebar color"
              />
              <input
                value={form.brandSidebarColor ?? ''}
                onChange={(e) => set('brandSidebarColor', e.target.value || null)}
                className={`${inputClass} w-32 font-mono`}
                placeholder={DEFAULT_SIDEBAR}
              />
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="mt-6">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-2">Preview</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 max-w-sm">
            <div className="w-20 p-3 flex flex-col gap-2" style={{ backgroundColor: sidebar }}>
              <div className="w-6 h-6 rounded" style={{ backgroundColor: primary }} />
              <div className="h-2 rounded bg-white/30" />
              <div className="h-2 rounded bg-white/20" />
            </div>
            <div className="flex-1 p-3 bg-white dark:bg-gray-900">
              <div className="h-2 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-2" />
              <button
                className="text-xs text-white px-2 py-1 rounded"
                style={{ backgroundColor: primary }}
                type="button"
              >
                Button
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Email footer"
        description="Appended to outgoing emails. Plain text or simple HTML."
      >
        <textarea
          value={form.brandEmailFooter ?? ''}
          onChange={(e) => set('brandEmailFooter', e.target.value || null)}
          className={`${inputClass} min-h-[100px] font-mono text-xs`}
          placeholder="Acme Ltd · 12 High St · Reply to support@acme.com"
        />
      </SettingsSection>

      {form.customDomain && (
        <SettingsSection title="Custom domain" description="Managed by your administrator.">
          <div className="text-sm text-gray-700 dark:text-gray-300 font-mono">{form.customDomain}</div>
        </SettingsSection>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={saving}>
          Save branding
        </Button>
      </div>
    </SettingsPageLayout>
  );
}
