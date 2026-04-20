'use client';

// TODO: wire to settings API — no public-pages service exists under
// apps/api/src/modules/ yet. Content below is a generic placeholder the
// workspace can replace once a settings/public-content endpoint ships.
export const dynamic = 'force-dynamic';

import Link from 'next/link';

export default function PrivacyPolicyPage() {
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
            <Link href="/terms-of-service" className="hover:text-gray-800">Terms</Link>
            <Link href="/consent" className="hover:text-gray-800">Consent</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 prose prose-gray">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Last updated: {updated}</p>

        <p>
          This Privacy Policy describes how we collect, use, and share information
          when you use the Service. We collect only the information needed to
          provide and improve the Service.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>Account information you provide when registering (name, email, phone).</li>
          <li>Content you create or upload while using the Service.</li>
          <li>Basic usage data (IP address, device, log timestamps).</li>
        </ul>

        <h2>How we use information</h2>
        <p>
          We use the information we collect to operate, maintain, and improve the
          Service, to communicate with you about your account, and to comply with
          our legal obligations.
        </p>

        <h2>Sharing</h2>
        <p>
          We do not sell personal information. We may share information with
          service providers who help us operate the Service, subject to
          confidentiality obligations.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on your jurisdiction, you may have the right to access,
          correct, or delete personal information we hold about you. Contact us at
          the email address shown in your workspace settings to exercise these
          rights.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about this policy, please contact your workspace
          administrator.
        </p>
      </main>
    </div>
  );
}
