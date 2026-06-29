'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Public self-service booking page (Calendly-style) — renders at
// /book/{orgSlug}/{pageSlug}. Intentionally kept OUTSIDE every (admin)/(auth)/
// (portal) route group so it stays accessible WITHOUT a session. There is no
// middleware in this app; auth is gated per route-group layout, and the root
// layout only wires providers/theme. This page therefore needs no auth bypass
// beyond living at a top-level route and using PLAIN fetch (never apiFetch,
// which injects/refreshes a JWT and redirects to /login on 401).
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PageConfig {
  org: { name: string; logo?: string | null };
  page: {
    slug: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    timezone: string;
    meetingLocation: string | null;
    staff: { name: string; avatar?: string | null; jobTitle?: string | null };
  };
}

interface Slot {
  start: string; // ISO UTC
  end: string; // ISO UTC
}

// Render a UTC ISO instant in the visitor's chosen timezone.
function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

function fmtDateLong(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
}

// YYYY-MM-DD for a Date in local terms (used for the slots query + strip).
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function PublicBookingPage() {
  const params = useParams<{ orgSlug: string; pageSlug: string }>();
  const orgSlug = params?.orgSlug;
  const pageSlug = params?.pageSlug;

  // Visitor timezone (best-effort; falls back to UTC).
  const visitorTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const [config, setConfig] = useState<PageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Next 14 days strip; default-select today.
  const days = useMemo(() => {
    const out: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(() => toDateKey(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  // After a successful POST /book the booking is NOT confirmed yet — the visitor
  // must click a link emailed to them (double opt-in). We capture the slot/email
  // here to render the "check your email" state.
  const [pending, setPending] = useState<{ startTime: string; endTime: string; email: string } | null>(
    null,
  );

  // ── Load page config ──
  useEffect(() => {
    if (!orgSlug || !pageSlug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/public/booking/${encodeURIComponent(orgSlug)}/${encodeURIComponent(pageSlug)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (res.status === 404) throw new Error('This booking page is not available.');
          throw new Error(`Failed to load (${res.status})`);
        }
        const data: PageConfig = await res.json();
        if (!cancelled) setConfig(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, pageSlug]);

  // ── Load slots for the selected date ──
  const loadSlots = useCallback(async () => {
    if (!orgSlug || !pageSlug || !selectedDate) return;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/public/booking/${encodeURIComponent(orgSlug)}/${encodeURIComponent(
          pageSlug,
        )}/slots?date=${selectedDate}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Failed to load times (${res.status})`);
      const data: { slots?: Slot[] } = await res.json();
      setSlots(Array.isArray(data.slots) ? data.slots : []);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : 'Failed to load times');
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [orgSlug, pageSlug, selectedDate]);

  useEffect(() => {
    if (config) loadSlots();
  }, [config, loadSlots]);

  // ── Book ──
  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot || !orgSlug || !pageSlug) return;
    setSubmitting(true);
    setBookError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/public/booking/${encodeURIComponent(orgSlug)}/${encodeURIComponent(
          pageSlug,
        )}/book`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: selectedSlot.start,
            name,
            email,
            notes: notes.trim() || undefined,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          // Slot was taken between fetch and submit — refresh and bounce back.
          setBookError('Sorry, that time was just taken. Please pick another.');
          setSelectedSlot(null);
          loadSlots();
          return;
        }
        const msg = Array.isArray(json?.message)
          ? json.message.join(', ')
          : json?.message || `Booking failed (${res.status})`;
        throw new Error(msg);
      }
      // Double opt-in: the backend returns { status:'pending' } and emails a
      // confirmation link. The booking is NOT yet confirmed — show the
      // "check your email" state.
      setPending({
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        email,
      });
    } catch (err) {
      setBookError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render states ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Booking page not available</h1>
          <p className="text-sm text-gray-500">{loadError ?? 'Not found.'}</p>
        </div>
      </div>
    );
  }

  const { org, page } = config;

  if (pending) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="max-w-md w-full text-center bg-white rounded-xl border border-gray-100 shadow-sm p-8">
          <div className="w-14 h-14 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Almost there — check your email</h1>
          <p className="text-sm text-gray-700 mb-3">
            We&apos;ve sent a confirmation link to{' '}
            <span className="font-medium text-gray-900">{pending.email}</span>. Click it to finalize
            your booking for:
          </p>
          <p className="text-sm text-gray-700 mb-1">
            {fmtDateLong(pending.startTime, visitorTz)}
          </p>
          <p className="text-sm text-gray-700 mb-1">
            {fmtTime(pending.startTime, visitorTz)} – {fmtTime(pending.endTime, visitorTz)}
          </p>
          <p className="text-xs text-gray-400 mb-4">Times shown in {visitorTz}</p>
          <p className="text-xs text-gray-400">
            The link expires in 30 minutes. Your booking isn&apos;t confirmed until you click it.
          </p>
          <p className="text-[11px] text-gray-400 text-center mt-6">Powered by AppoinlyCRM</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr]">
        {/* ── Left: details ── */}
        <aside className="p-6 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50/60">
          {org.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo} alt={org.name} className="h-8 mb-4 object-contain" />
          ) : (
            <p className="text-sm font-semibold text-gray-500 mb-4">{org.name}</p>
          )}
          <div className="flex items-center gap-3 mb-4">
            {page.staff.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.staff.avatar}
                alt={page.staff.name}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                {page.staff.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-gray-900">{page.staff.name}</p>
              {page.staff.jobTitle && (
                <p className="text-xs text-gray-500">{page.staff.jobTitle}</p>
              )}
            </div>
          </div>
          <h1 className="text-lg font-bold text-gray-900">{page.title}</h1>
          {page.description && (
            <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{page.description}</p>
          )}
          <dl className="mt-4 space-y-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {page.durationMinutes} min
            </div>
            {page.meetingLocation && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {page.meetingLocation}
              </div>
            )}
          </dl>
        </aside>

        {/* ── Right: date + slots or form ── */}
        <section className="p-6">
          {!selectedSlot ? (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Select a date &amp; time</h2>
              <p className="text-xs text-gray-400 mb-4">Times shown in {visitorTz}</p>

              {/* Next-14-days strip */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                {days.map((d) => {
                  const key = toDateKey(d);
                  const active = key === selectedDate;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedDate(key);
                        setSelectedSlot(null);
                      }}
                      className={`flex-shrink-0 w-16 py-2 rounded-lg border text-center transition-colors ${
                        active
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-200 text-gray-700 hover:border-primary/50'
                      }`}
                    >
                      <span className="block text-[10px] uppercase">
                        {d.toLocaleDateString([], { weekday: 'short' })}
                      </span>
                      <span className="block text-lg font-semibold leading-none">{d.getDate()}</span>
                      <span className="block text-[10px]">
                        {d.toLocaleDateString([], { month: 'short' })}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Or pick any date */}
              <input
                type="date"
                value={selectedDate}
                min={toDateKey(new Date())}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSlot(null);
                }}
                className="mb-4 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />

              {/* Slots */}
              {slotsLoading ? (
                <p className="text-sm text-gray-400 py-8 text-center">Loading times…</p>
              ) : slotsError ? (
                <p className="text-sm text-red-600 py-8 text-center">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">
                  No available times on this day. Try another date.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(s);
                        setBookError(null);
                      }}
                      className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-700 hover:border-primary hover:text-primary transition-colors"
                    >
                      {fmtTime(s.start, visitorTz)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={book}>
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="text-xs text-gray-500 hover:text-primary mb-3 inline-flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Confirm your booking</h2>
              <p className="text-sm text-gray-700">{fmtDateLong(selectedSlot.start, visitorTz)}</p>
              <p className="text-sm text-gray-700 mb-1">
                {fmtTime(selectedSlot.start, visitorTz)} – {fmtTime(selectedSlot.end, visitorTz)}
              </p>
              <p className="text-xs text-gray-400 mb-4">Times shown in {visitorTz}</p>

              {bookError && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
                  {bookError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Notes <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !name || !email}
                className="mt-6 w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Booking…' : 'Confirm booking'}
              </button>
            </form>
          )}

          <p className="text-[11px] text-gray-400 text-center mt-6">Powered by AppoinlyCRM</p>
        </section>
      </div>
    </div>
  );
}
