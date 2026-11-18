import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { BANNER_PRESETS } from '../lib/banners';
import { generateGroupKeyBytes, wrapGroupKeyForMember } from '../lib/crypto';
import { createGroupInFirestore, searchPublicUsers } from '../lib/firestoreStore';
import { compressBannerImage, compressSquareAvatar } from '../lib/imageUtils';
import type {
  AccentToneKey,
  BannerPresetKey,
  GroupInfo,
  GroupKeyEnvelope,
  PublicUser,
  UnlockedSession,
} from '../types';
import { GroupAvatar } from './GroupAvatar';
import { ProfileBanner } from './ProfileBanner';
import { TONE_CLASSES, UserAvatar } from './UserAvatar';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: UnlockedSession;
  friends?: PublicUser[];
  friendAliases?: Record<string, string>;
  onGroupCreated: (group: GroupInfo) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  session,
  friends = [],
  friendAliases = {},
  onGroupCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [bannerPreset, setBannerPreset] = useState<BannerPresetKey>('monolith');
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null>(null);
  const [accentTone, setAccentTone] = useState<AccentToneKey>('platinum');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<PublicUser[]>([]);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
      setAvatarDataUrl(null);
      setBannerPreset('monolith');
      setBannerDataUrl(null);
      setAccentTone('platinum');
      setQuery('');
      setResults([]);
      setSelectedMembers([]);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const users = await searchPublicUsers(trimmed, session.user.id);
        if (!cancelled) {
          setResults(users.filter((u) => u.id !== session.user.id));
        }
      } catch {
        // Ignore
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen, session.token, session.user.id]);

  function toggleMember(user: PublicUser) {
    setSelectedMembers((prev) =>
      prev.some((m) => m.id === user.id)
        ? prev.filter((m) => m.id !== user.id)
        : [...prev, user]
    );
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressSquareAvatar(file);
      setAvatarDataUrl(compressed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de charger cette photo.'
      );
    }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressBannerImage(file);
      setBannerDataUrl(compressed);
      setBannerPreset('custom');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de charger cette bannière.'
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Veuillez saisir un nom pour le groupe.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const rawGroupKey = generateGroupKeyBytes();
      const allMembers = [session.user, ...selectedMembers];
      const keyEnvelopes: Record<string, GroupKeyEnvelope> = {};

      await Promise.all(
        allMembers.map(async (member) => {
          keyEnvelopes[member.id] = await wrapGroupKeyForMember({
            rawGroupKey,
            myEcdhPrivateKey: session.ecdhPrivateKey,
            memberEcdhPublicJwk: member.ecdhPublicJwk,
            myUserId: session.user.id,
            memberUserId: member.id,
          });
        })
      );

      const createdGroup = await createGroupInFirestore({
        creatorId: session.user.id,
        name: trimmedName,
        description: description.trim(),
        avatarDataUrl,
        bannerPreset,
        bannerDataUrl,
        accentTone,
        memberIds: allMembers.map((m) => m.id),
        keyEnvelopes,
      });

      onGroupCreated(createdGroup);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erreur lors de la création du groupe.'
      );
    } finally {
      setCreating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-title"
    >
      <div className="glass-elevated w-full max-w-lg rounded-2xl p-6 my-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Users className="h-5 w-5 text-zinc-200" />
            <h2
              id="create-group-title"
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
            >
              Créer un groupe chiffré
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Live Group Preview Card with Custom Banner & Photo */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.025]">
            <div className="relative">
              <ProfileBanner
                user={{
                  displayName: name.trim() || 'Nouveau groupe',
                  bannerPreset,
                  bannerDataUrl,
                }}
                className="h-24"
              />
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                onChange={handleBannerUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-black/80 transition-colors cursor-pointer"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                <span>Bannière</span>
              </button>
            </div>

            <div className="px-4 pb-3.5">
              <div className="-mt-8 flex items-end justify-between gap-3">
                <div className="rounded-2xl p-1 bg-[#0b0b0f] border border-white/10">
                  <GroupAvatar
                    group={{
                      name: name.trim() || 'Nouveau groupe',
                      avatarDataUrl,
                      accentTone,
                    }}
                    size="lg"
                  />
                </div>

                <div className="flex items-center gap-1.5 pt-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>Photo du groupe</span>
                  </button>
                  {avatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarDataUrl(null)}
                      title="Retirer la photo"
                      className="rounded-xl border border-white/[0.08] p-1.5 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Group Name & Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="group-name"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Nom du groupe
              </label>
              <input
                id="group-name"
                type="text"
                maxLength={40}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Cercle privé, Projet Alpha"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="group-desc"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Objet <span className="text-zinc-500">(optionnel)</span>
              </label>
              <input
                id="group-desc"
                type="text"
                maxLength={100}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Sujet ou règle du groupe"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Banner Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-zinc-300">
                Bannière du groupe
              </p>
              {bannerPreset === 'custom' && bannerDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setBannerDataUrl(null);
                    setBannerPreset('monolith');
                  }}
                  className="text-[11px] text-zinc-400 hover:text-red-300 cursor-pointer"
                >
                  Supprimer la bannière personnalisée
                </button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {BANNER_PRESETS.map((preset) => {
                const active = bannerPreset === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setBannerPreset(preset.key)}
                    className={`overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-white/60 ring-1 ring-white/40'
                        : 'border-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    <div
                      className="h-9 w-full bg-cover bg-center"
                      style={{ background: preset.fallbackGradient }}
                    >
                      {preset.imageUrl && (
                        <img
                          src={preset.imageUrl}
                          alt={preset.label}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="bg-black/70 px-1 py-0.5 text-center text-[10px] text-zinc-200 truncate">
                      {preset.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent Tone */}
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-1.5">
              Teinte du groupe
            </p>
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(TONE_CLASSES) as AccentToneKey[]).map((key) => {
                const tone = TONE_CLASSES[key];
                const active = accentTone === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAccentTone(key)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-1.5 px-2 text-xs transition-colors cursor-pointer ${
                      active
                        ? 'border-white/30 bg-white/[0.12] text-white'
                        : 'border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${tone.swatch}`} />
                    <span className="hidden sm:inline">{tone.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Members */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-zinc-300">
                Membres invités ({selectedMembers.length + 1} au total)
              </p>
              <span className="text-[11px] text-zinc-500">
                Vous êtes inclus automatiquement
              </span>
            </div>

            {selectedMembers.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {selectedMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member)}
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.07] px-2.5 py-1 text-xs text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
                  >
                    <span>{friendAliases[member.id]?.trim() || member.displayName}</span>
                    <X className="h-3 w-3 text-zinc-400" />
                  </button>
                ))}
              </div>
            )}

            <div className="relative flex items-center glass-input rounded-xl">
              <Search className="ml-3 h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher des membres par @identifiant..."
                className="w-full bg-transparent px-2.5 py-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
              />
            </div>

            {query.trim().length < 2 && friends.length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto space-y-1 rounded-xl border border-white/[0.07] bg-black/25 p-1.5">
                <p className="px-2 py-1 text-[11px] font-medium text-zinc-400">
                  Vos amis
                </p>
                {friends.map((friend) => {
                  const selected = selectedMembers.some((m) => m.id === friend.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => toggleMember(friend)}
                      className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        selected ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar user={friend} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">
                            {friendAliases[friend.id]?.trim() || friend.displayName}
                          </p>
                          <p className="font-mono text-[11px] text-zinc-400 truncate">
                            {friendAliases[friend.id]?.trim()
                              ? `${friend.handle} · ${friend.displayName}`
                              : friend.handle}
                          </p>
                        </div>
                      </div>
                      {selected ? (
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : (
                        <UserPlus className="h-4 w-4 text-zinc-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {query.trim().length >= 2 && (
              <div className="mt-2 max-h-36 overflow-y-auto space-y-1 rounded-xl border border-white/[0.07] bg-black/30 p-1.5">
                {searching ? (
                  <p className="py-3 text-center text-xs text-zinc-500">
                    Recherche...
                  </p>
                ) : results.length === 0 ? (
                  <p className="py-3 text-center text-xs text-zinc-500">
                    Aucun utilisateur trouvé.
                  </p>
                ) : (
                  results.map((user) => {
                    const selected = selectedMembers.some((m) => m.id === user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleMember(user)}
                        className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'bg-white/[0.1]'
                            : 'hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar user={user} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate">
                              {friendAliases[user.id]?.trim() || user.displayName}
                            </p>
                            <p className="font-mono text-[11px] text-zinc-400 truncate">
                              {friendAliases[user.id]?.trim()
                                ? `${user.handle} · ${user.displayName}`
                                : user.handle}
                            </p>
                          </div>
                        </div>
                        {selected ? (
                          <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        ) : (
                          <UserPlus className="h-4 w-4 text-zinc-400 shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Clé AES-256-GCM par groupe</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/[0.1] px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="rounded-xl bg-white px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors disabled:opacity-45 cursor-pointer"
              >
                {creating ? 'Chiffrement...' : 'Créer le groupe'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
