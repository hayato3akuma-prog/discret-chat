import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Clock,
  Eye,
  MessageSquare,
  Pencil,
  Search,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  FriendsSnapshot,
  PublicUser,
  RelationshipState,
} from '../types';
import { searchPublicUsers } from '../lib/firestoreStore';
import { UserAvatar } from './UserAvatar';

interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  currentUser: PublicUser;
  snapshot: FriendsSnapshot;
  friendAliases?: Record<string, string>;
  onSaveFriendAlias?: (userId: string, nickname: string) => Promise<void>;
  getRelationship: (userId: string) => RelationshipState;
  onViewProfile: (user: PublicUser) => void;
  onStartChat: (peer: PublicUser) => void;
  onSendRequest: (userId: string) => Promise<void>;
  onAcceptRequest: (userId: string) => Promise<void>;
  onDeclineRequest: (userId: string) => Promise<void>;
  onRemoveFriend: (userId: string) => Promise<void>;
  onBlockUser: (userId: string) => Promise<void>;
  onUnblockUser: (userId: string) => Promise<void>;
}

type FriendsTab = 'friends' | 'requests' | 'search' | 'blocked';

export const FriendsModal: React.FC<FriendsModalProps> = ({
  isOpen,
  onClose,
  token,
  currentUser,
  snapshot,
  friendAliases = {},
  onSaveFriendAlias,
  getRelationship,
  onViewProfile,
  onStartChat,
  onSendRequest,
  onAcceptRequest,
  onDeclineRequest,
  onRemoveFriend,
  onBlockUser,
  onUnblockUser,
}) => {
  const [tab, setTab] = useState<FriendsTab>('friends');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSearchResults([]);
      setError(null);
      setEditingAliasId(null);
      setAliasDraft('');
      return;
    }
    if (snapshot.incoming.length > 0) {
      setTab('requests');
    }
  }, [isOpen, snapshot.incoming.length]);

  useEffect(() => {
    if (!isOpen || tab !== 'search') return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const users = await searchPublicUsers(trimmed, currentUser.id);
        if (!cancelled) {
          setSearchResults(users.filter((u) => u.id !== currentUser.id));
        }
      } catch {
        if (!cancelled) {
          setError('Erreur lors de la recherche.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, isOpen, token, currentUser.id]);

  if (!isOpen) return null;

  async function exec(userId: string, fn: () => Promise<void>) {
    if (busyId) return;
    setBusyId(userId);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Action impossible pour le moment.'
      );
    } finally {
      setBusyId(null);
    }
  }

  const totalRequests = snapshot.incoming.length + snapshot.outgoing.length;

  return (
    <div
      className="animate-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="friends-modal-title"
    >
      <div className="glass-liquid animate-panel-enter w-full max-w-xl rounded-3xl p-6 my-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="friends-modal-title"
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
            >
              Amis &amp; Contacts sécurisés
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Gérez vos amis, demandes et blocages sans exposer vos échanges.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1 border border-white/[0.07] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] mb-4">
          {(
            [
              { key: 'friends', label: `Amis (${snapshot.friends.length})` },
              { key: 'requests', label: `Demandes (${totalRequests})` },
              { key: 'search', label: 'Ajouter' },
              { key: 'blocked', label: `Bloqués (${snapshot.blocked.length})` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`min-h-[36px] rounded-lg px-2 py-1.5 text-xs font-medium transition-all whitespace-nowrap truncate cursor-pointer border ${
                tab === item.key
                  ? 'glass-control-active text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="max-h-[420px] overflow-y-auto space-y-2 pr-0.5">
          {/* Tab: Friends */}
          {tab === 'friends' && (
            <>
              {snapshot.friends.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-xs text-zinc-400">
                    Vous n’avez pas encore d’ami enregistré.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('search')}
                    className="btn-specular inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium cursor-pointer"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Rechercher une personne</span>
                  </button>
                </div>
              ) : (
                snapshot.friends.map((friend) => {
                  const alias = friendAliases[friend.id]?.trim();
                  const isEditingThis = editingAliasId === friend.id;
                  return (
                    <div
                      key={friend.id}
                      className="glass-surface rounded-2xl p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onViewProfile(friend)}
                          className="flex items-center gap-3 min-w-0 text-left hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          <UserAvatar user={friend} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {alias || friend.displayName}
                            </p>
                            <p className="font-mono text-xs text-zinc-400 truncate">
                              {alias
                                ? `${friend.handle} · ${friend.displayName}`
                                : friend.handle}
                            </p>
                            {(friend.bio || friend.biography) && (
                              <p className="mt-0.5 text-xs text-zinc-400 truncate">
                                {friend.bio || friend.biography}
                              </p>
                            )}
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {onSaveFriendAlias && (
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditingThis) {
                                  setEditingAliasId(null);
                                } else {
                                  setEditingAliasId(friend.id);
                                  setAliasDraft(alias ?? '');
                                }
                              }}
                              title="Ajouter ou modifier un nom d'ami"
                              className={`min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                                isEditingThis
                                  ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                                  : 'glass-control text-zinc-200 hover:text-white'
                              }`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Nom</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onViewProfile(friend)}
                            title="Voir le profil"
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Profil</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onStartChat(friend);
                              onClose();
                            }}
                            title="Envoyer un message"
                            className="btn-specular min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>Message</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === friend.id}
                            onClick={() =>
                              exec(friend.id, () => onRemoveFriend(friend.id))
                            }
                            title="Retirer des amis"
                            className="glass-control min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-zinc-300 hover:text-white cursor-pointer"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busyId === friend.id}
                            onClick={() =>
                              exec(friend.id, () => onBlockUser(friend.id))
                            }
                            title="Bloquer cet utilisateur"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditingThis && onSaveFriendAlias && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void exec(friend.id, async () => {
                              await onSaveFriendAlias(friend.id, aliasDraft.trim());
                              setEditingAliasId(null);
                            });
                          }}
                          className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06]"
                        >
                          <input
                            type="text"
                            autoFocus
                            maxLength={32}
                            value={aliasDraft}
                            onChange={(e) => setAliasDraft(e.target.value)}
                            placeholder={`Nom d’ami pour ${friend.displayName} (vide pour retirer)...`}
                            className="flex-1 min-w-[160px] glass-input rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={busyId === friend.id}
                            className="btn-specular min-h-[32px] rounded-xl px-3 py-1 text-xs font-medium cursor-pointer"
                          >
                            Enregistrer
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingAliasId(null)}
                            className="glass-control min-h-[32px] rounded-xl px-2.5 py-1 text-xs text-zinc-300 hover:text-white cursor-pointer"
                          >
                            Annuler
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* Tab: Requests */}
          {tab === 'requests' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Demandes reçues ({snapshot.incoming.length})
                </p>
                {snapshot.incoming.length === 0 ? (
                  <p className="glass-surface rounded-2xl p-4 text-center text-xs text-zinc-500">
                    Aucune demande reçue en attente.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {snapshot.incoming.map((req) => (
                      <div
                        key={req.id}
                        className="glass-surface flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl p-3.5"
                      >
                        <button
                          type="button"
                          onClick={() => onViewProfile(req.fromUser)}
                          className="flex items-center gap-3 min-w-0 text-left hover:opacity-90 cursor-pointer"
                        >
                          <UserAvatar user={req.fromUser} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {req.fromUser.displayName}
                            </p>
                            <p className="font-mono text-xs text-zinc-400 truncate">
                              {req.fromUser.handle}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => onViewProfile(req.fromUser)}
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Profil</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.fromUser.id}
                            onClick={() =>
                              exec(req.fromUser.id, () =>
                                onAcceptRequest(req.fromUser.id)
                              )
                            }
                            className="min-h-[36px] flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Accepter</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.fromUser.id}
                            onClick={() =>
                              exec(req.fromUser.id, () =>
                                onDeclineRequest(req.fromUser.id)
                              )
                            }
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Refuser</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.fromUser.id}
                            onClick={() =>
                              exec(req.fromUser.id, () =>
                                onBlockUser(req.fromUser.id)
                              )
                            }
                            title="Bloquer"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Demandes envoyées ({snapshot.outgoing.length})
                </p>
                {snapshot.outgoing.length === 0 ? (
                  <p className="glass-surface rounded-2xl p-4 text-center text-xs text-zinc-500">
                    Aucune demande envoyée.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {snapshot.outgoing.map((req) => (
                      <div
                        key={req.id}
                        className="glass-surface flex items-center justify-between gap-3 rounded-2xl p-3.5"
                      >
                        <button
                          type="button"
                          onClick={() => onViewProfile(req.toUser)}
                          className="flex items-center gap-3 min-w-0 text-left hover:opacity-90 cursor-pointer"
                        >
                          <UserAvatar user={req.toUser} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {req.toUser.displayName}
                            </p>
                            <p className="font-mono text-xs text-zinc-400 truncate">
                              {req.toUser.handle}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onViewProfile(req.toUser)}
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Profil</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.toUser.id}
                            onClick={() =>
                              exec(req.toUser.id, () =>
                                onDeclineRequest(req.toUser.id)
                              )
                            }
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <Clock className="h-3.5 w-3.5 text-zinc-400" />
                            <span>Annuler</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab: Search / Add */}
          {tab === 'search' && (
            <div className="space-y-3">
              <div className="relative flex items-center glass-input rounded-xl">
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

              {searching ? (
                <p className="py-8 text-center text-xs text-zinc-500">
                  Recherche dans l’annuaire...
                </p>
              ) : query.trim().length < 2 ? (
                <p className="py-8 text-center text-xs text-zinc-500">
                  Saisissez au moins 2 caractères pour trouver un utilisateur et envoyer une demande d’ami.
                </p>
              ) : searchResults.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">
                  Aucun utilisateur trouvé pour « {query} ».
                </p>
              ) : (
                searchResults.map((user) => {
                  const rel = getRelationship(user.id);
                  return (
                    <div
                      key={user.id}
                      className="glass-surface flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl p-3.5"
                    >
                      <button
                        type="button"
                        onClick={() => onViewProfile(user)}
                        className="flex items-center gap-3 min-w-0 text-left hover:opacity-90 cursor-pointer"
                      >
                        <UserAvatar user={user} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {friendAliases[user.id]?.trim() || user.displayName}
                          </p>
                          <p className="font-mono text-xs text-zinc-400 truncate">
                            {friendAliases[user.id]?.trim()
                              ? `${user.handle} · ${user.displayName}`
                              : user.handle}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => onViewProfile(user)}
                          className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Profil</span>
                        </button>

                        {rel === 'none' && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() =>
                              exec(user.id, () => onSendRequest(user.id))
                            }
                            className="btn-specular min-h-[36px] flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium cursor-pointer"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            <span>Ajouter</span>
                          </button>
                        )}

                        {rel === 'friend' && (
                          <button
                            type="button"
                            onClick={() => {
                              onStartChat(user);
                              onClose();
                            }}
                            className="min-h-[36px] flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Ami · Message</span>
                          </button>
                        )}

                        {rel === 'outgoing_pending' && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() =>
                              exec(user.id, () => onDeclineRequest(user.id))
                            }
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            <span>Annuler</span>
                          </button>
                        )}

                        {rel === 'incoming_pending' && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() =>
                              exec(user.id, () => onAcceptRequest(user.id))
                            }
                            className="min-h-[36px] flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Accepter</span>
                          </button>
                        )}

                        {rel === 'blocked_by_me' && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() =>
                              exec(user.id, () => onUnblockUser(user.id))
                            }
                            className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-white cursor-pointer"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                            <span>Débloquer</span>
                          </button>
                        )}

                        {rel !== 'blocked_by_me' &&
                          rel !== 'blocked_by_peer' && (
                            <button
                              type="button"
                              disabled={busyId === user.id}
                              onClick={() =>
                                exec(user.id, () => onBlockUser(user.id))
                              }
                              title="Bloquer"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab: Blocked */}
          {tab === 'blocked' && (
            <>
              {snapshot.blocked.length === 0 ? (
                <p className="py-12 text-center text-xs text-zinc-500">
                  Aucun utilisateur bloqué.
                </p>
              ) : (
                snapshot.blocked.map((user) => (
                  <div
                    key={user.id}
                    className="glass-surface flex items-center justify-between gap-3 rounded-2xl p-3.5"
                  >
                    <button
                      type="button"
                      onClick={() => onViewProfile(user)}
                      className="flex items-center gap-3 min-w-0 text-left hover:opacity-90 cursor-pointer"
                    >
                      <UserAvatar user={user} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {user.displayName}
                        </p>
                        <p className="font-mono text-xs text-zinc-400 truncate">
                          {user.handle}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onViewProfile(user)}
                        className="glass-control min-h-[36px] flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Profil</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() =>
                          exec(user.id, () => onUnblockUser(user.id))
                        }
                        className="glass-control min-h-[36px] flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        <span>Débloquer</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
