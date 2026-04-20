'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form-field';

interface CalEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  allDay: boolean;
  type: string;
  color?: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const jsDow = first.getDay();
  const mondayOffset = (jsDow + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toInputDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    type: 'event',
    color: '#3b82f6',
    allDay: false,
  });

  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = new Date();

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const token = getToken();
      const res = await fetch(
        `${API_BASE}/api/v1/calendar/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const json = await res.json();
        setEvents(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const grid = buildMonthGrid(year, month);

  const eventsByDay = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const key = toInputDate(new Date(ev.startDate));
    const arr = eventsByDay.get(key) ?? [];
    arr.push(ev);
    eventsByDay.set(key, arr);
  }

  function openCreate(date: Date) {
    setEditingEvent(null);
    setSelectedDate(date);
    setForm({
      title: '',
      description: '',
      startDate: toInputDate(date) + 'T09:00',
      endDate: '',
      type: 'event',
      color: '#3b82f6',
      allDay: false,
    });
  }

  function openEdit(ev: CalEvent) {
    setEditingEvent(ev);
    setSelectedDate(null);
    setForm({
      title: ev.title,
      description: ev.description ?? '',
      startDate: ev.startDate.slice(0, 16),
      endDate: ev.endDate ? ev.endDate.slice(0, 16) : '',
      type: ev.type,
      color: ev.color ?? '#3b82f6',
      allDay: ev.allDay,
    });
  }

  function closeModal() {
    setSelectedDate(null);
    setEditingEvent(null);
  }

  async function save() {
    const token = getToken();
    const body = {
      title: form.title,
      description: form.description || undefined,
      startDate: new Date(form.startDate).toISOString(),
      endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
      type: form.type,
      color: form.color,
      allDay: form.allDay,
    };
    const url = editingEvent
      ? `${API_BASE}/api/v1/calendar/events/${editingEvent.id}`
      : `${API_BASE}/api/v1/calendar/events`;
    const method = editingEvent ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      closeModal();
      fetchEvents();
    }
  }

  async function remove() {
    if (!editingEvent) return;
    if (!confirm('Delete this event?')) return;
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/api/v1/calendar/events/${editingEvent.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok || res.status === 204) {
      closeModal();
      fetchEvents();
    }
  }

  async function fetchFeedUrl() {
    setFeedLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/calendar/feed-url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFeedUrl(data.feedUrl);
      }
    } finally {
      setFeedLoading(false);
    }
  }

  function copyFeedUrl() {
    if (!feedUrl) return;
    navigator.clipboard.writeText(feedUrl).then(() => {
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 2000);
    });
  }

  return (
    <div>
      <PageHeader title="Calendar">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowSyncPanel((v) => !v);
              if (!feedUrl) fetchFeedUrl();
            }}
          >
            Sync with Google Calendar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">&larr;</Button>
          <Button variant="secondary" size="sm" onClick={() => {
            const n = new Date();
            setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
          }}>Today</Button>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">&rarr;</Button>
          <span className="ml-4 text-lg font-semibold text-gray-800 dark:text-gray-200 min-w-[180px]">
            {MONTHS[month]} {year}
          </span>
        </div>
      </PageHeader>

      {showSyncPanel && (
        <Card padding="lg" className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Subscribe in Google Calendar
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Copy the URL below and paste it in Google Calendar: Other Calendars (+) &rarr; From URL.
            Events will sync automatically.
          </p>
          {feedLoading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">Generating feed URL...</p>
          ) : feedUrl ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="Calendar feed URL"
                type="text"
                readOnly
                value={feedUrl}
                className={`${inputClass} bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono text-xs`}
              />
              <Button variant="primary" size="sm" onClick={copyFeedUrl}>
                {feedCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-red-500">Failed to generate feed URL.</p>
          )}
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
            This link expires in 30 days. Generate a new one after expiry.
          </p>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-center"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((day, i) => {
            const isCurrentMonth = day.getMonth() === month;
            const isToday = sameDay(day, today);
            const key = toInputDate(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <div
                key={i}
                onClick={() => openCreate(day)}
                className={[
                  'min-h-[110px] border-b border-r border-gray-100 p-1.5 cursor-pointer hover:bg-gray-50/70 transition-colors',
                  isCurrentMonth ? 'bg-white' : 'bg-gray-50/30',
                ].join(' ')}
              >
                <div
                  className={[
                    'text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full',
                    isToday
                      ? 'bg-primary text-white'
                      : isCurrentMonth
                        ? 'text-gray-700'
                        : 'text-gray-300',
                  ].join(' ')}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(ev);
                      }}
                      className="text-[11px] px-1.5 py-0.5 rounded truncate text-white font-medium"
                      style={{ backgroundColor: ev.color ?? '#3b82f6' }}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-1">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {loading && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Loading events...</p>
      )}

      {(selectedDate || editingEvent) && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">
              {editingEvent ? 'Edit Event' : 'New Event'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputClass}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Start</label>
                  <input
                    type="datetime-local"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">End</label>
                  <input
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className={inputClass}
                  >
                    <option value="event">Event</option>
                    <option value="meeting">Meeting</option>
                    <option value="task_deadline">Task Deadline</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Color</label>
                  <input
                    aria-label="Event color"
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="w-full h-9 border border-gray-200 dark:border-gray-700 rounded"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                />
                All day
              </label>
            </div>
            <div className="flex items-center justify-between mt-6">
              {editingEvent ? (
                <Button variant="ghost" onClick={remove} className="text-red-600 hover:text-red-700">
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={save}
                  disabled={!form.title || !form.startDate}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
