import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Eye,
  ImagePlus,
  LogOut,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { BANNER_PRESETS } from '../lib/banners';
import { unwrapGroupKeyBytes, wrapGroupKeyForMember } from '../lib/crypto';
import {
  addGroupMemberInFirestore,
  deleteGroupInFirestore,
  fetchPublicProfile,
  leaveGroupInFirestore,
  searchPublicUsers,
  updateGroupInFirestore,
} from '../lib/firestoreStore';
import { compressBannerImage, compressSquareAvatar } from '../lib/imageUtils';
import type {
  AccentToneKey,
  BannerPresetKey,
  GroupInfo,
  PublicUser,
  UnlockedSession,
} from '../types';
import { GroupAvatar } from './GroupAvatar';
import { ProfileBanner } from './ProfileBanner';
import { TONE_CLASSES, UserAvatar } from './UserAvatar';

interface GroupInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: GroupInfo | null;
  session: UnlockedSession;
  onGroupUpdated: (group: GroupInfo) => void;
  onGroupLeft: (groupId: string) => void;
  onGroupDeleted?: (groupId: string) => void;
  onViewProfile?: (user: PublicUser) => void;
}

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  isOpen,
  onClose,
  group,
  session,
  onGroupUpdated,
  onGroupLeft,
  onGroupDeleted,
  onViewProfile,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [bannerPreset, setBannerPreset] = useState<BannerPresetKey>('monolith');
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null>(null);
  const [accentTone, setAccentTone] = useState<AccentToneKey>('platinum');
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen && group) {
      setName(group.name);
      setDescription(group.description ?? '');
      setAvatarDataUrl(group.avatarDataUrl ?? null);
      setBannerPreset(group.bannerPreset ?? 'monolith');
      setBannerDataUrl(group.bannerDataUrl ?? null);
      setAccentTone(group.accentTone ?? 'platinum');
      setQuery('');
      setSearchResults([]);
      setConfirmDelete(false);
      setError(null);
    }
  }, [isOpen, group]);

  useEffect(() => {
    if (!isOpen || !group) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const users = await searchPublicUsers(trimmed, session.user.id);
        if (!cancelled) {
          const existingIds = new Set(group.members.map((m) => m.id));
          setSearchResults(users.filter((u) => !existingIds.has(u.id)));
        }
      } catch {
        // Ignore
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen, group, session.token]);

  if (!isOpen || !group) return null;

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

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      const nextName = name.trim() || group.name;
      const nextDesc = description.trim();
      await updateGroupInFirestore(group.id, {
        name: nextName,
        description: nextDesc,
        avatarDataUrl,
        bannerPreset,
        bannerDataUrl,
        accentTone,
      });
      onGroupUpdated({
        ...group,
        name: nextName,
        description: nextDesc,
        avatarDataUrl,
        bannerPreset,
        bannerDataUrl,
        accentTone,
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(newUser: PublicUser) {
    if (!group) return;
    setAddingId(newUser.id);
    setError(null);
    try {
      const myEnvelope = group.keyEnvelopes[session.user.id];
      if (!myEnvelope) {
        throw new Error('Clé de groupe introuvable.');
      }

      let wrapperPub = group.members.find(
        (m) => m.id === myEnvelope.wrappedByUserId
      )?.ecdhPublicJwk;

      if (!wrapperPub) {
        const wrapperProfile = await fetchPublicProfile(myEnvelope.wrappedByUserId);
        if (wrapperProfile) {
          wrapperPub = wrapperProfile.ecdhPublicJwk;
        }
      }

      if (!wrapperPub) {
        throw new Error('Clé publique du créateur introuvable.');
      }

      const rawGroupKey = await unwrapGroupKeyBytes({
        myEcdhPrivateKey: session.ecdhPrivateKey,
        wrapperEcdhPublicJwk: wrapperPub,
        myUserId: session.user.id,
        wrappedByUserId: myEnvelope.wrappedByUserId,
        iv: myEnvelope.iv,
        wrappedKey: myEnvelope.wrappedKey,
      });

      const keyEnvelope = await wrapGroupKeyForMember({
        rawGroupKey,
        myEcdhPrivateKey: session.ecdhPrivateKey,
        memberEcdhPublicJwk: newUser.ecdhPublicJwk,
        myUserId: session.user.id,
        memberUserId: newUser.id,
      });

      await addGroupMemberInFirestore(
        group.id,
        session.user.id,
        newUser.id,
        keyEnvelope
      );

      onGroupUpdated({
        ...group,
        members: group.members.some((m) => m.id === newUser.id)
          ? group.members
          : [...group.members, newUser],
        keyEnvelopes: {
          ...group.keyEnvelopes,
          [newUser.id]: keyEnvelope,
        },
      });
      setQuery('');
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    } finally {
      setAddingId(null);
    }
  }

  async function handleLeaveGroup() {
    if (!group) return;
    setLeaving(true);
    try {
      await leaveGroupInFirestore(group.id, session.user.id);
      onGroupLeft(group.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    } finally {
      setLeaving(false);
    }
  }

  async function handleDeleteGroup() {
    if (!group) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteGroupInFirestore(group.id);
      if (onGroupDeleted) {
        onGroupDeleted(group.id);
      } else {
        onGroupLeft(group.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de suppression.');
    } finally {
      setDeleting(false);
    }
  }

  const isFounder = group.creatorId === session.user.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-info-title"
    >
      <div className="glass-elevated w-full max-w-lg overflow-hidden rounded-2xl my-auto">
        <div className="relative">
          <ProfileBanner
            user={{
              displayName: name || group.name,
              bannerPreset,
              bannerDataUrl,
            }}
            className="h-28"
          />
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            onChange={handleBannerUpload}
            className="hidden"
          />
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black/80 transition-colors cursor-pointer"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              <span>Bannière</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full bg-black/55 border border-white/15 text-zinc-200 hover:bg-black/80 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute bottom-3 right-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>E2EE · {group.members.length} membres</span>
            </span>
          </div>
        </div>

        <div className="px-6 pb-6 pt-0 space-y-5">
          {/* Overlapping Group Avatar + Upload Buttons */}
          <div className="-mt-8 flex items-end justify-between gap-3">
            <div className="rounded-2xl p-1 bg-[#0b0b0f] border border-white/10">
              <GroupAvatar
                group={{
                  name: name || group.name,
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
                <span>Photo</span>
              </button>
              {avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarDataUrl(null)}
                  title="Retirer la photo du groupe"
                  className="rounded-xl border border-white/[0.08] p-1.5 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <form onSubmit={handleSaveDetails} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="edit-group-name"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Nom du groupe
                </label>
                <input
                  id="edit-group-name"
                  type="text"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-group-desc"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Objet
                </label>
                <input
                  id="edit-group-desc"
                  type="text"
                  maxLength={100}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description du groupe"
                  className="w-full glass-input rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-zinc-300">Bannière</p>
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
                {BANNER_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setBannerPreset(preset.key)}
                    className={`overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                      bannerPreset === preset.key
                        ? 'border-white/60 ring-1 ring-white/40'
                        : 'border-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    <div
                      className="h-8 w-full bg-cover bg-center"
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
                  </button>
                ))}
              </div>
            </div>

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

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                {savedNotice ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Enregistré</span>
                  </>
                ) : (
                  <span>{saving ? 'Sauvegarde...' : 'Mettre à jour'}</span>
                )}
              </button>
            </div>
          </form>

          {/* Add Member */}
          <div className="border-t border-white/[0.08] pt-4 space-y-2.5">
            <p className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span>Membres du groupe</span>
            </p>

            <div className="relative flex items-center glass-input rounded-xl">
              <Search className="ml-3 h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Inviter un membre par @identifiant..."
                className="w-full bg-transparent px-2.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
              />
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1 rounded-xl border border-white/[0.08] bg-black/40 p-1.5">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={addingId === u.id}
                    onClick={() => handleAddMember(u)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar user={u} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {u.displayName}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-400 truncate">
                          {u.handle}
                        </p>
                      </div>
                    </div>
                    <UserPlus className="h-4 w-4 text-zinc-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-44 overflow-y-auto space-y-1.5 pt-1">
              {group.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onViewProfile?.(member)}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:opacity-90 cursor-pointer"
                  >
                    <UserAvatar user={member} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">
                        {member.displayName}
                        {member.id === session.user.id ? ' (Vous)' : ''}
                      </p>
                      <p className="font-mono text-[11px] text-zinc-400 truncate">
                        {member.handle}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {member.id === group.creatorId && (
                      <span className="text-[11px] text-zinc-400">
                        Fondateur
                      </span>
                    )}
                    {onViewProfile && member.id !== session.user.id && (
                      <button
                        type="button"
                        onClick={() => onViewProfile(member)}
                        title="Voir le profil"
                        className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.07]">
            <div className="flex flex-wrap items-center gap-2">
              {isFounder ? (
                confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={handleDeleteGroup}
                      className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/25 px-3.5 py-2 text-xs font-medium text-red-100 hover:bg-red-500/35 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>
                        {deleting ? 'Suppression...' : 'Confirmer la suppression'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl border border-white/[0.1] px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] cursor-pointer"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Supprimer le groupe</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={leaving}
                  onClick={handleLeaveGroup}
                  className="flex items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>{leaving ? 'Sortie...' : 'Quitter le groupe'}</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.1] px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
