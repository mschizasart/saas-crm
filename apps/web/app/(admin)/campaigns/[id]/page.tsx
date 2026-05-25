'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form-field';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: string;
  segmentType: 'all_clients' | 'all_leads' | 'lead_status' | 'manual';
  segmentConfig: Record<string, unknown>;
  scheduledAt: string | null;
  sentAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
}

interface LeadStatus {
  id: string;
  name: string;
}

interface PreviewResult {
  total: number;
  sample: { email: string; name: string | null; recipientType: string }[];
}

interface Stats {
  status: string;
  totalRecipients: number;
  sent: number;
  failed: number;
  pending: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  openRate: number;
  clickRate: number;
}

const SEGMENTS: { value: Campaign['segmentType']; label: string }[] = [
  { value: 'all_clients', label: 'All clients' },
  { value: 'all_leads', label: 'All leads' },
  { value: 'lead_status', label: 'Leads by status' },
  { value: 'manual', label: 'Manual select (lead IDs)' },
];

export default function CampaignEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  // Local editable fields
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [segmentType, setSegmentType] =
    useState<Campaign['segmentType']>('all_clients');
  const [statusId, setStatusId] = useState('');
  const [manualIds, setManualIds] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const readOnly =
    campaign?.status === 'sending' || campaign?.status === 'sent';

  const loadCampaign = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/campaigns/${id}`);
      if (!res.ok) {
        toast.error('Campaign not found');
        router.push('/campaigns');
        return;
      }
      const c: Campaign = await res.json();
      setCampaign(c);
      setName(c.name);
      setSubject(c.subject);
      setBody(c.body);
      setSegmentType(c.segmentType);
      setStatusId((c.segmentConfig?.statusId as string) ?? '');
      const ids = c.segmentConfig?.ids;
      setManualIds(Array.isArray(ids) ? ids.join(', ') : '');
      setScheduledAt(c.scheduledAt ? c.scheduledAt.slice(0, 16) : '');
      if (c.status === 'sent' || c.status === 'sending') {
        loadStats();
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  const loadStats = useCallback(async () => {
    const res = await apiFetch(`/api/v1/campaigns/${id}/stats`);
    if (res.ok) setStats(await res.json());
  }, [id]);

  useEffect(() => {
    loadCampaign();
    apiFetch('/api/v1/leads/admin/statuses')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setStatuses(Array.isArray(d) ? d : (d?.data ?? [])))
      .catch(() => undefined);
  }, [loadCampaign]);

  function buildSegmentConfig(): Record<string, unknown> {
    if (segmentType === 'lead_status') return { statusId };
    if (segmentType === 'manual') {
      return {
        ids: manualIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }
    return {};
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/v1/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          subject,
          body,
          segmentType,
          segmentConfig: buildSegmentConfig(),
          scheduledAt: scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not save campaign');
        return false;
      }
      setCampaign(await res.json());
      toast.success('Saved');
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      // Save first so the segment config on the server matches the UI.
      if (!(await save())) return;
      const res = await apiFetch(
        `/api/v1/campaigns/${id}/preview-recipients`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not resolve recipients');
        return;
      }
      setPreview(await res.json());
    } finally {
      setPreviewing(false);
    }
  }

  async function sendNow() {
    if (
      !confirm(
        'Send this campaign now? This will email every resolved recipient.',
      )
    )
      return;
    setSending(true);
    try {
      if (!(await save())) return;
      const res = await apiFetch(`/api/v1/campaigns/${id}/send`, {
        method: 'POST',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e?.message ?? 'Could not start send');
        return;
      }
      const r = await res.json();
      toast.success(`Queued ${r.totalRecipients} emails`);
      loadCampaign();
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }
  if (!campaign) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-1">
      <PageHeader
        title={name || 'Untitled campaign'}
        backHref="/campaigns"
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge
              variant={
                campaign.status === 'sent'
                  ? 'success'
                  : campaign.status === 'sending'
                    ? 'warning'
                    : campaign.status === 'failed'
                      ? 'error'
                      : 'muted'
              }
            >
              {campaign.status}
            </Badge>
          </span>
        }
      >
        {!readOnly && (
          <>
            <Button variant="secondary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="primary" onClick={sendNow} disabled={sending}>
              {sending ? 'Sending…' : 'Send now'}
            </Button>
          </>
        )}
      </PageHeader>

      {/* ── Stats panel (once sending/sent) ──────────────────────── */}
      {(campaign.status === 'sent' || campaign.status === 'sending') &&
        stats && (
          <Card padding="md">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Performance
              </h2>
              <button
                onClick={loadStats}
                className="text-xs text-primary hover:underline"
              >
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Sent" value={stats.sent} />
              <Stat label="Failed" value={stats.failed} />
              <Stat
                label="Opens"
                value={`${stats.uniqueOpens} (${stats.openRate}%)`}
              />
              <Stat
                label="Clicks"
                value={`${stats.uniqueClicks} (${stats.clickRate}%)`}
              />
            </div>
          </Card>
        )}

      {/* ── Editor ───────────────────────────────────────────────── */}
      <Card padding="md" className="space-y-4">
        <FormField label="Campaign name" required>
          <input
            className={inputClass}
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField label="Subject" required>
          <input
            className={inputClass}
            value={subject}
            disabled={readOnly}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject line"
          />
        </FormField>

        <FormField
          label="Body"
          hint="An unsubscribe link is added automatically. Links are click-tracked."
        >
          {readOnly ? (
            <CampaignBodyPreview body={body} />
          ) : (
            <RichTextEditor value={body} onChange={setBody} minHeight="260px" />
          )}
        </FormField>
      </Card>

      {/* ── Segment picker ───────────────────────────────────────── */}
      <Card padding="md" className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Recipients
        </h2>

        <FormField label="Segment">
          <select
            className={inputClass}
            value={segmentType}
            disabled={readOnly}
            onChange={(e) =>
              setSegmentType(e.target.value as Campaign['segmentType'])
            }
          >
            {SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FormField>

        {segmentType === 'lead_status' && (
          <FormField label="Lead status">
            <select
              className={inputClass}
              value={statusId}
              disabled={readOnly}
              onChange={(e) => setStatusId(e.target.value)}
            >
              <option value="">Select a status…</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {segmentType === 'manual' && (
          <FormField
            label="Lead IDs"
            hint="Comma-separated lead IDs to email."
          >
            <input
              className={inputClass}
              value={manualIds}
              disabled={readOnly}
              onChange={(e) => setManualIds(e.target.value)}
              placeholder="id1, id2, id3"
            />
          </FormField>
        )}

        {!readOnly && (
          <div>
            <Button
              variant="secondary"
              onClick={runPreview}
              disabled={previewing}
            >
              {previewing ? 'Resolving…' : 'Preview recipients'}
            </Button>
          </div>
        )}

        {preview && (
          <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
            <p className="text-sm font-medium mb-2">
              {preview.total} recipient{preview.total === 1 ? '' : 's'}
              {preview.total > preview.sample.length &&
                ` (showing first ${preview.sample.length})`}
            </p>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 max-h-48 overflow-y-auto">
              {preview.sample.map((r) => (
                <li key={r.email} className="flex justify-between gap-2">
                  <span className="truncate">{r.email}</span>
                  <span className="text-gray-400">{r.name ?? r.recipientType}</span>
                </li>
              ))}
              {preview.sample.length === 0 && (
                <li className="text-gray-400">No recipients matched.</li>
              )}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Schedule ─────────────────────────────────────────────── */}
      {!readOnly && (
        <Card padding="md">
          <FormField
            label="Schedule (optional)"
            hint="Set a date to mark this as scheduled. Use “Send now” to send immediately."
          >
            <input
              type="datetime-local"
              className={inputClass}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </FormField>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
        {value}
      </p>
    </div>
  );
}

/**
 * Read-only preview of an admin-authored campaign body. The body is untrusted
 * HTML (any staff member can author it), so we render it inside a sandboxed
 * iframe — NO `allow-scripts` — which neutralizes inline JS, event handlers,
 * top-frame navigation and form submission. This mirrors the inbox feature's
 * MessageBody renderer. Never use dangerouslySetInnerHTML for the body: that
 * would execute author-supplied script in every viewer's session (stored XSS).
 */
function CampaignBodyPreview({ body }: { body: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(260);

  // Auto-size the iframe to its content height.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const h = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          120,
        );
        setIframeHeight(Math.min(h + 16, 4000));
      } catch {
        /* sandboxed without same-origin → leave default */
      }
    };
    iframe.addEventListener('load', measure);
    return () => iframe.removeEventListener('load', measure);
  }, [body]);

  const srcDoc = useMemo(
    () => `<!doctype html>
<html><head><meta charset="utf-8" /><base target="_blank" /><style>
body { font: 13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color: #1f2937; margin: 0; padding: 8px; word-wrap: break-word; }
@media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0b0f17; } a { color: #60a5fa; } }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
blockquote { border-left: 3px solid #d1d5db; margin: 0; padding: 0 0.75rem; color: #6b7280; }
</style></head><body>${body}</body></html>`,
    [body],
  );

  return (
    <iframe
      ref={iframeRef}
      title="Campaign body preview"
      srcDoc={srcDoc}
      // sandbox WITHOUT allow-scripts blocks <script>, inline JS, popups,
      // top-nav and form submission. allow-popups so legit links open externally.
      sandbox="allow-popups"
      referrerPolicy="no-referrer"
      className="w-full border border-gray-200 dark:border-gray-800 rounded-lg bg-white"
      style={{ height: iframeHeight }}
    />
  );
}
