'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface ClockEntry {
  id: string;
  clockIn: string;
  clockOut?: string | null;
  totalMinutes?: number | null;
  note?: string | null;
  user?: { id: string; firstName: string; lastName: string };
}

interface StaffStatus {
  userId: string;
  name: string;
  clockedIn: boolean;
  activeEntry: ClockEntry | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatElapsed(startIso: string): string {
  const elapsed = Math.floor((Date.now() - new Date(startIso).getTime()) / 60000);
  return formatDuration(elapsed);
}

export default function ClockPage() {
  const [activeEntry, setActiveEntry] = useState<ClockEntry | null>(null);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [todayReport, setTodayReport] = useState<{ staff: StaffStatus[]; clockedInCount: number; totalStaff: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, entriesRes, todayRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/clock/status`, { headers: headers() }),
        fetch(`${API_BASE}/api/v1/clock/entries?limit=20`, { headers: headers() }),
        fetch(`${API_BASE}/api/v1/clock/today`, { headers: headers() }),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setActiveEntry(data);
      }
      if (entriesRes.ok) {
        const data = await entriesRes.json();
        setEntries(data.data ?? []);
      }
      if (todayRes.ok) {
        const data = await todayRes.json();
        setTodayReport(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeEntry?.clockIn && !activeEntry.clockOut) {
      setElapsed(formatElapsed(activeEntry.clockIn));
      timerRef.current = setInterval(() => {
        setElapsed(formatElapsed(activeEntry.clockIn));
      }, 10000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    } else {
      setElapsed('');
    }
  }, [activeEntry]);

  async function clockIn() {
    setActing(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clock/in`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ note: note || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      setNote('');
      setMessage('Clocked in');
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  async function clockOut() {
    setActing(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clock/out`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      setMessage('Clocked out');
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  const weeklySummary = (() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const days: { label: string; minutes: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dayStr = day.toISOString().slice(0, 10);
      const dayLabel = day.toLocaleDateString('en', { weekday: 'short' });

      let totalMin = 0;
      for (const entry of entries) {
        const entryDate = entry.clockIn.slice(0, 10);
        if (entryDate === dayStr && entry.totalMinutes) {
          totalMin += entry.totalMinutes;
        }
      }
      days.push({ label: dayLabel, minutes: totalMin });
    }
    return days;
  })();

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  const isClockedIn = activeEntry && !activeEntry.clockOut;

  return (
    <div>
      <PageHeader title="Clock In / Out" />

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">
          {message}
        </div>
      )}

      {/* Clock In/Out Card */}
      <Card padding="lg" className="mb-6 text-center">
        {isClockedIn ? (
          <>
            <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">Clocked in since {formatTime(activeEntry.clockIn)}</div>
            <div className="text-4xl font-bold text-primary mb-4 tabular-nums">{elapsed}</div>
            {activeEntry.note && <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">Note: {activeEntry.note}</div>}
            <Button
              variant="destructive"
              size="lg"
              onClick={clockOut}
              disabled={acting}
              loading={acting}
              className="px-8 py-3 font-semibold"
            >
              {acting ? 'Processing...' : 'Clock Out'}
            </Button>
          </>
        ) : (
          <>
            <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">You are not clocked in</div>
            <div className="flex items-center justify-center gap-2 mb-4 max-w-sm mx-auto">
              <input
                aria-label="Clock-in note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note..."
                className={`${inputClass} flex-1`}
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={clockIn}
              disabled={acting}
              loading={acting}
              className="px-8 py-3 font-semibold bg-green-600 hover:bg-green-700"
            >
              {acting ? 'Processing...' : 'Clock In'}
            </Button>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Log */}
        <Card padding="lg">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Today&apos;s Log</h2>
          {entries.filter((e) => e.clockIn.slice(0, 10) === new Date().toISOString().slice(0, 10)).length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No entries today</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                  <th className="pb-2">Clock In</th>
                  <th className="pb-2">Clock Out</th>
                  <th className="pb-2">Duration</th>
                  <th className="pb-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .filter((e) => e.clockIn.slice(0, 10) === new Date().toISOString().slice(0, 10))
                  .map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-50">
                      <td className="py-2 text-gray-600 dark:text-gray-400">{formatTime(entry.clockIn)}</td>
                      <td className="py-2 text-gray-600 dark:text-gray-400">
                        {entry.clockOut ? formatTime(entry.clockOut) : <Badge variant="success">Active</Badge>}
                      </td>
                      <td className="py-2 text-gray-600 dark:text-gray-400">
                        {entry.totalMinutes != null ? formatDuration(entry.totalMinutes) : '--'}
                      </td>
                      <td className="py-2 text-gray-400 dark:text-gray-500 text-xs">{entry.note || '--'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Weekly Summary */}
        <Card padding="lg">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Weekly Summary</h2>
          <div className="space-y-2">
            {weeklySummary.map((day) => (
              <div key={day.label} className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-10">{day.label}</span>
                <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (day.minutes / 480) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400 w-14 text-right tabular-nums">
                  {day.minutes > 0 ? formatDuration(day.minutes) : '--'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Total this week</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatDuration(weeklySummary.reduce((sum, d) => sum + d.minutes, 0))}
            </span>
          </div>
        </Card>
      </div>

      {/* Staff Status */}
      {todayReport && (
        <Card padding="lg" className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Staff Status Today</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {todayReport.clockedInCount} of {todayReport.totalStaff} clocked in
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {todayReport.staff.map((s) => (
              <div
                key={s.userId}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                  s.clockedIn ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${s.clockedIn ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{s.name}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
