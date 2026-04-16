'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Appointment {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: string;
  endTime: string;
  status: string;
  staffId?: string | null;
  clientId?: string | null;
}

interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface ClientOption {
  id: string;
  company?: string;
  company_name?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
  completed: 'bg-emerald-100 text-emerald-700',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getWeekDates(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay() + 1); // Monday
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState('');
  const [view, setView] = useState<'day' | 'week'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<Appointment | null>(null);
  const [formData, setFormData] = useState({
    title: '', description: '', location: '', staffId: '', clientId: '',
    date: new Date().toISOString().slice(0, 10), startHour: '09:00', endHour: '09:30',
  });
  const [saving, setSaving] = useState(false);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (view === 'day') {
        const d = currentDate.toISOString().slice(0, 10);
        params.set('from', `${d}T00:00:00`);
        params.set('to', `${d}T23:59:59`);
      } else {
        const weekDates = getWeekDates(currentDate);
        params.set('from', weekDates[0].toISOString().slice(0, 10) + 'T00:00:00');
        params.set('to', weekDates[6].toISOString().slice(0, 10) + 'T23:59:59');
      }
      if (staffFilter) params.set('staffId', staffFilter);
      const res = await fetch(`${API_BASE}/api/v1/appointments?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setAppointments(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [currentDate, view, staffFilter]);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/users?type=staff&limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (sRes.ok) { const j = await sRes.json(); setStaff(j.data ?? []); }
        if (cRes.ok) { const j = await cRes.json(); setClients(j.data ?? []); }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const startTime = `${formData.date}T${formData.startHour}:00`;
      const endTime = `${formData.date}T${formData.endHour}:00`;
      const res = await fetch(`${API_BASE}/api/v1/appointments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || null,
          location: formData.location || null,
          staffId: formData.staffId || null,
          clientId: formData.clientId || null,
          startTime, endTime,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setShowForm(false);
      setFormData({ title: '', description: '', location: '', staffId: '', clientId: '', date: new Date().toISOString().slice(0, 10), startHour: '09:00', endHour: '09:30' });
      fetchAppointments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await fetch(`${API_BASE}/api/v1/appointments/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setShowDetail(null);
      fetchAppointments();
    } catch { /* ignore */ }
  }

  function navigateDate(offset: number) {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() + offset);
    else d.setDate(d.getDate() + offset * 7);
    setCurrentDate(d);
  }

  const weekDates = getWeekDates(currentDate);
  const hours = Array.from({ length: 9 }, (_, i) => i + 9); // 9-17

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/appointments/booking"
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
          >
            Booking Widget
          </Link>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
          >
            <span className="text-lg leading-none">+</span>
            New Appointment
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
          <button onClick={() => setView('day')} className={`px-3 py-1.5 text-sm rounded-md ${view === 'day' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Day</button>
          <button onClick={() => setView('week')} className={`px-3 py-1.5 text-sm rounded-md ${view === 'week' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Week</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateDate(-1)} className="px-2 py-1 border border-gray-200 rounded-md text-sm hover:bg-gray-50">&lsaquo;</button>
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 border border-gray-200 rounded-md text-sm hover:bg-gray-50">Today</button>
          <button onClick={() => navigateDate(1)} className="px-2 py-1 border border-gray-200 rounded-md text-sm hover:bg-gray-50">&rsaquo;</button>
        </div>
        <span className="text-sm font-medium text-gray-700">
          {view === 'day' ? formatDate(currentDate.toISOString()) : `${formatDate(weekDates[0].toISOString())} - ${formatDate(weekDates[6].toISOString())}`}
        </span>
        <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="ml-auto px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 px-4 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>}

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-2 py-3 text-xs text-gray-500 w-16">Time</th>
                {view === 'week' ? weekDates.map((d, i) => (
                  <th key={i} className="px-2 py-3 text-xs text-gray-500 font-medium">
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}<br />
                    <span className="font-semibold text-gray-900">{d.getDate()}</span>
                  </th>
                )) : (
                  <th className="px-2 py-3 text-xs text-gray-700 font-medium">{formatDate(currentDate.toISOString())}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-2 py-4"><div className="h-4 w-12 bg-gray-100 rounded animate-pulse" /></td>
                    {(view === 'week' ? weekDates : [currentDate]).map((_, j) => (
                      <td key={j} className="px-2 py-4"><div className="h-6 bg-gray-50 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : hours.map((hour) => {
                const timeLabel = `${hour.toString().padStart(2, '0')}:00`;
                return (
                  <tr key={hour} className="border-b border-gray-50 h-16">
                    <td className="px-2 py-1 text-xs text-gray-400 align-top">{timeLabel}</td>
                    {(view === 'week' ? weekDates : [currentDate]).map((day, colIdx) => {
                      const dayStr = day.toISOString().slice(0, 10);
                      const hourAppts = appointments.filter((a) => {
                        const s = new Date(a.startTime);
                        return s.toISOString().slice(0, 10) === dayStr && s.getHours() === hour;
                      });
                      return (
                        <td key={colIdx} className="px-1 py-1 align-top border-l border-gray-50">
                          {hourAppts.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => setShowDetail(a)}
                              className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 truncate ${STATUS_BADGE[a.status] ?? 'bg-gray-100 text-gray-700'}`}
                            >
                              {formatTime(a.startTime)} {a.title}
                            </button>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Appointment Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Appointment</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
                <input required value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Staff</label>
                  <select value={formData.staffId} onChange={(e) => setFormData({ ...formData, staffId: e.target.value })} className={inputClass}>
                    <option value="">-- Select --</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                  <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} className={inputClass}>
                    <option value="">-- Select --</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.id}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                <input required type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start *</label>
                  <input required type="time" value={formData.startHour} onChange={(e) => setFormData({ ...formData, startHour: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End *</label>
                  <input required type="time" value={formData.endHour} onChange={(e) => setFormData({ ...formData, endHour: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                <input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className={inputClass} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">{showDetail.title}</h2>
            <p className="text-sm text-gray-500 mb-4">
              {formatDate(showDetail.startTime)} {formatTime(showDetail.startTime)} - {formatTime(showDetail.endTime)}
            </p>
            {showDetail.location && <p className="text-sm text-gray-600 mb-2">Location: {showDetail.location}</p>}
            {showDetail.description && <p className="text-sm text-gray-600 mb-4">{showDetail.description}</p>}
            <div className="mb-4">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[showDetail.status] ?? 'bg-gray-100'}`}>
                {showDetail.status}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {showDetail.status === 'scheduled' && (
                <button onClick={() => handleStatusChange(showDetail.id, 'confirmed')} className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700">Confirm</button>
              )}
              {showDetail.status !== 'cancelled' && showDetail.status !== 'completed' && (
                <>
                  <button onClick={() => handleStatusChange(showDetail.id, 'completed')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">Complete</button>
                  <button onClick={() => handleStatusChange(showDetail.id, 'cancelled')} className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700">Cancel</button>
                </>
              )}
              <button onClick={() => setShowDetail(null)} className="px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 ml-auto">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';
