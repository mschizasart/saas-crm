'use client';

// TODO: wire to settings API — no public-pages service exists under
// apps/api/src/modules/ yet. Content below is a generic placeholder the
// workspace can replace once a settings/public-content endpoint ships.
export const dynamic = 'force-dynamic';

import Link from 'next/link';

export default function ConsentPage() {
  const updated = new Date().toLocaleDateString();
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <header className="border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">C</span>
            </div>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">AppoinlyCRM</span>
          </Link>
          <nav className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-4">
            <Link href="/privacy-policy" className="hover:text-gray-800">Privacy</Link>
            <Link href="/terms-of-service" className="hover:text-gray-800">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 prose prose-gray">
        <h1>Consent</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Last updated: {updated}</p>

        <p>
          By creating an account or using the Service, you consent to the
          collection and processing of your information as described in our
          Privacy Policy.
        </p>

        <h2>Cookies and similar technologies</h2>
        <p>
          We use a minimal set of cookies to keep you signed in and to maintain
          session state. We do not use advertising cookies.
        </p>

        <h2>Marketing communications</h2>
        <p>
          If you opt in, we may send you product updates and other communications.
          You can withdraw your consent at any time through your profile
          preferences or by contacting your workspace administrator.
        </p>

        <h2>Data processing</h2>
        <p>
          When you upload or submit content, you consent to our processing of that
          content solely to provide the Service to you and your organization.
        </p>

        <h2>Withdrawing consent</h2>
        <p>
          You can withdraw your consent at any time. Withdrawing your consent does
          not affect the lawfulness of processing based on consent before its
          withdrawal.
        </p>
      </main>
    </div>
  );
}
