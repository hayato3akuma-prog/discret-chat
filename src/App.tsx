import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { AuthGate } from './components/AuthGate';
import { ChatWorkspace } from './components/ChatWorkspace';
import { LandingPage } from './components/LandingPage';
import { OfflineBanner } from './components/OfflineBanner';
import { importKeysFromJwks } from './lib/crypto';
import { auth } from './lib/firebase';
import { refreshPublicProfile } from './lib/firestoreStore';
import {
  clearEncryptedLocalSession,
  readEncryptedLocalSession,
  writeEncryptedLocalSession,
} from './lib/secureStorage';
import type { PublicUser, UnlockedSession } from './types';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [unauthView, setUnauthView] = useState<'landing' | 'auth'>(() => {
    const h = window.location.hash;
    return h === '#connexion' || h === '#creer' ? 'auth' : 'landing';
  });
  const [authInitialTab, setAuthInitialTab] = useState<'login' | 'create'>(() =>
    window.location.hash === '#creer' ? 'create' : 'login'
  );
  const [showPresentationWhenAuthed, setShowPresentationWhenAuthed] = useState(
    () => window.location.hash === '#presentation'
  );

  useEffect(() => {
    let active = true;
    const bootFallbackTimer = window.setTimeout(() => {
      if (active) {
        setAuthReady(true);
        setRestoring(false);
      }
    }, 4000);

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (!active) return;
      window.clearTimeout(bootFallbackTimer);
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setSession(null);
        setAuthReady(true);
        setRestoring(false);
        return;
      }

      try {
        const parsed = await readEncryptedLocalSession();
        if (!parsed?.user?.id || parsed.user.id !== fbUser.uid) {
          if (active) {
            setAuthReady(true);
            setRestoring(false);
          }
          return;
        }

        const [keys, freshToken] = await Promise.all([
          importKeysFromJwks(parsed.ecdhPrivateJwk, parsed.ecdsaPrivateJwk),
          fbUser.getIdToken(),
        ]);

        if (active) {
          setSession({
            token: freshToken,
            user: parsed.user,
            ecdhPrivateKey: keys.ecdhPrivateKey,
            ecdsaPrivateKey: keys.ecdsaPrivateKey,
            ecdhPrivateJwk: parsed.ecdhPrivateJwk,
            ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
          });
          setAuthReady(true);
          setRestoring(false);
        }

        // Refresh public profile in background so UI never blocks on Firestore latency
        void refreshPublicProfile(fbUser.uid)
          .then(async (remoteProfile) => {
            if (!active) return;
            if (remoteProfile) {
              await writeEncryptedLocalSession({
                token: freshToken,
                user: remoteProfile,
                ecdhPrivateJwk: parsed.ecdhPrivateJwk,
                ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
              });
              if (active) {
                setSession((prev) =>
                  prev && prev.user.id === fbUser.uid
                    ? { ...prev, user: remoteProfile }
                    : prev
                );
              }
            } else {
              await clearEncryptedLocalSession();
              if (active) {
                setSession(null);
              }
            }
          })
          .catch(() => {
            // Offline or transient Firestore error: keep local unlocked session
          });
      } catch {
        await clearEncryptedLocalSession();
      } finally {
        if (active) {
          setAuthReady(true);
          setRestoring(false);
        }
      }
    });

    const unsubToken = onIdTokenChanged(auth, async (fbUser) => {
      if (!fbUser || !active) return;
      try {
        const freshToken = await fbUser.getIdToken();
        setSession((prev) => {
          if (!prev || prev.user.id !== fbUser.uid || prev.token === freshToken) {
            return prev;
          }
          const next = { ...prev, token: freshToken };
          void writeEncryptedLocalSession({
            token: next.token,
            user: next.user,
            ecdhPrivateJwk: next.ecdhPrivateJwk,
            ecdsaPrivateJwk: next.ecdsaPrivateJwk,
          });
          return next;
        });
      } catch {
        // Ignore token refresh errors while offline
      }
    });

    return () => {
      active = false;
      window.clearTimeout(bootFallbackTimer);
      unsubAuth();
      unsubToken();
    };
  }, []);

  const handleAuthenticated = useCallback((unlocked: UnlockedSession) => {
    void writeEncryptedLocalSession({
      token: unlocked.token,
      user: unlocked.user,
      ecdhPrivateJwk: unlocked.ecdhPrivateJwk,
      ecdsaPrivateJwk: unlocked.ecdsaPrivateJwk,
    });
    setShowPresentationWhenAuthed(false);
    setSession(unlocked);
  }, []);

  const handleUpdateUser = useCallback((updatedUser: PublicUser) => {
    setSession((prev) => {
      if (!prev) return null;
      const next = { ...prev, user: updatedUser };
      void writeEncryptedLocalSession({
        token: next.token,
        user: next.user,
        ecdhPrivateJwk: next.ecdhPrivateJwk,
        ecdsaPrivateJwk: next.ecdsaPrivateJwk,
      });
      return next;
    });
  }, []);

  const handleLockSession = useCallback(async () => {
    await clearEncryptedLocalSession();
    setSession(null);
    setShowPresentationWhenAuthed(false);
    setAuthInitialTab('login');
    setUnauthView('auth');
    await signOut(auth).catch(() => {});
  }, []);

  const handleOpenAuth = useCallback((mode: 'login' | 'create') => {
    setAuthInitialTab(mode);
    setUnauthView('auth');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleShowPresentation = useCallback(() => {
    setUnauthView('landing');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  if (!authReady || restoring) {
    return (
      <div className="h-dvh w-full bg-[#050507] flex items-center justify-center text-xs text-zinc-500">
        Initialisation du coffre chiffré HOI...
      </div>
    );
  }

  const isAuthenticated = Boolean(firebaseUser && session);

  return (
    <>
      {!isAuthenticated ? (
        unauthView === 'landing' ? (
          <LandingPage
            isAuthenticated={false}
            onOpenAuth={handleOpenAuth}
          />
        ) : (
          <AuthGate
            key={authInitialTab}
            initialTab={authInitialTab}
            onAuthenticated={handleAuthenticated}
            onShowPresentation={handleShowPresentation}
          />
        )
      ) : showPresentationWhenAuthed ? (
        <LandingPage
          isAuthenticated
          onOpenAuth={handleOpenAuth}
          onReturnToWorkspace={() => {
            setShowPresentationWhenAuthed(false);
            window.scrollTo({ top: 0, behavior: 'auto' });
          }}
        />
      ) : (
        <ChatWorkspace
          session={session!}
          onUpdateUser={handleUpdateUser}
          onLockSession={handleLockSession}
          onOpenPresentation={() => {
            setShowPresentationWhenAuthed(true);
            window.scrollTo({ top: 0, behavior: 'auto' });
          }}
        />
      )}
      <OfflineBanner />
    </>
  );
}
