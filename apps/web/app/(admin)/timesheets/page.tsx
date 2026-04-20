'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function getMonday(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  return h.toFixed(1);
}

interface TimeEntry {
  id: string;
  userId: string;
  seconds: number;
  startTime: string;
  note?: string;
  description?: string;
  user?: { id: string; firstName?: string; lastName?: string };
  task?: { id: string; name?: string } | null;
}

interface StaffRow {
  userId: string;
  name: string;
  daily: number[];
  entries: TimeEntry[][];
}

export default function TimesheetsPage() {
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = fmtDate(weekStart);
      const to = fmtDate(addDays(weekStart, 6));
      const res = await fetch(
        `${API_BASE}/api/v1/reports/time-tracking?from=${from}&to=${to}`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      const entries: TimeEntry[] = json.data ?? json.entries ?? json ?? [];

      const userMap = new Map<string, StaffRow>();

      for (const entry of entries) {
        const uid = entry.userId ?? entry.user?.id ?? 'unknown';
        const name = entry.user
          ? `${entry.user.firstName ?? ''} ${entry.user.lastName ?? ''}`.trim() || uid
          : uid;

        if (!userMap.has(uid)) {
          userMap.set(uid, {
            userId: uid,
            name,
            daily: [0, 0, 0, 0, 0, 0, 0],
            entries: [[], [], [], [], [], [], []],
          });
        }
        const row = userMap.get(uid)!;

        const entryDate = new Date(entry.startTime);
        let dayIdx = entryDate.getDay() - 1;
        if (dayIdx < 0) dayIdx = 6;

        row.daily[dayIdx] += entry.seconds ?? 0;
        row.entries[dayIdx].push(entry);
      }

      setRows(Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const totalRow = rows.reduce(
    (acc, r) => {
      r.daily.forEach((v, i) => (acc[i] += v));
      return acc;
    },
    [0, 0, 0, 0, 0, 0, 0],
  );

  function toggleCell(userId: string, dayIdx: number) {
    const key = `${userId}-${dayIdx}`;
    setExpandedCell((prev) => (prev === key ? null : key));
  }

  return (
    <div>
      <PageHeader title="Timesheets">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</Button>
          <input
            aria-label="Week start"
            type="date"
            value={fmtDate(weekStart)}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (!isNaN(d.getTime())) setWeekStart(getMonday(d));
            }}
            className={`${inputClass} w-auto`}
          />
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(getMonday(new Date()))}>Today</Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchData} />
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 min-w-[160px]">Staff Member</th>
                {weekDates.map((d, i) => (
                  <th key={i} className="px-3 py-3 text-center min-w-[80px]">
                    <div>{DAYS[i]}</div>
                    <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500 mt-0.5">
                      {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-center min-w-[80px]">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} columns={9} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                    No time entries for this week
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((row) => {
                    const totalSecs = row.daily.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={row.userId} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.name}</td>
                        {row.daily.map((secs, dayIdx) => {
                          const cellKey = `${row.userId}-${dayIdx}`;
                          const isExpanded = expandedCell === cellKey;
                          return (
                            <td key={dayIdx} className="px-3 py-3 text-center relative">
                              {secs > 0 ? (
                                <button
                                  onClick={() => toggleCell(row.userId, dayIdx)}
                                  className="text-primary font-medium hover:underline tabular-nums"
                                >
                                  {fmtHours(secs)}h
                                </button>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">-</span>
                              )}
                              {isExpanded && row.entries[dayIdx].length > 0 && (
                                <div className="absolute z-10 top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[200px] text-left">
                                  <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Entries</p>
                                  {row.entries[dayIdx].map((e) => (
                                    <div key={e.id} className="text-xs text-gray-700 dark:text-gray-300 mb-1.5 pb-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0 last:pb-0 last:mb-0">
                                      <span className="font-medium tabular-nums">{fmtHours(e.seconds)}h</span>
                                      {e.task?.name && <span className="ml-1 text-gray-500 dark:text-gray-400">({e.task.name})</span>}
                                      {(e.note || e.description) && (
                                        <p className="text-gray-400 dark:text-gray-500 mt-0.5">{e.note ?? e.description}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-center font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {fmtHours(totalSecs)}h
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50 dark:bg-gray-900 border-t-2 border-gray-200 dark:border-gray-700 font-semibold">
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">Total</td>
                    {totalRow.map((secs, i) => (
                      <td key={i} className="px-3 py-3 text-center tabular-nums text-gray-700 dark:text-gray-300">
                        {secs > 0 ? `${fmtHours(secs)}h` : '-'}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center tabular-nums text-primary">
                      {fmtHours(totalRow.reduce((a, b) => a + b, 0))}h
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
