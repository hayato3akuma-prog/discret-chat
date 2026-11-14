import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { ChatWorkspace } from './components/ChatWorkspace';
import { OfflineBanner } from './components/OfflineBanner';
import { importKeysFromJwks } from './lib/crypto';
import type { PublicUser, UnlockedSession } from './types';

const SESSION_STORAGE_KEY = 'discret_tab_session_v1';

interface PersistedTabSession {
  token: string;
  user: PublicUser;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}

export default function App() {
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const raw =
          window.sessionStorage.getItem(SESSION_STORAGE_KEY) ||
          window.sessionStorage.getItem('voile_tab_session_v1');
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedTabSession;
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${parsed.token}` },
        });
        if (!meRes.ok) {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
          window.sessionStorage.removeItem('voile_tab_session_v1');
          return;
        }
        const meData = (await meRes.json()) as { user: PublicUser };
        const keys = await importKeysFromJwks(
          parsed.ecdhPrivateJwk,
          parsed.ecdsaPrivateJwk
        );
        if (active) {
          setSession({
            token: parsed.token,
            user: meData.user,
            ecdhPrivateKey: keys.ecdhPrivateKey,
            ecdsaPrivateKey: keys.ecdsaPrivateKey,
            ecdhPrivateJwk: parsed.ecdhPrivateJwk,
            ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
          });
        }
      } catch {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } finally {
        if (active) setRestoring(false);
      }
    }

    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const handleAuthenticated = useCallback((unlocked: UnlockedSession) => {
    try {
      const toStore: PersistedTabSession = {
        token: unlocked.token,
        user: unlocked.user,
        ecdhPrivateJwk: unlocked.ecdhPrivateJwk,
        ecdsaPrivateJwk: unlocked.ecdsaPrivateJwk,
      };
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Ignore storage quota errors
    }
    setSession(unlocked);
  }, []);

  const handleUpdateUser = useCallback((updatedUser: PublicUser) => {
    setSession((prev) => {
      if (!prev) return null;
      const next = { ...prev, user: updatedUser };
      try {
        window.sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({
            token: next.token,
            user: next.user,
            ecdhPrivateJwk: next.ecdhPrivateJwk,
            ecdsaPrivateJwk: next.ecdsaPrivateJwk,
          })
        );
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }, []);

  const handleLockSession = useCallback(async () => {
    const token = session?.token;
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem('voile_tab_session_v1');
    setSession(null);
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [session?.token]);

  if (restoring) {
    return (
      <div className="h-dvh w-full bg-[#050507] flex items-center justify-center text-xs text-zinc-500">
        Initialisation du coffre chiffré DISCRET...
      </div>
    );
  }

  return (
    <>
      {!session ? (
        <AuthGate onAuthenticated={handleAuthenticated} />
      ) : (
        <ChatWorkspace
          session={session}
          onUpdateUser={handleUpdateUser}
          onLockSession={handleLockSession}
        />
      )}
      <OfflineBanner />
    </>
  );
}
