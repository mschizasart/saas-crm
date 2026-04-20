'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CalendarEvent {
  id: string;
  title?: string;
  type?: string; // task | appointment | milestone | ...
  startsAt?: string;
  startDate?: string;
  start?: string;
  endsAt?: string;
  end?: string;
  allDay?: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function eventStart(ev: CalendarEvent): Date | null {
  const s = ev.startsAt ?? ev.startDate ?? ev.start;
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const TYPE_COLORS: Record<string, string> = {
  task: 'bg-amber-500',
  appointment: 'bg-blue-500',
  milestone: 'bg-purple-500',
  meeting: 'bg-indigo-500',
  reminder: 'bg-emerald-500',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PortalCalendarPage() {
  const router = useRouter();

  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }

    const from = startOfMonth(cursor).toISOString();
    const to = endOfMonth(cursor).toISOString();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // API auto-scopes portal contacts to events linked to their own clientId
        // (tasks/projects/appointments). Staff see all events.
        const res = await fetch(
          `${API_BASE}/api/v1/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.status === 401) {
          router.push('/portal/login');
          return;
        }
        if (!res.ok) throw new Error(`Failed to load calendar (${res.status})`);
        const json = await res.json();
        const list: CalendarEvent[] = json.data ?? json.items ?? json ?? [];
        setEvents(Array.isArray(list) ? list : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load calendar');
      } finally {
        setLoading(false);
      }
    })();
  }, [cursor, router]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = eventStart(ev);
      if (!d) continue;
      const key = ymd(d);
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const leading = first.getDay(); // 0=Sun
    const totalCells = Math.ceil((leading + last.getDate()) / 7) * 7;
    const startDate = new Date(first);
    startDate.setDate(first.getDate() - leading);
    return Array.from({ length: totalCells }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      return d;
    });
  }, [cursor]);

  const today = new Date();
  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  const selectedEvents = (eventsByDay.get(ymd(selected)) ?? []).slice().sort((a, b) => {
    const da = eventStart(a)?.getTime() ?? 0;
    const db = eventStart(b)?.getTime() ?? 0;
    return da - db;
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Calendar</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            ←
          </button>
          <button
            onClick={() => {
              const now = new Date();
              setCursor(startOfMonth(now));
              setSelected(now);
            }}
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Today
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{monthLabel}</p>
            {loading && <span className="text-xs text-gray-400 dark:text-gray-500">Loading…</span>}
          </div>
          <div className="grid grid-cols-7 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-2 py-2 text-center">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selected);
              const dayEvents = eventsByDay.get(ymd(d)) ?? [];
              return (
                <button
                  key={i}
                  onClick={() => setSelected(d)}
                  className={`relative min-h-[84px] px-2 py-2 text-left border-r border-b border-gray-100 last:border-r-0 transition-colors ${
                    inMonth ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 text-gray-400'
                  } ${isSelected ? 'ring-2 ring-primary ring-inset' : ''}`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                      isToday ? 'bg-primary text-white' : inMonth ? 'text-gray-800' : 'text-gray-400'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {dayEvents.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dayEvents.slice(0, 4).map((ev) => (
                        <span
                          key={ev.id}
                          className={`inline-block w-1.5 h-1.5 rounded-full ${TYPE_COLORS[ev.type ?? ''] ?? 'bg-gray-400'}`}
                          title={ev.title ?? ''}
                        />
                      ))}
                      {dayEvents.length > 4 && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">+{dayEvents.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
            {selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No events on this day.</p>
          ) : (
            <ul className="space-y-3">
              {selectedEvents.map((ev) => {
                const start = eventStart(ev);
                const timeLabel = ev.allDay ? 'All day' : formatTime(start?.toISOString());
                return (
                  <li key={ev.id} className="border-l-2 border-primary pl-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{ev.title ?? 'Untitled'}</p>
                      {timeLabel && <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{timeLabel}</span>}
                    </div>
                    {ev.type && (
                      <span
                        className={`inline-flex items-center gap-1.5 mt-1 text-xs text-gray-500`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[ev.type] ?? 'bg-gray-400'}`} />
                        {ev.type}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
