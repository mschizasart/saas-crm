'use client';

// TODO: wire to settings API — no public-pages service exists under
// apps/api/src/modules/ yet. Content below is a generic placeholder the
// workspace can replace once a settings/public-content endpoint ships.
export const dynamic = 'force-dynamic';

import Link from 'next/link';

export default function TermsOfServicePage() {
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
            <Link href="/consent" className="hover:text-gray-800">Consent</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 prose prose-gray">
        <h1>Terms of Service</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Last updated: {updated}</p>

        <p>
          These Terms govern your access to and use of the Service. By using the
          Service, you agree to be bound by these Terms.
        </p>

        <h2>Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account
          credentials and for all activities that occur under your account.
        </p>

        <h2>Acceptable use</h2>
        <p>
          You agree not to misuse the Service, including by attempting to access
          it through unauthorized means, introducing malware, or using it in a way
          that infringes the rights of others.
        </p>

        <h2>Content</h2>
        <p>
          You retain ownership of the content you submit. You grant us a limited
          license to host and process that content solely to provide the Service.
        </p>

        <h2>Termination</h2>
        <p>
          We may suspend or terminate your access to the Service if you violate
          these Terms. You may stop using the Service at any time.
        </p>

        <h2>Disclaimer</h2>
        <p>
          The Service is provided on an "as is" basis without warranties of any
          kind. To the maximum extent permitted by law, we disclaim all implied
          warranties.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these Terms can be directed to your workspace
          administrator.
        </p>
      </main>
    </div>
  );
}
