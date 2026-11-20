import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Shuffle,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  createIdentityFromAccessKey,
  deriveLookupId,
  deriveVaultAuthCredentials,
  generateUniqueAccessKey,
  unlockVaultWithAccessKey,
} from '../lib/crypto';
import { auth } from '../lib/firebase';
import {
  createDiscretAccountInFirestore,
  fetchPublicProfile,
  getPrivateUserDoc,
  normalizePseudoKey,
} from '../lib/firestoreStore';
import type { PublicUser, UnlockedSession } from '../types';
import { AppInstallModal, PWAInstallButton } from './AppInstallModal';
import { ThemeSwitcherButton } from './ThemePicker';

interface AuthGateProps {
  initialTab?: AuthTab;
  onAuthenticated: (session: UnlockedSession) => void;
  onShowPresentation?: () => void;
}

type AuthTab = 'login' | 'create';

function mapAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : '';

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-email'
  ) {
    return 'Clé unique introuvable ou invalide.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Trop de tentatives consécutives. Patientez un instant avant de réessayer.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Connexion réseau indisponible. Vérifiez votre accès internet.';
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Erreur lors de l’authentification cryptographique.';
}

export const AuthGate: React.FC<AuthGateProps> = ({
  initialTab = 'login',
  onAuthenticated,
  onShowPresentation,
}) => {
  const [tab, setTab] = useState<AuthTab>(initialTab);

  // Login state
  const [loginKey, setLoginKey] = useState('');
  const [showLoginKey, setShowLoginKey] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Create state
  const [displayName, setDisplayName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<UnlockedSession | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadedKey, setDownloadedKey] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);

    const trimmed = loginKey.trim();
    if (trimmed.length < 12) {
      setLoginError('Veuillez saisir votre clé unique complète.');
      return;
    }

    setLoginLoading(true);
    try {
      const [{ vaultEmail, vaultPassword }, lookupId] = await Promise.all([
        deriveVaultAuthCredentials(trimmed),
        deriveLookupId(trimmed),
      ]);

      const cred = await signInWithEmailAndPassword(auth, vaultEmail, vaultPassword);
      const vaultDoc = await getPrivateUserDoc(cred.user.uid);
      if (!vaultDoc) {
        await signOut(auth).catch(() => {});
        throw new Error('Aucun coffre chiffré associé à cette clé unique.');
      }

      if (lookupId !== vaultDoc.lookupId) {
        await signOut(auth).catch(() => {});
        throw new Error('Empreinte de clé incompatible avec ce coffre.');
      }

      let unlocked;
      try {
        unlocked = await unlockVaultWithAccessKey(
          trimmed,
          vaultDoc.vaultSalt,
          vaultDoc.vaultIv,
          vaultDoc.encryptedVault
        );
      } catch {
        await signOut(auth).catch(() => {});
        throw new Error('Clé unique invalide. Déchiffrement local refusé.');
      }

      const [publicUser, idToken] = await Promise.all([
        fetchPublicProfile(cred.user.uid),
        cred.user.getIdToken(),
      ]);

      const resolvedUser: PublicUser = publicUser ?? {
        id: cred.user.uid,
        handle: vaultDoc.handle,
        displayName: vaultDoc.displayName,
        ecdhPublicJwk: vaultDoc.ecdhPublicJwk,
        ecdsaPublicJwk: vaultDoc.ecdsaPublicJwk,
        fingerprint: vaultDoc.fingerprint,
        createdAt: Date.now(),
      };

      onAuthenticated({
        token: idToken,
        user: resolvedUser,
        ecdhPrivateKey: unlocked.ecdhPrivateKey,
        ecdsaPrivateKey: unlocked.ecdsaPrivateKey,
        ecdhPrivateJwk: unlocked.ecdhPrivateJwk,
        ecdsaPrivateJwk: unlocked.ecdsaPrivateJwk,
      });
    } catch (err) {
      setLoginError(mapAuthError(err));
    } finally {
      setLoginLoading(false);
    }
  }

  function handleSuggestPseudonym() {
    const prefixes = [
      'Sora',
      'Kael',
      'Lyra',
      'Nox',
      'Orion',
      'Vega',
      'Echo',
      'Kuro',
      'Zeph',
      'Nova',
    ];
    const base = prefixes[Math.floor(Math.random() * prefixes.length)];
    const bytes = new Uint8Array(2);
    window.crypto.getRandomValues(bytes);
    const num = ((bytes[0] << 8) | bytes[1]) % 9000 + 1000;
    setDisplayName(`${base}_${num}`);
    setCreateError(null);
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    const cleanPseudo = displayName.trim();
    const pseudoKey = normalizePseudoKey(cleanPseudo);
    if (cleanPseudo.length < 2 || pseudoKey.length < 2) {
      setCreateError(
        'Veuillez saisir un pseudonyme unique (au moins 2 lettres ou chiffres).'
      );
      return;
    }

    setCreateLoading(true);
    try {
      const accessKey = generateUniqueAccessKey();
      const [identity, { vaultEmail, vaultPassword }] = await Promise.all([
        createIdentityFromAccessKey(accessKey),
        deriveVaultAuthCredentials(accessKey),
      ]);

      const cred = await createUserWithEmailAndPassword(
        auth,
        vaultEmail,
        vaultPassword
      );

      try {
        const [createdUser, idToken] = await Promise.all([
          createDiscretAccountInFirestore({
            uid: cred.user.uid,
            displayName: cleanPseudo,
            identity,
          }),
          cred.user.getIdToken(),
        ]);

        setGeneratedKey(accessKey);
        setPendingSession({
          token: idToken,
          user: createdUser,
          ecdhPrivateKey: identity.ecdhPrivateKey,
          ecdsaPrivateKey: identity.ecdsaPrivateKey,
          ecdhPrivateJwk: identity.ecdhPrivateJwk,
          ecdsaPrivateJwk: identity.ecdsaPrivateJwk,
        });
      } catch (innerErr) {
        await cred.user.delete().catch(async () => {
          await signOut(auth).catch(() => {});
        });
        throw innerErr;
      }
    } catch (err) {
      setCreateError(mapAuthError(err));
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleCopyGeneratedKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopiedKey(true);
    } catch {
      // Fallback ignored
    }
  }

  function handleDownloadKeyFile() {
    if (!generatedKey || !pendingSession) return;
    const content = [
      'HOI — CLÉ UNIQUE D’ACCÈS PRIVÉ',
      '========================================',
      `Identifiant public : ${pendingSession.user.handle}`,
      `Pseudonyme         : ${pendingSession.user.displayName}`,
      `Empreinte (SHA256) : ${pendingSession.user.fingerprint}`,
      '',
      'CLÉ UNIQUE (CONSERVEZ-LA PRÉCIEUSEMENT) :',
      generatedKey,
      '',
      'Sécurité :',
      'Aucune adresse e-mail, aucun compte Google, aucun numéro de téléphone.',
      'Cette clé unique dérive votre accès et déchiffre localement votre coffre ECDH/ECDSA P-256.',
      'Conservez-la hors-ligne pour retrouver vos conversations sur tout appareil.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hoi-cle-${pendingSession.user.handle.replace(/[^a-z0-9]/gi, '')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setDownloadedKey(true);
  }

  function handleEnterWorkspace() {
    if (!pendingSession) return;
    onAuthenticated(pendingSession);
  }

  return (
    <div className="app-canvas relative min-h-screen w-full overflow-hidden flex flex-col justify-between px-4 py-8 sm:px-8">
      {/* Multi-layered themed liquid ambient field */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="liquid-orb-a ambient-orb-a absolute -top-48 left-1/2 -translate-x-1/2 h-[540px] w-[780px] rounded-full blur-[140px]" />
        <div className="liquid-orb-b ambient-orb-b absolute -bottom-52 right-1/4 h-[440px] w-[540px] rounded-full blur-[140px]" />
        <div className="ambient-orb-c absolute top-1/3 left-1/5 h-[360px] w-[420px] rounded-full blur-[140px]" />
      </div>

      {/* Minimal top wordmark */}
      <header className="relative z-10 mx-auto w-full max-w-5xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          {onShowPresentation ? (
            <button
              type="button"
              onClick={onShowPresentation}
              className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white hover:text-zinc-300 transition-colors whitespace-nowrap cursor-pointer"
            >
              HOI
            </button>
          ) : (
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white whitespace-nowrap">
              HOI
            </span>
          )}
          {onShowPresentation && (
            <button
              type="button"
              onClick={onShowPresentation}
              className="text-xs font-medium text-zinc-400 hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap cursor-pointer"
            >
              Présentation du site
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-zinc-400 hidden sm:inline mr-1">
            Zéro Google · Zéro e-mail · Chiffrement de bout en bout
          </span>
          <ThemeSwitcherButton variant="icon" align="right" direction="down" />
          <PWAInstallButton compact onOpenModal={() => setInstallModalOpen(true)} />
        </div>
      </header>

      {/* Main centered glass vault */}
      <main className="relative z-10 mx-auto my-auto w-full max-w-[460px] py-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl glass-surface text-zinc-100">
            <Lock className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-white text-balance">
            Messagerie privée souveraine
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">
            Aucun compte tiers, aucun numéro, aucun e-mail. Votre seule clé cryptographique protège et restaure votre coffre.
          </p>
        </div>

        <div className="glass-liquid rounded-3xl p-6 sm:p-7">
          {!generatedKey ? (
            <>
              <div
                role="tablist"
                aria-label="Mode d'accès"
                className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1 border border-white/[0.07] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'login'}
                  onClick={() => {
                    setTab('login');
                    setLoginError(null);
                  }}
                  className={`rounded-lg py-2 px-3 text-xs font-medium transition-all whitespace-nowrap cursor-pointer border ${
                    tab === 'login'
                      ? 'glass-control-active text-white'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Se connecter
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'create'}
                  onClick={() => {
                    setTab('create');
                    setCreateError(null);
                  }}
                  className={`rounded-lg py-2 px-3 text-xs font-medium transition-all whitespace-nowrap cursor-pointer border ${
                    tab === 'create'
                      ? 'glass-control-active text-white'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Créer ma clé
                </button>
              </div>

              {tab === 'login' ? (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="master-key-input"
                      className="block text-xs font-medium text-zinc-300 mb-2"
                    >
                      Clé unique d’accès
                    </label>
                    <div className="relative flex items-center glass-input rounded-xl transition-colors">
                      <KeyRound className="ml-3.5 h-4 w-4 text-zinc-500 shrink-0" />
                      <input
                        id="master-key-input"
                        type={showLoginKey ? 'text' : 'password'}
                        value={loginKey}
                        onChange={(e) => setLoginKey(e.target.value)}
                        placeholder="HOI-XXXX-XXXX-XXXX-XXXX-..."
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-transparent px-3 py-3 text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginKey((v) => !v)}
                        aria-label={showLoginKey ? 'Masquer la clé' : 'Afficher la clé'}
                        className="mr-2.5 p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        {showLoginKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {loginError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{loginError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="btn-specular w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <span>
                      {loginLoading ? 'Déchiffrement en cours...' : 'Déverrouiller le coffre'}
                    </span>
                    {!loginLoading && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="pt-1 text-center text-xs text-zinc-500">
                    Déchiffrement local PBKDF2 (250 000 itérations) + AES-256-GCM.
                  </p>
                </form>
              ) : (
                <form onSubmit={handleCreateAccount} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label
                        htmlFor="display-name-input"
                        className="block text-xs font-medium text-zinc-300"
                      >
                        Pseudonyme unique <span className="text-red-400">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleSuggestPseudonym}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <Shuffle className="h-3 w-3" />
                        <span>Suggérer</span>
                      </button>
                    </div>
                    <input
                      id="display-name-input"
                      type="text"
                      required
                      minLength={2}
                      maxLength={32}
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        if (createError) setCreateError(null);
                      }}
                      placeholder="Ex. Sora, Kael_07 (unique sur HOI)"
                      className="w-full glass-input rounded-xl px-3.5 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      Chaque personne possède un pseudonyme unique (sans doublon), associé à une clé 120 bits et un identifiant public.
                    </p>
                  </div>

                  {createError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{createError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={createLoading}
                    className="btn-specular w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {createLoading
                        ? 'Génération des clés P-256...'
                        : 'Générer ma clé unique'}
                    </span>
                  </button>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-500">
                    <span>ECDH P-256 + ECDSA P-256</span>
                    <span>Zéro connaissance</span>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Coffre chiffré créé et synchronisé</span>
                </p>
                <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
                  Votre clé unique d’accès
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Copiez ou téléchargez cette clé maintenant. Aucun compte Google ni e-mail n’y est lié : elle seule déchiffre votre coffre.
                </p>
              </div>

              <div className="glass-surface rounded-2xl p-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                  <span>Identifiant public</span>
                  <span className="font-mono text-zinc-100">
                    {pendingSession?.user.handle}
                  </span>
                </div>
                <div className="font-mono text-sm sm:text-[15px] leading-relaxed tracking-wider text-white break-all select-all">
                  {generatedKey}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleCopyGeneratedKey}
                  className="glass-control flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
                >
                  {copiedKey ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Clé copiée</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copier la clé</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadKeyFile}
                  className="glass-control flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
                >
                  {downloadedKey ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Téléchargée</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      <span>Sauvegarder .txt</span>
                    </>
                  )}
                </button>
              </div>

              <label className="glass-surface flex items-start gap-3 cursor-pointer select-none rounded-2xl p-3.5">
                <input
                  type="checkbox"
                  checked={confirmedSaved}
                  onChange={(e) => setConfirmedSaved(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                />
                <span className="text-xs leading-relaxed text-zinc-300">
                  J’ai sauvegardé ma clé unique en lieu sûr. Sans elle, personne ne peut déchiffrer mon coffre ni récupérer mon accès.
                </span>
              </label>

              <button
                type="button"
                disabled={!confirmedSaved && !copiedKey && !downloadedKey}
                onClick={handleEnterWorkspace}
                className="btn-specular w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Entrer dans la messagerie</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-5xl flex items-center justify-between text-xs text-zinc-600">
        <span>Chiffrement client Web Crypto API</span>
        <span>Persistance chiffrée sans compte Google</span>
      </footer>

      <AppInstallModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
      />
    </div>
  );
};
