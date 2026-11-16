import { useCallback, useEffect, useState } from 'react';
import { getFreshFirebaseIdToken } from '../lib/firebase';
import {
  ensureServiceWorkerRegistration,
  getExistingPushSubscription,
  isInIframe,
  isPushSupported,
  sendTestWebPush,
  subscribeToWebPush,
  syncPushSubscriptionIfGranted,
  unsubscribeFromWebPush,
  updatePushDiscreetPreference,
} from '../lib/pushNotifications';

const DISCREET_PUSH_PREF_KEY = 'discret_push_discreet_mode_v1';

export function usePushNotifications(token: string | null) {
  const supported = isPushSupported();
  const inIframe = isInIframe();

  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [discreetMode, setDiscreetMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(DISCREET_PUSH_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    if (!supported) return;
    setPermission(Notification.permission);
    const sub = await getExistingPushSubscription();
    setIsSubscribed(Boolean(sub));
    if (token && sub && Notification.permission === 'granted') {
      await syncPushSubscriptionIfGranted(token, discreetMode);
    }
  }, [supported, token, discreetMode]);

  useEffect(() => {
    if (!supported) return;
    ensureServiceWorkerRegistration().catch(() => {});
    void refreshState();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setPermission(Notification.permission);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let swMessageHandler: ((event: MessageEvent) => void) | null = null;
    if ('serviceWorker' in navigator) {
      swMessageHandler = async (event: MessageEvent) => {
        if (
          event.data &&
          event.data.type === 'discret:push-subscription-changed' &&
          event.data.subscription &&
          token
        ) {
          const activeToken = (await getFreshFirebaseIdToken()) || token;
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${activeToken}`,
            },
            body: JSON.stringify({
              subscription: event.data.subscription,
              discreetMode,
            }),
          }).catch(() => {});
          setIsSubscribed(true);
        }
      };
      navigator.serviceWorker.addEventListener('message', swMessageHandler);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (swMessageHandler && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', swMessageHandler);
      }
    };
  }, [supported, token, discreetMode, refreshState]);

  const enablePush = useCallback(async () => {
    if (!token) return false;
    setError(null);
    setStatusMessage(null);
    setLoading(true);
    try {
      await subscribeToWebPush(token, discreetMode);
      setPermission(Notification.permission);
      setIsSubscribed(true);
      setStatusMessage('Notifications push activées via le Service Worker.');
      return true;
    } catch (err) {
      setPermission(
        typeof Notification !== 'undefined' ? Notification.permission : 'default'
      );
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d'activer les notifications push."
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [token, discreetMode]);

  const disablePush = useCallback(async () => {
    if (!token) return false;
    setError(null);
    setStatusMessage(null);
    setLoading(true);
    try {
      await unsubscribeFromWebPush(token);
      setIsSubscribed(false);
      setStatusMessage('Notifications push désactivées sur cet appareil.');
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de désactiver les notifications push.'
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [token]);

  const toggleDiscreetMode = useCallback(async () => {
    const next = !discreetMode;
    setDiscreetMode(next);
    try {
      window.localStorage.setItem(DISCREET_PUSH_PREF_KEY, String(next));
    } catch {
      // Ignore storage error
    }
    if (token && isSubscribed) {
      await updatePushDiscreetPreference(token, next).catch(() => {});
    }
  }, [discreetMode, token, isSubscribed]);

  const sendTestPush = useCallback(async () => {
    if (!token) return;
    setError(null);
    setStatusMessage(null);
    setTesting(true);
    try {
      const res = await sendTestWebPush(token);
      if (res.sent > 0) {
        setStatusMessage(
          'Notification test envoyée via le serveur push au Service Worker.'
        );
      } else {
        setError(
          res.failed > 0
            ? 'Le serveur push distant a rejeté ou expiré cet abonnement. Réactivez les notifications.'
            : 'Aucun abonnement actif trouvé sur cet appareil.'
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erreur lors du test push.'
      );
    } finally {
      setTesting(false);
    }
  }, [token]);

  return {
    supported,
    inIframe,
    permission,
    isSubscribed,
    discreetMode,
    loading,
    testing,
    error,
    statusMessage,
    enablePush,
    disablePush,
    toggleDiscreetMode,
    sendTestPush,
  };
}
