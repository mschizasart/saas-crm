'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type State =
  | { kind: 'loading' }
  | { kind: 'done'; email: string; org: string | null }
  | { kind: 'error' };

/**
 * Public campaign unsubscribe page.
 *
 * The HMAC-signed token in the path encodes {orgId, email}. We POST it to the
 * public API which verifies the signature and records the suppression. No
 * auth — the token is the only credential. Idempotent: re-visiting just shows
 * the confirmation again.
 */
export default function UnsubscribePage() {
  const params = useParams();
  const token = params?.token as string;
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Guard against React strict-mode's double effect invocation (and any
  // remount) so the POST fires exactly once. The endpoint is idempotent, but
  // this avoids the redundant second request.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true;
    fetch(`${API_BASE}/api/v1/public/campaigns/unsubscribe/${token}`, {
      method: 'POST',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) =>
        setState({
          kind: 'done',
          email: d.email,
          org: d.organizationName ?? null,
        }),
      )
      .catch(() => setState({ kind: 'error' }));
  }, [token]);

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        margin: 0,
        background: '#f9fafb',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '2.5rem',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,.1)',
          maxWidth: 420,
        }}
      >
        {state.kind === 'loading' && <p>Processing your request…</p>}

        {state.kind === 'done' && (
          <>
            <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              You&rsquo;ve been unsubscribed
            </h1>
            <p style={{ color: '#4b5563', fontSize: '0.9rem' }}>
              <strong>{state.email}</strong> will no longer receive marketing
              emails{state.org ? ` from ${state.org}` : ''}.
            </p>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              Link not valid
            </h1>
            <p style={{ color: '#4b5563', fontSize: '0.9rem' }}>
              This unsubscribe link is invalid or has expired. Please use the
              link from a recent email.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
