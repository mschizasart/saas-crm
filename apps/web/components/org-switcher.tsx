'use client';

/**
 * Org switcher dropdown.
 *
 * Renders the user's current organization name with a chevron. Clicking
 * opens a dropdown listing every org the user belongs to (fetched from
 * /api/v1/memberships/me). Selecting another org POSTs to
 * /api/v1/auth/switch-org, swaps localStorage.access_token with the
 * new one, and triggers a router refresh so all data refetches under
 * the new tenant.
 *
 * Hidden entirely for single-tenant users to avoid visual clutter.
 *
 * IMPORTANT: this file does NOT mount itself anywhere. The orchestrator
 * should drop `<OrgSwitcher />` into the admin top bar (header) next to
 * the user menu in `apps/web/app/(admin)/layout.tsx`. We are not
 * touching that file in this PR because the onboarding-wizard agent is
 * also editing it.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, setTokens } from '@/lib/api';

interface Membership {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: string | null;
  role: string;
  isPrimary: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  pending: boolean;
}

interface JwtPayload {
  orgId?: string;
  sub?: string;
}

function decodeJwt(token: string | null): JwtPayload | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function OrgSwitcher() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Decode the current JWT to know which org is active. This avoids an
  // extra round-trip just to identify the active row in the dropdown.
  useEffect(() => {
    const token = typeof window === 'undefined'
      ? null
      : localStorage.getItem('access_token');
    const payload = decodeJwt(token);
    setCurrentOrgId(payload?.orgId ?? null);
  }, []);

  // Load memberships once on mount. Empty/error → hide the switcher.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/memberships/me');
        if (!res.ok) {
          if (!cancelled) setMemberships([]);
          return;
        }
        const body = (await res.json()) as Membership[];
        if (!cancelled) setMemberships(Array.isArray(body) ? body : []);
      } catch {
        if (!cancelled) setMemberships([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside to close.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const accepted = memberships.filter((m) => !m.pending);
  const current =
    accepted.find((m) => m.orgId === currentOrgId) ?? accepted[0] ?? null;

  // Hide entirely for users with 0 or 1 accepted memberships — no need
  // for a switcher when there's nowhere to switch to.
  if (loading || accepted.length <= 1) return null;

  const handleSelect = async (m: Membership) => {
    if (m.orgId === currentOrgId) {
      setOpen(false);
      return;
    }
    setSwitching(m.orgId);
    try {
      const res = await apiFetch('/api/v1/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: m.orgId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Could not switch organization');
        return;
      }
      setTokens(body.accessToken, body.refreshToken);
      setCurrentOrgId(m.orgId);
      setOpen(false);
      toast.success(`Switched to ${m.orgName}`);
      // Hard refresh so every server component refetches under the new tenant.
      router.refresh();
    } catch {
      toast.error('Could not switch organization');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden="true" />
        <span className="max-w-[160px] truncate">{current?.orgName ?? 'Select org'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 z-50 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
            Your organizations
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {accepted.map((m) => {
              const isCurrent = m.orgId === currentOrgId;
              const isSwitching = switching === m.orgId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(m)}
                    disabled={isSwitching}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                      isCurrent ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {m.orgName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {m.role}
                        {m.isPrimary ? ' · primary' : ''}
                      </div>
                    </div>
                    {isSwitching ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" aria-hidden="true" />
                    ) : isCurrent ? (
                      <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default OrgSwitcher;
