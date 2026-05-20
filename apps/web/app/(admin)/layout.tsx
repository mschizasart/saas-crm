'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin-sidebar';
import { AnnouncementsBanner } from '@/components/announcements-banner';
import { ToastProvider } from '@/components/toast-provider';
import { CommandPalette } from '@/components/ui/command-palette';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { InstallPwaBanner } from '@/components/install-pwa-banner';
import { OrgSwitcher } from '@/components/org-switcher';
import { apiFetch, getAccessToken, isTokenExpired } from '@/lib/api';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // True when we're inside the onboarding wizard — skip sidebar/topbar
  // and (more importantly) skip the auto-redirect check below so we don't
  // bounce the user back to /onboarding while they're already there.
  const inOnboarding = pathname.startsWith('/onboarding');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = getAccessToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      if (isTokenExpired(token)) {
        // apiFetch will attempt a refresh; if it fails it redirects to /login itself.
        const res = await apiFetch('/api/v1/auth/me').catch(() => null);
        if (cancelled) return;
        if (!res || !res.ok) return;
      }

      // ─── Onboarding redirect ───────────────────────────────
      // Fresh tenants (completedAt=null, skipped=false) get bounced to
      // /onboarding once. The migration backfills skipped=true for every
      // existing org, so this only fires for genuinely new tenants.
      // We deliberately do NOT redirect if we're already inside the
      // wizard — that would cause a render-loop on every wizard step.
      if (!inOnboarding) {
        try {
          const res = await apiFetch('/api/v1/organizations/me/onboarding');
          if (cancelled) return;
          if (res.ok) {
            const state = await res.json().catch(() => null);
            if (
              state &&
              state.completedAt === null &&
              state.skipped === false
            ) {
              router.replace('/onboarding');
              return;
            }
          }
        } catch {
          // Network blip — fall through and render the dashboard rather
          // than blocking the whole app on this optional check.
        }
      }

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when path changes so navigating into /onboarding manually
    // doesn't keep re-firing the redirect.
  }, [router, pathname, inOnboarding]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Onboarding wizard renders its own minimal chrome (see
  // app/(admin)/onboarding/layout.tsx) — no sidebar, no topbar.
  if (inOnboarding) {
    return (
      <ToastProvider>
        {children}
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
        {/* Desktop sidebar */}
        <div className="hidden md:flex">
          <AdminSidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="relative w-60 h-full">
              <AdminSidebar onClose={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Mobile top bar with hamburger */}
          <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 dark:text-gray-300"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">AppoinlyCRM</span>
            {/* Org switcher — self-hides for single-org users */}
            <div className="ml-auto"><OrgSwitcher /></div>
            {/* Cmd-K hint — opens the command palette */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
              aria-label="Open command palette"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <kbd className="font-mono">{'⌘'}K</kbd>
            </button>
          </div>

          <AnnouncementsBanner />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette />
      <KeyboardShortcuts />
      <InstallPwaBanner />
    </ToastProvider>
  );
}
