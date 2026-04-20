'use client';

import { useState, useEffect } from 'react';

interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface Slot {
  start: string;
  end: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function BookingWidgetPage() {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/users?type=staff&limit=100`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const j = await res.json();
          setStaff(j.data ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!selectedStaff || !selectedDate) return;
    setLoadingSlots(true);
    (async () => {
      try {
        const params = new URLSearchParams({ staffId: selectedStaff, date: selectedDate });
        const res = await fetch(`${API_BASE}/api/v1/appointments/slots?${params}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) setSlots(await res.json());
      } catch { /* ignore */ }
      finally { setLoadingSlots(false); }
    })();
  }, [selectedStaff, selectedDate]);

  const bookingUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book?staff=${selectedStaff}`
    : '';

  const embedCode = `<iframe src="${bookingUrl}" width="100%" height="600" frameborder="0"></iframe>`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Booking Widget</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Preview available slots and generate an embeddable booking link for clients.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Preview */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Preview Available Slots</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Staff Member</label>
              <select value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)} className={inputClass}>
                <option value="">-- Select staff --</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {loadingSlots && (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading slots...
            </div>
          )}

          {!loadingSlots && selectedStaff && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Available Slots ({slots.length})</p>
              {slots.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No available slots for this date.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {slots.map((slot, i) => (
                    <div key={i} className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-center text-sm text-green-700 font-medium">
                      {new Date(slot.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Embed Code */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Shareable Booking</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Booking URL</label>
              <div className="flex items-center gap-2">
                <input readOnly value={bookingUrl} className={`${inputClass} bg-gray-50 text-gray-600`} />
                <button
                  onClick={() => navigator.clipboard.writeText(bookingUrl)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <button
                onClick={() => setShowEmbed(!showEmbed)}
                className="text-sm text-primary hover:underline"
              >
                {showEmbed ? 'Hide' : 'Show'} embed code
              </button>
              {showEmbed && (
                <div className="mt-2">
                  <textarea
                    readOnly
                    rows={4}
                    value={embedCode}
                    className={`${inputClass} bg-gray-50 text-gray-600 font-mono text-xs`}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(embedCode)}
                    className="mt-2 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Copy embed code
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">How it works</h3>
              <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 list-disc list-inside">
                <li>Clients visit the booking URL or embedded widget</li>
                <li>They select a staff member and available time slot</li>
                <li>They provide name and email to book the appointment</li>
                <li>The appointment appears in your calendar as "scheduled"</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';
