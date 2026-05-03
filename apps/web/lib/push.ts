/**
 * Browser-side helpers for the Web Push lifecycle.
 *
 * The flow:
 *   1. The user clicks "Enable" in Settings → Notifications.
 *   2. We fetch the VAPID public key from /api/v1/push/public-key.
 *   3. We request Notification.permission (must come from a user gesture).
 *   4. We subscribe via swReg.pushManager.subscribe(...).
 *   5. We POST the subscription envelope to /api/v1/push/subscribe.
 *
 * Browser support:
 *   • Chrome/Edge/Firefox/Opera (desktop & Android): full support.
 *   • Safari iOS 16.4+: supported, but ONLY when the site is installed
 *     to the home screen (display-mode: standalone). On a regular Safari
 *     tab Notification.permission returns 'default' and stays denied —
 *     getPushStatus() returns 'unsupported' on iOS Safari for non-PWAs.
 *   • Older Safari & in-app browsers: PushManager is undefined →
 *     getPushStatus() returns 'unsupported'.
 */

import { apiFetch } from './api';

export type PushStatus =
  | 'unsupported' // browser lacks the API, or HTTP origin
  | 'denied' // user denied the permission prompt
  | 'granted-no-sub' // permission granted but we have no active subscription
  | 'subscribed'; // permission granted AND a subscription is active

const PUBLIC_KEY_PATH = '/api/v1/push/public-key';
const SUBSCRIBE_PATH = '/api/v1/push/subscribe';

// Cache the public key for the lifetime of the page — it's stable.
let cachedPublicKey: string | null = null;

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported';

  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'granted-no-sub';

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'granted-no-sub';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'granted-no-sub';
  } catch {
    return 'granted-no-sub';
  }
}

export async function subscribeToPush(): Promise<
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-config' | 'error'; message?: string }
> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  // 1. Permission. MUST be triggered from a user gesture — call this
  //    function from a button onClick, not from useEffect.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' };
  }

  // 2. Get the SW registration. If pwa-register hasn't run yet, register
  //    on the spot so this flow works regardless of mount order.
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  // Wait for activation — pushManager.subscribe needs a controlled SW.
  await navigator.serviceWorker.ready;

  // 3. Fetch (and cache) the VAPID public key.
  if (!cachedPublicKey) {
    try {
      const res = await apiFetch(PUBLIC_KEY_PATH);
      if (!res.ok) return { ok: false, reason: 'error', message: 'Could not fetch VAPID key' };
      const json: { publicKey?: string; configured?: boolean } = await res.json();
      if (!json.publicKey || json.configured === false) {
        return { ok: false, reason: 'no-config' };
      }
      cachedPublicKey = json.publicKey;
    } catch (err) {
      return {
        ok: false,
        reason: 'error',
        message: err instanceof Error ? err.message : 'fetch failed',
      };
    }
  }

  // 4. Subscribe (or reuse an existing subscription if one is already there).
  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cachedPublicKey),
      });
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'subscribe failed',
    };
  }

  // 5. POST to the API. We send the toJSON() form which contains the
  //    keys (p256dh / auth) the server needs to encrypt push payloads.
  try {
    const json = sub.toJSON() as PushSubscriptionJSON;
    const body = {
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };
    const res = await apiFetch(SUBSCRIBE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, reason: 'error', message: `server ${res.status}` };
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'network error',
    };
  }

  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true; // nothing to do — already unsubscribed

  // Best-effort: tell the server first so it stops trying to send to a
  // dead endpoint. Then drop the local subscription.
  try {
    await apiFetch(SUBSCRIBE_PATH, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    /* ignore — local unsubscribe should still happen */
  }

  try {
    return await sub.unsubscribe();
  } catch {
    return false;
  }
}

/**
 * Sends a self-test push (the API hits the caller's own subscriptions).
 * Returns the server-side delivery result so the UI can show a toast.
 */
export async function sendTestPush(): Promise<
  { ok: true; sent: number; failed: number } | { ok: false; message: string }
> {
  try {
    const res = await apiFetch('/api/v1/push/test', { method: 'POST' });
    if (!res.ok) return { ok: false, message: `server ${res.status}` };
    const data: { sent?: number; failed?: number } = await res.json();
    return { ok: true, sent: data.sent ?? 0, failed: data.failed ?? 0 };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'network error',
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────

/**
 * Convert a URL-safe base64 string (the VAPID public key format) into
 * the Uint8Array PushManager.subscribe expects as applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof window !== 'undefined' ? window.atob(base64) : '';
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
