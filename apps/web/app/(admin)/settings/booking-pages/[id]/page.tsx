'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { Button } from '@/components/ui/button';
import { apiFetch, parseApiErrors } from '@/lib/api';
import { toast } from 'sonner';

// ── Working-hours JSON shape ──
//   workingHours = { mon: [{ start, end }], tue: [...], ... }  (HH:MM 24h)
// A weekday with an empty array (or absent) means "not available that day".
type TimeRange = { start: string; end: string };
type WorkingHours = Record<string, TimeRange[]>;

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const DEFAULT_RANGE: TimeRange = { start: '09:00', end: '17:00' };

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface BookingPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  staffId: string;
  durationMinutes: number;
  bufferMinutes: number;
  minLeadTimeHours: number;
  maxAdvanceDays: number;
  timezone: string;
  workingHours: WorkingHours;
  meetingLocation: string | null;
  active: boolean;
  publicUrl: string;
}

const inputCls =
  'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function BookingPageEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const isNew = id === 'new';

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [staffId, setStaffId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [minLeadTimeHours, setMinLeadTimeHours] = useState(4);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(30);
  const [timezone, setTimezone] = useState(browserTz());
  const [meetingLocation, setMeetingLocation] = useState('');
  const [active, setActive] = useState(true);
  const [publicUrl, setPublicUrl] = useState('');

  // Working hours: per-day enabled flag + ranges.
  const [hours, setHours] = useState<WorkingHours>(() => ({
    mon: [{ ...DEFAULT_RANGE }],
    tue: [{ ...DEFAULT_RANGE }],
    wed: [{ ...DEFAULT_RANGE }],
    thu: [{ ...DEFAULT_RANGE }],
    fri: [{ ...DEFAULT_RANGE }],
    sat: [],
    sun: [],
  }));

  // Auto-slug from title until the user edits slug manually.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  // Load staff for the dropdown.
  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/v1/users?limit=200');
      if (res.ok) {
        const json = await res.json();
        const list: StaffUser[] = Array.isArray(json) ? json : (json.data ?? []);
        setStaff(list);
      }
    })();
  }, []);

  // Load existing page (edit mode).
  const loadPage = useCallback(async () => {
    if (isNew || !id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/booking-pages/${id}`);
      if (!res.ok) {
        toast.error('Could not load booking page');
        return;
      }
      const p: BookingPage = await res.json();
      setTitle(p.title);
      setSlug(p.slug);
      setSlugTouched(true);
      setDescription(p.description ?? '');
      setStaffId(p.staffId);
      setDurationMinutes(p.durationMinutes);
      setBufferMinutes(p.bufferMinutes);
      setMinLeadTimeHours(p.minLeadTimeHours);
      setMaxAdvanceDays(p.maxAdvanceDays);
      setTimezone(p.timezone || browserTz());
      setMeetingLocation(p.meetingLocation ?? '');
      setActive(p.active);
      setPublicUrl(p.publicUrl ?? '');
      if (p.workingHours && typeof p.workingHours === 'object') {
        const normalized: WorkingHours = {};
        for (const d of DAYS) normalized[d.key] = p.workingHours[d.key] ?? [];
        setHours(normalized);
      }
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // ── Working-hours editing helpers ──
  function toggleDay(day: string, enabled: boolean) {
    setHours((prev) => ({
      ...prev,
      [day]: enabled ? (prev[day]?.length ? prev[day] : [{ ...DEFAULT_RANGE }]) : [],
    }));
  }
  function updateRange(day: string, idx: number, field: 'start' | 'end', value: string) {
    setHours((prev) => ({
      ...prev,
      [day]: prev[day].map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    }));
  }
  function addRange(day: string) {
    setHours((prev) => ({ ...prev, [day]: [...(prev[day] ?? []), { ...DEFAULT_RANGE }] }));
  }
  function removeRange(day: string, idx: number) {
    setHours((prev) => ({ ...prev, [day]: prev[day].filter((_, i) => i !== idx) }));
  }

  const tzOptions = useMemo(() => {
    // Prefer the full IANA list when the runtime exposes it; fall back to a
    // small curated set + whatever value is currently selected.
    const supported =
      typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
        .supportedValuesOf === 'function'
        ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
            'timeZone',
          )
        : ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Athens', 'Asia/Dubai'];
    return Array.from(new Set([timezone, ...supported]));
  }, [timezone]);

  async function save() {
    setSaving(true);
    try {
      const body = {
        slug,
        title,
        description: description.trim() || null,
        staffId,
        durationMinutes: Number(durationMinutes),
        bufferMinutes: Number(bufferMinutes),
        minLeadTimeHours: Number(minLeadTimeHours),
        maxAdvanceDays: Number(maxAdvanceDays),
        timezone,
        workingHours: hours,
        meetingLocation: meetingLocation.trim() || null,
        active,
      };
      const res = await apiFetch(
        isNew ? '/api/v1/booking-pages' : `/api/v1/booking-pages/${id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errs = await parseApiErrors(res, 'Could not save booking page');
        errs.forEach((e) => toast.error(e));
        return;
      }
      const saved: BookingPage = await res.json();
      toast.success('Booking page saved');
      if (isNew) {
        router.push(`/settings/booking-pages/${saved.id}`);
      } else {
        setPublicUrl(saved.publicUrl ?? publicUrl);
      }
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Public link copied');
    } catch {
      toast.error('Could not copy link');
    }
  }

  if (loading) {
    return (
      <SettingsPageLayout title="Booking page">
        <p className="text-sm text-gray-500">Loading…</p>
      </SettingsPageLayout>
    );
  }

  const canSave = !!title && !!slug && !!staffId && durationMinutes > 0;

  return (
    <SettingsPageLayout
      title={isNew ? 'New booking page' : 'Edit booking page'}
      description="Configure a public self-service scheduling page"
    >
      <SettingsSection title="Details" description="Basic information shown to visitors">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Slug *</label>
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              className={`${inputCls} font-mono`}
            />
            <p className="text-xs text-gray-400 mt-1">Used in the public URL.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Staff member *</label>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
              <option value="">-- Select staff --</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Meeting location
            </label>
            <input
              value={meetingLocation}
              onChange={(e) => setMeetingLocation(e.target.value)}
              placeholder="e.g. Google Meet, Phone call, Office address"
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (visible &amp; bookable)
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="Scheduling rules" description="Control duration, buffers and the booking window">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Duration (minutes) *</label>
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Buffer between bookings (minutes)</label>
            <input
              type="number"
              min={0}
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Minimum lead time (hours)</label>
            <input
              type="number"
              min={0}
              value={minLeadTimeHours}
              onChange={(e) => setMinLeadTimeHours(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Maximum advance (days)</label>
            <input
              type="number"
              min={1}
              value={maxAdvanceDays}
              onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Working hours below are interpreted in this timezone.
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Working hours" description="When this page accepts bookings, per weekday">
        <div className="space-y-3">
          {DAYS.map((d) => {
            const ranges = hours[d.key] ?? [];
            const enabled = ranges.length > 0;
            return (
              <div key={d.key} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm font-medium mb-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleDay(d.key, e.target.checked)}
                  />
                  {d.label}
                </label>
                {!enabled ? (
                  <p className="text-xs text-gray-400 pl-6">Unavailable</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {ranges.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={r.start}
                          onChange={(e) => updateRange(d.key, idx, 'start', e.target.value)}
                          className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={r.end}
                          onChange={(e) => updateRange(d.key, idx, 'end', e.target.value)}
                          className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                        />
                        {ranges.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRange(d.key, idx)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addRange(d.key)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add time range
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {!isNew && publicUrl && (
        <SettingsSection title="Public link" description="Share this URL so visitors can book">
          <div className="flex items-center gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline truncate"
            >
              {publicUrl}
            </a>
            <Button variant="secondary" size="sm" onClick={copyLink}>
              Copy
            </Button>
          </div>
        </SettingsSection>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push('/settings/booking-pages')}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !canSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </SettingsPageLayout>
  );
}
