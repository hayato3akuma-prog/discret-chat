import { getFreshFirebaseIdToken } from './firebase';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function resolveBearerToken(fallbackToken: string): Promise<string> {
  return (await getFreshFirebaseIdToken()) || fallbackToken;
}

export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  let registration = await navigator.serviceWorker.getRegistration('/');
  if (import.meta.env.DEV && registration) {
    const activeUrl =
      registration.active?.scriptURL ||
      registration.installing?.scriptURL ||
      registration.waiting?.scriptURL ||
      '';
    if (activeUrl.includes('dev-sw.js')) {
      await registration.unregister().catch(() => {});
      registration = undefined;
    }
  }

  if (!registration) {
    const swUrl = import.meta.env.DEV ? '/sw-push.js' : '/sw.js';
    registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      type: 'classic',
    });
  }

  const readyReg = await navigator.serviceWorker.ready;
  return readyReg || registration;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await ensureServiceWorkerRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeToWebPush(
  token: string,
  discreetMode: boolean
): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error(
      'Ce navigateur ou cet environnement ne supporte pas les notifications push.'
    );
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? "L'autorisation de notification a été refusée dans le navigateur."
        : "L'autorisation de notification n'a pas été accordée."
    );
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) {
    throw new Error('Impossible d’initialiser le Service Worker.');
  }

  const activeToken = await resolveBearerToken(token);
  const keyRes = await fetch('/api/push/vapid-public-key', {
    headers: { Authorization: `Bearer ${activeToken}` },
  });
  if (!keyRes.ok) {
    throw new Error('Impossible de récupérer la clé publique VAPID du serveur.');
  }
  const { publicKey } = (await keyRes.json()) as { publicKey: string };
  const expectedKeyBytes = urlBase64ToUint8Array(publicKey);

  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options?.applicationServerKey) {
    const currentKeyBytes = new Uint8Array(subscription.options.applicationServerKey);
    if (!uint8ArraysEqual(currentKeyBytes, expectedKeyBytes)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKeyBytes.buffer as ArrayBuffer,
    });
  }

  const subRes = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      discreetMode,
    }),
  });

  if (!subRes.ok) {
    const data = (await subRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Erreur d'enregistrement de l'abonnement push.");
  }

  return subscription;
}

export async function syncPushSubscriptionIfGranted(
  token: string,
  discreetMode: boolean
): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    return false;
  }

  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) return false;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;

    const activeToken = await resolveBearerToken(token);
    const keyRes = await fetch('/api/push/vapid-public-key', {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    if (keyRes.ok) {
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const expectedKeyBytes = urlBase64ToUint8Array(publicKey);
      if (subscription.options?.applicationServerKey) {
        const currentKeyBytes = new Uint8Array(subscription.options.applicationServerKey);
        if (!uint8ArraysEqual(currentKeyBytes, expectedKeyBytes)) {
          await subscription.unsubscribe().catch(() => {});
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKeyBytes.buffer as ArrayBuffer,
          });
        }
      }
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeToken}`,
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        discreetMode,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeFromWebPush(token: string): Promise<void> {
  const subscription = await getExistingPushSubscription();
  const endpoint = subscription?.endpoint ?? '';

  if (subscription) {
    await subscription.unsubscribe().catch(() => {});
  }

  const activeToken = await resolveBearerToken(token);
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify({ endpoint }),
  });
}

export async function updatePushDiscreetPreference(
  token: string,
  discreetMode: boolean
): Promise<void> {
  const subscription = await getExistingPushSubscription();
  const activeToken = await resolveBearerToken(token);
  await fetch('/api/push/preferences', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify({
      endpoint: subscription?.endpoint,
      discreetMode,
    }),
  });
}

export async function sendTestWebPush(token: string): Promise<{
  sent: number;
  failed: number;
  removed: number;
}> {
  const activeToken = await resolveBearerToken(token);
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${activeToken}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Échec du test de notification push.');
  }
  return (await res.json()) as { sent: number; failed: number; removed: number };
}

export async function showLocalServiceWorkerNotification(options: {
  title: string;
  body: string;
  tag: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await ensureServiceWorkerRegistration();
    if (!reg) return;
    await reg.showNotification(options.title, {
      body: options.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: options.tag,
      renotify: true,
      data: options.data ?? { url: '/' },
    } as NotificationOptions);
  } catch {
    // Ignore local SW notification errors
  }
}
