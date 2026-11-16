import React, { useEffect, useState } from 'react';
import { Check, Copy, Eye, Search, UserPlus, X } from 'lucide-react';
import type { PublicUser } from '../types';
import {
  openConversationInFirestore,
  searchPublicUsers,
} from '../lib/firestoreStore';
import { UserAvatar } from './UserAvatar';

interface NewContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  currentUser: PublicUser;
  onSelectPeer: (peer: PublicUser) => void;
  onViewProfile?: (peer: PublicUser) => void;
}

export const NewContactModal: React.FC<NewContactModalProps> = ({
  isOpen,
  onClose,
  token,
  currentUser,
  onSelectPeer,
  onViewProfile,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSelf, setCopiedSelf] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setError(null);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const users = await searchPublicUsers(trimmed, currentUser.id);
        if (!cancelled) setResults(users);
      } catch {
        if (!cancelled) {
          setError('Erreur lors de la recherche.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen, token, currentUser.id]);

  async function handleStartChat(peer: PublicUser) {
    try {
      await openConversationInFirestore(currentUser.id, peer.id);
      onSelectPeer(peer);
      onClose();
    } catch {
      setError("Impossible d'ouvrir la conversation.");
    }
  }

  async function handleCopyHandle() {
    try {
      await navigator.clipboard.writeText(currentUser.handle);
      setCopiedSelf(true);
      setTimeout(() => setCopiedSelf(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-contact-title"
    >
      <div className="glass-elevated w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="new-contact-title"
            className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
          >
            Nouvelle conversation chiffrée
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-zinc-400">Votre identifiant public</p>
            <p className="mt-0.5 font-mono text-sm text-white truncate">
              {currentUser.handle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyHandle}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
          >
            {copiedSelf ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>Copié</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copier</span>
              </>
            )}
          </button>
        </div>

        <div className="relative flex items-center glass-input rounded-xl mb-4">
          <Search className="ml-3.5 h-4 w-4 text-zinc-500 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par @identifiant ou pseudonyme..."
            className="w-full bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
        </div>

        {error && (
          <p className="mb-3 text-xs text-red-400">{error}</p>
        )}

        <div className="max-h-60 overflow-y-auto space-y-1.5">
          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              Recherche dans l’annuaire des clés publiques...
            </div>
          ) : query.trim().length < 2 ? (
            <div className="py-8 text-center text-xs text-zinc-500 leading-relaxed">
              Saisissez au moins 2 caractères d’un identifiant (ex. <span className="font-mono text-zinc-300">@sora</span>) ou créez un second compte dans un autre onglet pour discuter en direct.
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              Aucun utilisateur trouvé pour « {query} ».
            </div>
          ) : (
            results.map((user) => (
              <div
                key={user.id}
                className="w-full min-h-[56px] flex items-center justify-between gap-2 rounded-xl border border-transparent bg-white/[0.02] px-3 py-2 hover:border-white/[0.09] hover:bg-white/[0.05] transition-colors"
              >
                <button
                  type="button"
                  onClick={() => handleStartChat(user)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <UserAvatar
                    user={user}
                    isSelfVault={user.id === currentUser.id}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">
                        {user.displayName}
                      </span>
                      {user.id === currentUser.id && (
                        <span className="text-xs text-zinc-500">· Moi</span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-zinc-400 truncate">
                      {user.bio ? `${user.handle} · ${user.bio}` : user.handle}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onViewProfile && user.id !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() => onViewProfile(user)}
                      title="Voir le profil"
                      aria-label={`Voir le profil de ${user.displayName}`}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleStartChat(user)}
                    title="Démarrer une conversation"
                    aria-label={`Discuter avec ${user.displayName}`}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
