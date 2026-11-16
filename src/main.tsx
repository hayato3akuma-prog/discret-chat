import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { ensureServiceWorkerRegistration } from './lib/pushNotifications';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then(async (regs) => {
      for (const reg of regs) {
        const url =
          reg.active?.scriptURL ||
          reg.installing?.scriptURL ||
          reg.waiting?.scriptURL ||
          '';
        if (url.includes('dev-sw.js')) {
          await reg.unregister().catch(() => {});
        }
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.includes('workbox'))
            .map((k) => window.caches.delete(k).catch(() => false))
        );
      }
    })
    .catch(() => {})
    .finally(() => {
      ensureServiceWorkerRegistration().catch(() => {});
    });
} else {
  ensureServiceWorkerRegistration().catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
