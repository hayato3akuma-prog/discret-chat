import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import {
  createIdentityFromAccessKey,
  deriveLookupId,
  generateUniqueAccessKey,
  signChallenge,
  unlockVaultWithAccessKey,
} from '../lib/crypto';
import type { PublicUser, UnlockedSession } from '../types';
import { AppInstallModal, PWAInstallButton } from './AppInstallModal';

interface AuthGateProps {
  onAuthenticated: (session: UnlockedSession) => void;
}

type AuthTab = 'login' | 'create';

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [tab, setTab] = useState<AuthTab>('login');

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
      const lookupId = await deriveLookupId(trimmed);
      const chRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookupId }),
      });

      const chData = await chRes.json();
      if (!chRes.ok) {
        throw new Error(chData.error || 'Clé unique introuvable.');
      }

      let unlocked;
      try {
        unlocked = await unlockVaultWithAccessKey(
          trimmed,
          chData.vaultSalt,
          chData.vaultIv,
          chData.encryptedVault
        );
      } catch {
        throw new Error('Clé unique invalide. Déchiffrement local refusé.');
      }

      const signature = await signChallenge(unlocked.ecdsaPrivateKey, chData.challenge);

      const verRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: chData.userId,
          challenge: chData.challenge,
          signature,
        }),
      });

      const verData = await verRes.json();
      if (!verRes.ok) {
        throw new Error(verData.error || 'Échec de vérification.');
      }

      onAuthenticated({
        token: verData.token as string,
        user: verData.user as PublicUser,
        ecdhPrivateKey: unlocked.ecdhPrivateKey,
        ecdsaPrivateKey: unlocked.ecdsaPrivateKey,
        ecdhPrivateJwk: unlocked.ecdhPrivateJwk,
        ecdsaPrivateJwk: unlocked.ecdsaPrivateJwk,
      });
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Erreur de connexion.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateLoading(true);

    try {
      const accessKey = generateUniqueAccessKey();
      const identity = await createIdentityFromAccessKey(accessKey);

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookupId: identity.lookupId,
          displayName: displayName.trim() || 'Anonyme',
          ecdhPublicJwk: identity.ecdhPublicJwk,
          ecdsaPublicJwk: identity.ecdsaPublicJwk,
          fingerprint: identity.fingerprint,
          encryptedVault: identity.encryptedVault,
          vaultSalt: identity.vaultSalt,
          vaultIv: identity.vaultIv,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Impossible de créer le compte.');
      }

      setGeneratedKey(accessKey);
      setPendingSession({
        token: data.token as string,
        user: data.user as PublicUser,
        ecdhPrivateKey: identity.ecdhPrivateKey,
        ecdsaPrivateKey: identity.ecdsaPrivateKey,
        ecdhPrivateJwk: identity.ecdhPrivateJwk,
        ecdsaPrivateJwk: identity.ecdsaPrivateJwk,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur lors de la création.');
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
      'DISCRET — CLÉ UNIQUE D’ACCÈS PRIVÉ',
      '========================================',
      `Identifiant public : ${pendingSession.user.handle}`,
      `Pseudonyme         : ${pendingSession.user.displayName}`,
      `Empreinte (SHA256) : ${pendingSession.user.fingerprint}`,
      '',
      'CLÉ UNIQUE (CONSERVEZ-LA PRÉCIEUSEMENT) :',
      generatedKey,
      '',
      'Avertissement :',
      'Aucun e-mail ni mot de passe n’est associé à ce compte.',
      'Cette clé est votre unique moyen d’accès et de déchiffrement.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `discret-cle-${pendingSession.user.handle.replace(/[^a-z0-9]/gi, '')}.txt`;
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
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050507] text-[#F4F4F5] flex flex-col justify-between px-4 py-8 sm:px-8">
      {/* Subtle monochrome smoked glass ambient illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 h-[520px] w-[780px] rounded-full bg-white/[0.035] blur-[140px]" />
        <div className="absolute -bottom-56 right-1/4 h-[420px] w-[520px] rounded-full bg-slate-300/[0.025] blur-[130px]" />
      </div>

      {/* Minimal top wordmark */}
      <header className="relative z-10 mx-auto w-full max-w-5xl flex items-center justify-between gap-4">
        <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white whitespace-nowrap">
          DISCRET
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 hidden sm:inline">
            Chiffrement de bout en bout · Sans e-mail
          </span>
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
            Aucun e-mail, aucun numéro. Votre clé unique générée localement est votre seul accès.
          </p>
        </div>

        <div className="glass-elevated rounded-2xl p-6 sm:p-7">
          {!generatedKey ? (
            <>
              {/* Segmented mode selector */}
              <div
                role="tablist"
                aria-label="Mode d'accès"
                className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1 border border-white/[0.06]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'login'}
                  onClick={() => {
                    setTab('login');
                    setLoginError(null);
                  }}
                  className={`rounded-lg py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                    tab === 'login'
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
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
                  className={`rounded-lg py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                    tab === 'create'
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Créer un compte
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
                        placeholder="DISCRET-XXXX-XXXX-XXXX-XXXX-..."
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-transparent px-3 py-3 text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginKey((v) => !v)}
                        aria-label={showLoginKey ? 'Masquer la clé' : 'Afficher la clé'}
                        className="mr-2.5 p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors"
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
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-white py-3 px-4 text-sm font-medium text-zinc-950 transition-all hover:bg-zinc-200 disabled:opacity-50 cursor-pointer"
                  >
                    <span>
                      {loginLoading ? 'Déchiffrement en cours...' : 'Déverrouiller le coffre'}
                    </span>
                    {!loginLoading && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="pt-1 text-center text-xs text-zinc-500">
                    La clé est vérifiée par défi cryptographique local et n’est jamais transmise au serveur.
                  </p>
                </form>
              ) : (
                <form onSubmit={handleCreateAccount} className="space-y-4">
                  <div>
                    <label
                      htmlFor="display-name-input"
                      className="block text-xs font-medium text-zinc-300 mb-2"
                    >
                      Pseudonyme affiché <span className="text-zinc-500">(optionnel)</span>
                    </label>
                    <input
                      id="display-name-input"
                      type="text"
                      maxLength={32}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ex. Sora, Kael, ou laisser vide"
                      className="w-full glass-input rounded-xl px-3.5 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      Un identifiant public unique (ex. @sora#4a9f) sera généré automatiquement.
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
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-white py-3 px-4 text-sm font-medium text-zinc-950 transition-all hover:bg-zinc-200 disabled:opacity-50 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {createLoading
                        ? 'Génération des clés P-256...'
                        : 'Générer ma clé unique'}
                    </span>
                  </button>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-500">
                    <span>ECDH P-256 + AES-256-GCM</span>
                    <span>Zéro e-mail</span>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Compte chiffré créé avec succès</span>
                </p>
                <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
                  Votre clé unique d’accès
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Copiez ou téléchargez cette clé maintenant. Sans e-mail de récupération, elle est l’unique moyen de rouvrir votre compte.
                </p>
              </div>

              <div className="rounded-xl bg-black/50 border border-white/[0.1] p-4">
                <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                  <span>Identifiant public</span>
                  <span className="font-mono text-zinc-200">
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
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] py-2.5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] transition-colors cursor-pointer"
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
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] py-2.5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] transition-colors cursor-pointer"
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

              <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <input
                  type="checkbox"
                  checked={confirmedSaved}
                  onChange={(e) => setConfirmedSaved(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                />
                <span className="text-xs leading-relaxed text-zinc-300">
                  J’ai sauvegardé ma clé unique en lieu sûr. Je comprends qu’elle ne pourra jamais être réaffichée.
                </span>
              </label>

              <button
                type="button"
                disabled={!confirmedSaved && !copiedKey && !downloadedKey}
                onClick={handleEnterWorkspace}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-white py-3 px-4 text-sm font-medium text-zinc-950 transition-all hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
        <span>Aucune donnée personnelle collectée</span>
      </footer>

      <AppInstallModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
      />
    </div>
  );
};
