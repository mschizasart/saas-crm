'use client';

/**
 * Offline fallback. The service worker serves this for any HTML
 * navigation when the network is fully unreachable. Kept minimal —
 * no API calls, no auth, just a button that reloads the page.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656m-2.828 8.485a8 8 0 01-5.657-13.657M3 3l18 18"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          You&apos;re offline
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          AppoinlyCRM needs a network connection to load fresh data. Reconnect
          and try again — anything you&apos;ve already viewed in this session
          may still be available.
        </p>
        <button
          type="button"
          onClick={() => {
            // Force a hard reload so the SW can re-attempt the network.
            if (typeof window !== 'undefined') window.location.reload();
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-[44px]"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Retry
        </button>
      </div>
    </div>
  );
}
