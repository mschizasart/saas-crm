'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import {
  getPushStatus,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  type PushStatus,
} from '@/lib/push';

/**
 * Notification preferences.
 *
 * For v1 we only manage browser push — email digest controls live on
 * the per-user profile page. Future: a per-event-type toggle matrix.
 */
export default function NotificationSettingsPage() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getPushStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleEnable() {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        toast.success('Browser notifications enabled');
        await refresh();
      } else if (result.reason === 'denied') {
        toast.error('Permission denied — enable notifications in your browser settings.');
        await refresh();
      } else if (result.reason === 'unsupported') {
        toast.error('Your browser does not support push notifications.');
      } else if (result.reason === 'no-config') {
        toast.error('Push is not configured on this server. Ask an administrator.');
      } else {
        toast.error(result.message ?? 'Could not enable notifications.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      const ok = await unsubscribeFromPush();
      if (ok) toast.success('Browser notifications disabled');
      else toast.error('Could not unsubscribe — try clearing the site data.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const r = await sendTestPush();
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      if (r.sent === 0) {
        toast.message(
          'No active subscriptions. If you just enabled, give it a moment and retry.',
        );
      } else {
        toast.success(`Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`);
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsPageLayout
      title="Notifications"
      description="Control how AppoinlyCRM reaches you. In-app and email notifications are always on; configure browser push below."
    >
      <SettingsSection
        title="Browser notifications"
        description="Get system-level notifications on this device when you're assigned a ticket, a lead is updated, or an invoice goes overdue. Works in the background — even when AppoinlyCRM is closed."
      >
        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking status…
          </div>
        ) : (
          <PushControl
            status={status}
            busy={busy}
            testing={testing}
            onEnable={handleEnable}
            onDisable={handleDisable}
            onTest={handleTest}
          />
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function StatusPill({ status }: { status: PushStatus }) {
  const map: Record<
    PushStatus,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    unsupported: {
      label: 'Not supported',
      cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
      icon: <BellOff className="w-3.5 h-3.5" />,
    },
    denied: {
      label: 'Blocked',
      cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
    },
    'granted-no-sub': {
      label: 'Off',
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
      icon: <BellOff className="w-3.5 h-3.5" />,
    },
    subscribed: {
      label: 'On',
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
  };
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function PushControl({
  status,
  busy,
  testing,
  onEnable,
  onDisable,
  onTest,
}: {
  status: PushStatus;
  busy: boolean;
  testing: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Bell className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
          Status:
        </span>
        <StatusPill status={status} />
      </div>

      {status === 'unsupported' && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This browser does not support push notifications. On iOS, install the
          app to your home screen first (Safari → Share → Add to Home Screen),
          then open it from the home screen and try again.
        </p>
      )}

      {status === 'denied' && (
        <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <p className="font-medium mb-1">Permission blocked</p>
          <p className="text-xs">
            Click the padlock (or 🛈) icon in your browser&apos;s address bar,
            find the Notifications permission, and set it to Allow. Then reload
            this page.
          </p>
        </div>
      )}

      {status === 'granted-no-sub' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={onEnable}
            loading={busy}
            disabled={busy}
            icon={<Bell className="w-4 h-4" />}
          >
            Enable notifications
          </Button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            We&apos;ll ask your browser for permission.
          </p>
        </div>
      )}

      {status === 'subscribed' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={onTest}
            loading={testing}
            disabled={testing || busy}
          >
            Send test notification
          </Button>
          <Button
            variant="ghost"
            onClick={onDisable}
            loading={busy}
            disabled={busy || testing}
            icon={<BellOff className="w-4 h-4" />}
          >
            Disable
          </Button>
        </div>
      )}
    </div>
  );
}
