/* eslint-disable no-restricted-globals */
// HOI Service Worker — Web Push & Notification Click Handlers

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {
        title: 'HOI',
        body: 'Nouveau message chiffré reçu.',
        tag: 'discret-message',
        forceShow: false,
        silent: false,
        data: { url: '/' },
      };

      if (event.data) {
        try {
          const parsed = event.data.json();
          payload = {
            ...payload,
            ...parsed,
            data: {
              url: '/',
              ...(parsed && typeof parsed.data === 'object' ? parsed.data : {}),
            },
          };
        } catch {
          try {
            const text = event.data.text();
            if (text) {
              payload.body = text;
            }
          } catch {
            // Keep default payload
          }
        }
      }

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const hasFocusedVisibleClient = windowClients.some(
        (client) => client.focused && client.visibilityState === 'visible'
      );

      for (const client of windowClients) {
        try {
          client.postMessage({
            type: 'discret:push-received',
            payload,
          });
        } catch {
          // Ignore client messaging errors
        }
      }

      if (hasFocusedVisibleClient && !payload.forceShow) {
        return;
      }

      await self.registration.showNotification(payload.title || 'HOI', {
        body: payload.body || 'Nouveau message chiffré reçu.',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag || 'discret-message',
        renotify: true,
        silent: Boolean(payload.silent),
        vibrate: [140, 60, 140],
        data: payload.data || { url: '/' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data =
    event.notification && event.notification.data && typeof event.notification.data === 'object'
      ? event.notification.data
      : { url: '/' };

  const targetUrl = typeof data.url === 'string' && data.url ? data.url : '/';

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            if ('focus' in client) {
              await client.focus();
            }
            client.postMessage({
              type: 'discret:notification-click',
              data,
            });
            return;
          }
        } catch {
          // Ignore invalid client URL
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        if (!oldSub || !oldSub.options || !oldSub.options.applicationServerKey) {
          return;
        }
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldSub.options.applicationServerKey,
        });
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of windowClients) {
          client.postMessage({
            type: 'discret:push-subscription-changed',
            subscription: newSub.toJSON(),
          });
        }
      } catch {
        // Subscription refresh will occur next time the client opens
      }
    })()
  );
});
