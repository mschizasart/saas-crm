'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Public booking verification page (email double-opt-in). The confirmation
// email links here at /book/verify/<token>. On mount we POST the token to the
// API to finalize the booking. Like the booking page, this lives at a
// top-level public route and uses PLAIN fetch (never apiFetch, which injects a
// JWT and redirects to /login on 401) so it works WITHOUT a session.
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface VerifyResult {
  status: 'scheduled';
  startTime: string; // ISO UTC
  endTime: string; // ISO UTC
  meetingLocation?: string | null;
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

type State =
  | { kind: 'loading' }
  | { kind: 'success'; result: VerifyResult }
  | { kind: 'taken' } // 409 — slot grabbed by someone else
  | { kind: 'invalid'; message: string }; // 400/410 — bad or expired link

export default function PublicBookingVerifyPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  // Visitor timezone (best-effort; falls back to UTC).
  const visitorTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const [state, setState] = useState<State>({ kind: 'loading' });
  // Guard against React 18 StrictMode double-invoke in dev (POST is idempotent
  // server-side, but no need to fire twice).
  const ranRef = useRef(false);

  useEffect(() => {
    if (!token || ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/public/booking/verify/${encodeURIComponent(token)}`,
          { method: 'POST', cache: 'no-store' },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setState({
            kind: 'success',
            result: {
              status: 'scheduled',
              startTime: json.startTime,
              endTime: json.endTime,
              meetingLocation: json.meetingLocation ?? null,
            },
          });
          return;
        }
        if (res.status === 409) {
          setState({ kind: 'taken' });
          return;
        }
        // 400 / 410 (invalid or expired) and any other error.
        const message = Array.isArray(json?.message)
          ? json.message.join(', ')
          : json?.message || 'This confirmation link is invalid or has expired.';
        setState({ kind: 'invalid', message });
      } catch {
        if (!cancelled)
          setState({
            kind: 'invalid',
            message: 'We could not confirm your booking. Please try again.',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full text-center bg-white rounded-xl border border-gray-100 shadow-sm p-8">
        {state.kind === 'loading' && (
          <>
            <div className="w-14 h-14 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Confirming your booking…</h1>
            <p className="text-sm text-gray-500">This will only take a moment.</p>
          </>
        )}

        {state.kind === 'success' && (
          <>
            <div className="w-14 h-14 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re booked!</h1>
            <p className="text-sm text-gray-700 mb-1">
              {fmtDateLong(state.result.startTime, visitorTz)}
            </p>
            <p className="text-sm text-gray-700 mb-1">
              {fmtTime(state.result.startTime, visitorTz)} – {fmtTime(state.result.endTime, visitorTz)}
            </p>
            <p className="text-xs text-gray-400 mb-4">Times shown in {visitorTz}</p>
            {state.result.meetingLocation && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Location:</span> {state.result.meetingLocation}
              </p>
            )}
          </>
        )}

        {state.kind === 'taken' && (
          <>
            <div className="w-14 h-14 mx-auto mb-4 bg-amber-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">That slot was just taken</h1>
            <p className="text-sm text-gray-700">
              Someone else booked this time before you confirmed. Please book another time.
            </p>
          </>
        )}

        {state.kind === 'invalid' && (
          <>
            <div className="w-14 h-14 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Link invalid or expired</h1>
            <p className="text-sm text-gray-700">
              This confirmation link is invalid or has expired. Please book again.
            </p>
          </>
        )}

        <p className="text-[11px] text-gray-400 text-center mt-6">Powered by AppoinlyCRM</p>
      </div>
    </div>
  );
}
