import React, { useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Trash2,
  X,
} from 'lucide-react';
import { BANNER_PRESETS } from '../lib/banners';
import { updateMyProfileInFirestore } from '../lib/firestoreStore';
import { compressBannerImage, compressSquareAvatar } from '../lib/imageUtils';
import type {
  AccentToneKey,
  AvatarIconKey,
  BannerPresetKey,
  GlassIntensity,
  PublicUser,
} from '../types';
import { ProfileBanner } from './ProfileBanner';
import { renderAvatarGlyph, TONE_CLASSES, UserAvatar } from './UserAvatar';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  user: PublicUser;
  glassIntensity: GlassIntensity;
  onChangeGlassIntensity: (val: GlassIntensity) => void;
  onProfileUpdated: (updated: PublicUser) => void;
}

const ICON_OPTIONS: { key: AvatarIconKey; label: string }[] = [
  { key: 'initials', label: 'Initiales' },
  { key: 'shield', label: 'Bouclier' },
  { key: 'moon', label: 'Lune' },
  { key: 'compass', label: 'Boussole' },
  { key: 'eye', label: 'Œil' },
  { key: 'feather', label: 'Plume' },
  { key: 'diamond', label: 'Diamant' },
];

const GLASS_OPTIONS: { key: GlassIntensity; label: string }[] = [
  { key: 'subtle', label: 'Subtil' },
  { key: 'balanced', label: 'Équilibré' },
  { key: 'deep', label: 'Profond' },
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  token,
  user,
  glassIntensity,
  onChangeGlassIntensity,
  onProfileUpdated,
}) => {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [biography, setBiography] = useState(user.biography ?? '');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(
    user.avatarDataUrl ?? null
  );
  const [avatarIcon, setAvatarIcon] = useState<AvatarIconKey>(
    user.avatarIcon ?? 'initials'
  );
  const [accentTone, setAccentTone] = useState<AccentToneKey>(
    user.accentTone ?? 'platinum'
  );
  const [bannerPreset, setBannerPreset] = useState<BannerPresetKey>(
    user.bannerPreset ?? 'obsidian'
  );
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null>(
    user.bannerDataUrl ?? null
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setDisplayName(user.displayName);
      setBio(user.bio ?? '');
      setBiography(user.biography ?? '');
      setAvatarDataUrl(user.avatarDataUrl ?? null);
      setAvatarIcon(user.avatarIcon ?? 'initials');
      setAccentTone(user.accentTone ?? 'platinum');
      setBannerPreset(user.bannerPreset ?? 'obsidian');
      setBannerDataUrl(user.bannerDataUrl ?? null);
      setError(null);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressSquareAvatar(file);
      setAvatarDataUrl(compressed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de charger cette image.'
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
        err instanceof Error
          ? err.message
          : 'Impossible de charger cette bannière.'
      );
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMyProfileInFirestore(user.id, {
        displayName: displayName.trim() || user.displayName,
        bio: bio.trim(),
        biography: biography.trim(),
        avatarDataUrl,
        avatarIcon,
        accentTone,
        bannerPreset,
        bannerDataUrl,
      });

      onProfileUpdated(updated);
      setSavedNotice(true);
      setTimeout(() => {
        setSavedNotice(false);
        onClose();
      }, 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  const previewUser: PublicUser = {
    ...user,
    displayName: displayName.trim() || user.displayName,
    bio: bio.trim(),
    biography: biography.trim(),
    avatarDataUrl,
    avatarIcon,
    accentTone,
    bannerPreset,
    bannerDataUrl,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div className="glass-elevated w-full max-w-lg rounded-2xl p-6 my-auto">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="profile-modal-title"
            className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
          >
            Personnalisation du profil
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Live Profile Card Preview with Banner */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.025]">
            <div className="relative">
              <ProfileBanner user={previewUser} className="h-28" />
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
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
                  className="flex items-center gap-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-black/80 transition-colors cursor-pointer"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>Bannière</span>
                </button>
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="-mt-8 mb-2 flex items-end justify-between gap-3">
                <div className="rounded-full p-1 bg-[#0b0b0f] border border-white/10">
                  <UserAvatar user={previewUser} size="lg" />
                </div>

                <div className="flex items-center gap-1.5 pt-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
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
                      title="Retirer la photo"
                      className="rounded-xl border border-white/[0.08] p-1.5 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <p className="font-[family-name:var(--font-display)] text-base font-semibold text-white truncate">
                {previewUser.displayName}
              </p>
              <p className="font-mono text-xs text-zinc-400 truncate">
                {user.handle}
              </p>
              {previewUser.bio && (
                <p className="mt-1 text-xs text-zinc-300 truncate">
                  {previewUser.bio}
                </p>
              )}
              {previewUser.biography && (
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400 line-clamp-2 whitespace-pre-line">
                  {previewUser.biography}
                </p>
              )}
            </div>
          </div>

          {/* Banner Presets Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-zinc-300">
                Bannière du profil
              </p>
              {bannerPreset === 'custom' && bannerDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setBannerDataUrl(null);
                    setBannerPreset('obsidian');
                  }}
                  className="text-[11px] text-zinc-400 hover:text-red-300 cursor-pointer"
                >
                  Supprimer l’image personnalisée
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
                    className={`group relative overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-white/60 ring-1 ring-white/40'
                        : 'border-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    <div
                      className="h-11 w-full bg-cover bg-center"
                      style={{
                        background: preset.fallbackGradient,
                      }}
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
                    <div className="bg-black/70 px-1.5 py-1 text-center text-[10px] font-medium text-zinc-200 truncate">
                      {preset.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Display Name & Status Bio */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="profile-displayname"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Pseudonyme affiché
              </label>
              <input
                id="profile-displayname"
                type="text"
                maxLength={32}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="profile-bio"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Statut court <span className="text-zinc-500">(optionnel)</span>
              </label>
              <input
                id="profile-bio"
                type="text"
                maxLength={80}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Ex. Disponible · Mode discret"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Full Biography */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="profile-biography"
                className="block text-xs font-medium text-zinc-300"
              >
                Biographie <span className="text-zinc-500">(optionnelle)</span>
              </label>
              <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                {biography.length}/400
              </span>
            </div>
            <textarea
              id="profile-biography"
              rows={3}
              maxLength={400}
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              placeholder="Présentez-vous en quelques lignes pour vos contacts et vos amis..."
              className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none resize-none"
            />
          </div>

          {/* Avatar Emblem Selector */}
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">
              Emblème d’avatar {avatarDataUrl ? '(remplacé par votre photo)' : ''}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
              {ICON_OPTIONS.map((opt) => {
                const active = avatarIcon === opt.key && !avatarDataUrl;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setAvatarDataUrl(null);
                      setAvatarIcon(opt.key);
                    }}
                    title={opt.label}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-2 px-1 text-[11px] transition-colors cursor-pointer ${
                      active
                        ? 'border-white/30 bg-white/[0.12] text-white'
                        : 'border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                    }`}
                  >
                    {opt.key === 'initials' ? (
                      <span className="font-[family-name:var(--font-display)] text-xs font-semibold">
                        {(displayName.trim() || 'AN').slice(0, 2).toUpperCase()}
                      </span>
                    ) : (
                      renderAvatarGlyph(opt.key, 'h-4 w-4')
                    )}
                    <span className="truncate max-w-full">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent Tone Selector */}
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">
              Teinte glassmorphisme du profil et des bulles
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
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-2 text-xs transition-colors cursor-pointer ${
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

          {/* Glass Intensity (Local Interface Preference) */}
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">
              Intensité du verre dépoli sur cet appareil
            </p>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-white/[0.03] p-1 border border-white/[0.07]">
              {GLASS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChangeGlassIntensity(opt.key)}
                  className={`rounded-lg py-2 px-3 text-xs font-medium transition-colors cursor-pointer ${
                    glassIntensity === opt.key
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.1] px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {savedNotice ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Enregistré</span>
                </>
              ) : (
                <span>{saving ? 'Enregistrement...' : 'Enregistrer le profil'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
