'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

/**
 * "Install AppoinlyCRM" banner.
 *
 * Behaviour:
 *   • Captures the `beforeinstallprompt` event (Chrome/Edge/Opera/Android).
 *   • Shows a dismissable banner only after the user has been on the site
 *     for 60s — avoids a banner-bombing first impression.
 *   • Hidden if the app is already installed (display-mode: standalone)
 *     OR the user dismissed it within the last 30 days.
 *
 * Safari iOS doesn't fire beforeinstallprompt — there's no programmatic
 * install. We could show a "Tap Share → Add to Home Screen" hint there,
 * but it tends to be annoying. Skipped for v1.
 */

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SHOW_DELAY_MS = 60 * 1000; // 60s after mount

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari uses its own non-standard property.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = localStorage.getItem(DISMISS_KEY);
    if (!at) return false;
    const ts = Number(at);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Track when the user landed so the 60s gate is per-mount, not per-render.
  const mountedAt = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (recentlyDismissed()) return;

    mountedAt.current = Date.now();

    const onBeforeInstall = (e: Event) => {
      // Stash the event so we can fire it later from a user gesture.
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      setDeferredPrompt(ev);
      // Show the banner only if 60s have elapsed since mount; otherwise
      // schedule it for the remainder.
      const elapsed = Date.now() - mountedAt.current;
      if (elapsed >= SHOW_DELAY_MS) {
        setVisible(true);
      } else {
        setTimeout(() => {
          if (!isStandalone() && !recentlyDismissed()) setVisible(true);
        }, SHOW_DELAY_MS - elapsed);
      }
    };

    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall as EventListener);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall as EventListener);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore — private mode */
    }
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* user cancelled or browser refused */
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
      setVisible(false);
    }
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      role="region"
      aria-label="Install AppoinlyCRM"
      className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm z-40"
    >
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Install AppoinlyCRM
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Add it to your device for fast access and notifications.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-60 min-h-[36px]"
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[36px]"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 -mt-1 -mr-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
