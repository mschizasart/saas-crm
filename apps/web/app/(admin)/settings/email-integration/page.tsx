'use client';

import { useState } from 'react';
import { Mail, Copy, Check } from 'lucide-react';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

// Origin for the hosted manifest + taskpane. In prod this is appoinlycrm.net;
// falls back to the current origin during local dev.
function appBase(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://www.appoinlycrm.net';
}

export default function EmailIntegrationPage() {
  const base = appBase();
  const manifestUrl = `${base}/outlook-manifest.xml`;
  const [copied, setCopied] = useState(false);

  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(manifestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <SettingsPageLayout
      title="Email Add-in"
      description="Bring CRM context into Outlook. Install the Appoinly add-in to see the sender's lead or client record, log emails, and create leads without leaving your inbox."
    >
      <SettingsSection
        title="Manifest URL"
        description="This is the hosted manifest you'll point Outlook at when installing the add-in."
      >
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 break-all">
            {manifestUrl}
          </code>
          <button
            onClick={copyManifest}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-600" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy
              </>
            )}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Install in Outlook"
        description="Sideload the add-in from the manifest URL above. This works in new & classic Outlook (desktop) and Outlook on the web."
      >
        <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-300 list-decimal list-inside">
          <li>
            Open Outlook and go to <span className="font-medium">Get Add-ins</span> (also called{' '}
            <span className="font-medium">All Apps &rarr; Add-ins &rarr; Manage add-ins</span> in
            newer builds).
          </li>
          <li>
            Choose <span className="font-medium">My add-ins</span>, then{' '}
            <span className="font-medium">Add a custom add-in &rarr; Add from URL</span>.
          </li>
          <li>
            Paste the manifest URL{' '}
            <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">
              {manifestUrl}
            </code>{' '}
            and confirm.
          </li>
          <li>
            Open any email — click the <span className="font-medium">Appoinly CRM</span> button on
            the message ribbon (or the &ldquo;...&rdquo; / apps menu) to open the sidebar.
          </li>
          <li>
            The first time, sign in inside the sidebar with your CRM email and password. Your
            session is remembered on that device.
          </li>
        </ol>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Admin note: sideloading a custom add-in may require organization admin approval in the
          Microsoft 365 admin center depending on your tenant policy.
        </p>
      </SettingsSection>

      <SettingsSection
        title="What the add-in does"
        description="A compact CRM panel that appears next to the open email."
      >
        <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <li className="flex items-start gap-2">
            <Mail className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-medium">Sender lookup</span> — reads the open email&apos;s
              sender and finds the matching lead or client in your CRM.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Mail className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-medium">Recent activity</span> — shows the latest interactions
              for that contact, plus a link to open the full record.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Mail className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-medium">Log this email</span> — records the email as an activity
              against the contact with one click.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Mail className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-medium">Create lead</span> — if the sender isn&apos;t in the CRM
              yet, create a lead prefilled from the email&apos;s name and address.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          The add-in uses the ReadItem permission only — it can read the currently open message and
          never sends message contents anywhere except when you explicitly log an email.
        </p>
      </SettingsSection>
    </SettingsPageLayout>
  );
}
