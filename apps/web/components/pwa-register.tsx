'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Registers /sw.js on app boot and listens for the "sw:navigate" message
 * the SW posts when the user clicks a push notification while a tab is
 * already open. The tab focuses, then routes to the deep-link.
 *
 * The previous version was a 12-line stub that registered the SW and
 * nothing else. This is the production version.
 */
export function PwaRegister() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Register asynchronously after the page is interactive — registering
    // during the critical path can delay the first paint on slow devices.
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Registration can fail in dev (HTTP, sandboxed iframes) — surface
          // it to the console for debugging but never throw.
          // eslint-disable-next-line no-console
          console.warn('[pwa] SW registration failed:', err);
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    // Listen for navigation requests from the SW (push notification clicks).
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'sw:navigate' && typeof event.data.url === 'string') {
        // Use Next.js router so we keep the SPA shell.
        try {
          router.push(event.data.url);
        } catch {
          window.location.href = event.data.url;
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [router]);

  return null;
}
