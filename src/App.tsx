import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { ChatWorkspace } from './components/ChatWorkspace';
import { OfflineBanner } from './components/OfflineBanner';
import { importKeysFromJwks } from './lib/crypto';
import type { PublicUser, UnlockedSession } from './types';

const SESSION_STORAGE_KEY = 'discret_session_v1';
const LEGACY_SESSION_KEY = 'discret_tab_session_v1';

interface PersistedSession {
  token: string;
  user: PublicUser;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}

function readStoredSession(): string | null {
  try {
    const local = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (local) return local;

    // Migrate any legacy sessionStorage session into localStorage
    const legacy =
      window.sessionStorage.getItem(LEGACY_SESSION_KEY) ||
      window.sessionStorage.getItem('voile_tab_session_v1');
    if (legacy) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, legacy);
      window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
      window.sessionStorage.removeItem('voile_tab_session_v1');
      return legacy;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function writeStoredSession(payload: PersistedSession) {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredSession() {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
    window.sessionStorage.removeItem('voile_tab_session_v1');
  } catch {
    // Ignore storage errors
  }
}

export default function App() {
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const raw = readStoredSession();
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedSession;
        const keys = await importKeysFromJwks(
          parsed.ecdhPrivateJwk,
          parsed.ecdsaPrivateJwk
        );

        let currentUser = parsed.user;
        try {
          const meRes = await fetch('/api/me', {
            headers: { Authorization: `Bearer ${parsed.token}` },
          });
          if (meRes.status === 401) {
            clearStoredSession();
            return;
          }
          if (meRes.ok) {
            const meData = (await meRes.json()) as { user: PublicUser };
            currentUser = meData.user;
            writeStoredSession({
              token: parsed.token,
              user: currentUser,
              ecdhPrivateJwk: parsed.ecdhPrivateJwk,
              ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
            });
          }
        } catch {
          // Offline or transient network error: keep local session unlocked
        }

        if (active) {
          setSession({
            token: parsed.token,
            user: currentUser,
            ecdhPrivateKey: keys.ecdhPrivateKey,
            ecdsaPrivateKey: keys.ecdsaPrivateKey,
            ecdhPrivateJwk: parsed.ecdhPrivateJwk,
            ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
          });
        }
      } catch {
        clearStoredSession();
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
    writeStoredSession({
      token: unlocked.token,
      user: unlocked.user,
      ecdhPrivateJwk: unlocked.ecdhPrivateJwk,
      ecdsaPrivateJwk: unlocked.ecdsaPrivateJwk,
    });
    setSession(unlocked);
  }, []);

  const handleUpdateUser = useCallback((updatedUser: PublicUser) => {
    setSession((prev) => {
      if (!prev) return null;
      const next = { ...prev, user: updatedUser };
      writeStoredSession({
        token: next.token,
        user: next.user,
        ecdhPrivateJwk: next.ecdhPrivateJwk,
        ecdsaPrivateJwk: next.ecdsaPrivateJwk,
      });
      return next;
    });
  }, []);

  const handleLockSession = useCallback(async () => {
    const token = session?.token;
    clearStoredSession();
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
