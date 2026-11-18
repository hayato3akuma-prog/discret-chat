import React, { useState } from 'react';
import {
  Ban,
  Check,
  Clock,
  Copy,
  MessageSquare,
  Pencil,
  Phone,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import type { CallType } from '../hooks/useWebRTCCall';
import type { PublicUser, RelationshipState } from '../types';
import { ProfileBanner } from './ProfileBanner';
import { UserAvatar } from './UserAvatar';

interface PeerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  peer: PublicUser | null;
  isSelf: boolean;
  relationship?: RelationshipState;
  friendAlias?: string;
  onSaveFriendAlias?: (userId: string, nickname: string) => Promise<void>;
  onOpenSecurity?: () => void;
  onStartChat?: (peer: PublicUser) => void;
  onStartCall?: (peer: PublicUser, callType: CallType) => void;
  onSendFriendRequest?: (userId: string) => Promise<void>;
  onAcceptFriendRequest?: (userId: string) => Promise<void>;
  onDeclineFriendRequest?: (userId: string) => Promise<void>;
  onRemoveFriend?: (userId: string) => Promise<void>;
  onBlockUser?: (userId: string) => Promise<void>;
  onUnblockUser?: (userId: string) => Promise<void>;
}

export const PeerProfileModal: React.FC<PeerProfileModalProps> = ({
  isOpen,
  onClose,
  peer,
  isSelf,
  relationship = 'none',
  friendAlias,
  onSaveFriendAlias,
  onOpenSecurity,
  onStartChat,
  onStartCall,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onRemoveFriend,
  onBlockUser,
  onUnblockUser,
}) => {
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');

  React.useEffect(() => {
    if (isOpen && peer) {
      setEditingAlias(false);
      setAliasInput(friendAlias ?? '');
      setActionError(null);
    }
  }, [isOpen, peer, friendAlias]);

  if (!isOpen || !peer) return null;

  async function handleCopy() {
    if (!peer) return;
    try {
      await navigator.clipboard.writeText(peer.handle);
      setCopiedHandle(true);
      setTimeout(() => setCopiedHandle(false), 1800);
    } catch {
      // Ignore
    }
  }

  async function runAction(key: string, fn?: () => Promise<void>) {
    if (!fn || busyAction) return;
    setBusyAction(key);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Action impossible pour le moment.'
      );
    } finally {
      setBusyAction(null);
    }
  }

  const effectiveRelation: RelationshipState = isSelf ? 'self' : relationship;
  const isBlocked =
    effectiveRelation === 'blocked_by_me' || effectiveRelation === 'blocked_by_peer';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-profile-title"
    >
      <div className="glass-liquid w-full max-w-md overflow-hidden rounded-3xl my-auto">
        {/* Banner Header */}
        <div className="relative">
          <ProfileBanner user={peer} className="h-32" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="glass-control backdrop-blur-md absolute top-3 right-3 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-zinc-100 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {/* Overlapping Avatar + Handle */}
          <div className="-mt-8 mb-3 flex items-end justify-between gap-2">
            <div className="rounded-full p-1 bg-[#0b0b0f]/90 backdrop-blur-md border border-white/15 shrink-0 shadow-lg">
              <UserAvatar user={peer} isSelfVault={isSelf} size="lg" />
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="glass-control flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs text-zinc-200 hover:text-white transition-colors cursor-pointer min-w-0"
            >
              <span className="truncate">{peer.handle}</span>
              {copiedHandle ? (
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="h-3.5 w-3.5 opacity-60 shrink-0" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2
                id="peer-profile-title"
                className="font-[family-name:var(--font-display)] text-lg font-semibold text-white truncate"
              >
                {isSelf
                  ? 'Notes chiffrées (Moi)'
                  : friendAlias?.trim() || peer.displayName}
              </h2>
              {!isSelf && friendAlias?.trim() && (
                <p className="text-xs text-zinc-400 truncate">
                  Pseudonyme public : {peer.displayName}
                </p>
              )}
            </div>
            {effectiveRelation === 'friend' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 shrink-0">
                <UserCheck className="h-3.5 w-3.5" />
                <span>Ami</span>
              </span>
            )}
            {effectiveRelation === 'blocked_by_me' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 shrink-0">
                <Ban className="h-3.5 w-3.5" />
                <span>Bloqué</span>
              </span>
            )}
          </div>

          {peer.bio && (
            <p className="mt-1 text-xs font-medium text-zinc-300">
              {peer.bio}
            </p>
          )}

          {/* Custom Friend Nickname (Nom d'ami) */}
          {!isSelf && onSaveFriendAlias && (
            <div className="mt-4 glass-surface rounded-2xl p-3.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Nom d’ami (personnel)
                </p>
                {!editingAlias && (
                  <button
                    type="button"
                    onClick={() => {
                      setAliasInput(friendAlias ?? '');
                      setEditingAlias(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:text-emerald-200 transition-colors cursor-pointer"
                  >
                    <Pencil className="h-3 w-3" />
                    <span>{friendAlias?.trim() ? 'Modifier' : 'Ajouter un nom'}</span>
                  </button>
                )}
              </div>

              {editingAlias ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction('alias', async () => {
                      await onSaveFriendAlias(peer.id, aliasInput.trim());
                      setEditingAlias(false);
                    });
                  }}
                  className="space-y-2"
                >
                  <input
                    type="text"
                    autoFocus
                    maxLength={32}
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    placeholder={`Nom d’ami pour ${peer.displayName}...`}
                    className="w-full glass-input rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    {friendAlias?.trim() && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runAction('alias-clear', async () => {
                            await onSaveFriendAlias(peer.id, '');
                            setAliasInput('');
                            setEditingAlias(false);
                          })
                        }
                        title="Supprimer le nom d'ami"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Retirer</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => setEditingAlias(false)}
                      className="rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-950 hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Check className="h-3 w-3" />
                      <span>{busyAction === 'alias' ? 'Enregistrement...' : 'Enregistrer'}</span>
                    </button>
                  </div>
                </form>
              ) : friendAlias?.trim() ? (
                <p className="text-sm font-medium text-white">
                  {friendAlias.trim()}
                </p>
              ) : (
                <p className="text-xs italic text-zinc-500">
                  Aucun nom d’ami défini · visible uniquement par vous.
                </p>
              )}
            </div>
          )}

          {/* Biographie Section */}
          <div className="mt-4 glass-surface rounded-2xl p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
              Biographie
            </p>
            {peer.biography ? (
              <p className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap break-words">
                {peer.biography}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-500">
                Aucune biographie renseignée.
              </p>
            )}
          </div>

          {/* Public Fingerprint */}
          <div className="mt-3 glass-surface rounded-2xl p-3.5 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Empreinte publique SHA-256
            </p>
            <p className="font-mono text-xs text-zinc-300 leading-relaxed tabular-nums">
              {peer.fingerprint}
            </p>
          </div>

          {actionError && (
            <p className="mt-3 text-xs text-red-400">{actionError}</p>
          )}

          {/* Relationship & Messaging Controls */}
          {!isSelf && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {onStartChat && !isBlocked && (
                <button
                  type="button"
                  onClick={() => {
                    onStartChat(peer);
                    onClose();
                  }}
                  className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-white to-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-950 shadow-[inset_0_1px_0_0_#ffffff] hover:brightness-95 transition-all cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Message</span>
                </button>
              )}

              {onStartCall &&
                effectiveRelation !== 'blocked_by_me' &&
                effectiveRelation !== 'blocked_by_peer' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onStartCall(peer, 'audio');
                      }}
                      title="Appel audio chiffré"
                      className="glass-control min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span>Appeler</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onStartCall(peer, 'video');
                      }}
                      title="Appel vidéo chiffré"
                      className="glass-control min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      <Video className="h-3.5 w-3.5" />
                      <span>Vidéo</span>
                    </button>
                  </>
                )}

              {effectiveRelation === 'none' && onSendFriendRequest && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('add', () => onSendFriendRequest(peer.id))
                  }
                  className="glass-control flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>
                    {busyAction === 'add' ? 'Envoi...' : 'Ajouter en ami'}
                  </span>
                </button>
              )}

              {effectiveRelation === 'outgoing_pending' &&
                onDeclineFriendRequest && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runAction('cancel', () => onDeclineFriendRequest(peer.id))
                    }
                    className="glass-control flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Demande envoyée · Annuler</span>
                  </button>
                )}

              {effectiveRelation === 'incoming_pending' &&
                onAcceptFriendRequest &&
                onDeclineFriendRequest && (
                  <>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAction('accept', () => onAcceptFriendRequest(peer.id))
                      }
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Accepter</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAction('decline', () => onDeclineFriendRequest(peer.id))
                      }
                      className="min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.09] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Refuser</span>
                    </button>
                  </>
                )}

              {effectiveRelation === 'friend' && onRemoveFriend && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('remove', () => onRemoveFriend(peer.id))
                  }
                  className="min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.09] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  <span>Retirer</span>
                </button>
              )}

              {effectiveRelation === 'blocked_by_me' && onUnblockUser ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('unblock', () => onUnblockUser(peer.id))
                  }
                  className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.15] bg-white/[0.08] px-3.5 py-2 text-xs font-medium text-white hover:bg-white/[0.14] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  <span>Débloquer</span>
                </button>
              ) : (
                effectiveRelation !== 'blocked_by_peer' &&
                onBlockUser && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runAction('block', () => onBlockUser(peer.id))
                    }
                    className="min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    <span>Bloquer</span>
                  </button>
                )
              )}
            </div>
          )}

          {effectiveRelation === 'blocked_by_peer' && (
            <p className="mt-3 text-xs text-zinc-400">
              Cet utilisateur a restreint les interactions avec votre compte.
            </p>
          )}

          <div className="mt-4 pt-3 border-t border-white/[0.08] flex items-center justify-end gap-2.5">
            {onOpenSecurity && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSecurity();
                }}
                className="glass-control flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Vérifier E2EE</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="glass-control rounded-xl px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
