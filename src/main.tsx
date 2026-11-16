import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { ensureServiceWorkerRegistration } from './lib/pushNotifications';

registerSW({ immediate: true });
ensureServiceWorkerRegistration().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
