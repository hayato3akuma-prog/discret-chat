import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Palette,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { BANNER_PRESETS } from '../lib/banners';
import {
  BUBBLE_SHAPE_OPTIONS,
  BUBBLE_STYLE_OPTIONS,
  getBubbleClassNames,
  getMessageTextSizeClass,
  MESSAGE_TEXT_SIZE_OPTIONS,
} from '../lib/bubbleTheme';
import {
  isPseudonymAvailable,
  normalizePseudoKey,
  updateMyProfileInFirestore,
} from '../lib/firestoreStore';
import {
  prepareAvatarImageOrGif,
  prepareBannerImageOrGif,
} from '../lib/imageUtils';
import type {
  AccentToneKey,
  AvatarIconKey,
  BannerPresetKey,
  BubbleShapeKey,
  BubbleStyleKey,
  GlassIntensity,
  MessageTextSize,
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
  messageTextSize: MessageTextSize;
  onChangeMessageTextSize: (val: MessageTextSize) => void;
  onProfileUpdated: (updated: PublicUser) => void;
}

type ProfileTab = 'identity' | 'appearance' | 'preferences';

const ICON_OPTIONS: { key: AvatarIconKey; label: string }[] = [
  { key: 'initials', label: 'Initiales' },
  { key: 'shield', label: 'Bouclier' },
  { key: 'moon', label: 'Lune' },
  { key: 'compass', label: 'Boussole' },
  { key: 'eye', label: 'Œil' },
  { key: 'feather', label: 'Plume' },
  { key: 'diamond', label: 'Diamant' },
];

const GLASS_OPTIONS: {
  key: GlassIntensity;
  label: string;
  description: string;
}[] = [
  {
    key: 'subtle',
    label: 'Subtil',
    description: 'Transparence légère et flou discret',
  },
  {
    key: 'balanced',
    label: 'Équilibré',
    description: 'Contraste optimal entre texte et verre fumé',
  },
  {
    key: 'deep',
    label: 'Profond',
    description: 'Verre plus dense et flou renforcé',
  },
];

const QUICK_STATUS_PRESETS = [
  'Disponible',
  'En mode discret',
  'Occupé',
  'Ne pas déranger',
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  glassIntensity,
  onChangeGlassIntensity,
  messageTextSize,
  onChangeMessageTextSize,
  onProfileUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>('identity');

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
  const [bubbleShape, setBubbleShape] = useState<BubbleShapeKey>(
    user.bubbleShape ?? 'rounded'
  );
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyleKey>(
    user.bubbleStyle ?? 'glass'
  );

  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);

  const [pseudoStatus, setPseudoStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');
  const [pseudoMessage, setPseudoMessage] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('identity');
      setDisplayName(user.displayName);
      setBio(user.bio ?? '');
      setBiography(user.biography ?? '');
      setAvatarDataUrl(user.avatarDataUrl ?? null);
      setAvatarIcon(user.avatarIcon ?? 'initials');
      setAccentTone(user.accentTone ?? 'platinum');
      setBannerPreset(user.bannerPreset ?? 'obsidian');
      setBannerDataUrl(user.bannerDataUrl ?? null);
      setBubbleShape(user.bubbleShape ?? 'rounded');
      setBubbleStyle(user.bubbleStyle ?? 'glass');
      setError(null);
      setSavedNotice(false);
      setPseudoStatus('idle');
      setPseudoMessage(null);
      setCopiedHandle(false);
      setCopiedFingerprint(false);
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, saving, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = displayName.trim();
    const nextKey = normalizePseudoKey(trimmed);
    const currentKey = normalizePseudoKey(user.displayName);

    if (trimmed.length < 2 || nextKey.length < 2) {
      setPseudoStatus('invalid');
      setPseudoMessage('Minimum 2 lettres ou chiffres.');
      return;
    }

    if (nextKey === currentKey) {
      setPseudoStatus('available');
      setPseudoMessage(null);
      return;
    }

    let cancelled = false;
    setPseudoStatus('checking');
    setPseudoMessage(null);
    const timer = window.setTimeout(async () => {
      const res = await isPseudonymAvailable(trimmed, user.id);
      if (cancelled) return;
      if (res.available) {
        setPseudoStatus('available');
        setPseudoMessage('Pseudonyme disponible');
      } else {
        setPseudoStatus('taken');
        setPseudoMessage(
          res.reason || 'Ce pseudonyme est déjà utilisé par une autre personne.'
        );
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [displayName, isOpen, user.displayName, user.id]);

  const hasChanges = useMemo(() => {
    return (
      displayName.trim() !== user.displayName.trim() ||
      bio.trim() !== (user.bio ?? '').trim() ||
      biography.trim() !== (user.biography ?? '').trim() ||
      (avatarDataUrl ?? null) !== (user.avatarDataUrl ?? null) ||
      avatarIcon !== (user.avatarIcon ?? 'initials') ||
      accentTone !== (user.accentTone ?? 'platinum') ||
      bannerPreset !== (user.bannerPreset ?? 'obsidian') ||
      (bannerDataUrl ?? null) !== (user.bannerDataUrl ?? null) ||
      bubbleShape !== (user.bubbleShape ?? 'rounded') ||
      bubbleStyle !== (user.bubbleStyle ?? 'glass')
    );
  }, [
    displayName,
    bio,
    biography,
    avatarDataUrl,
    avatarIcon,
    accentTone,
    bannerPreset,
    bannerDataUrl,
    bubbleShape,
    bubbleStyle,
    user,
  ]);

  if (!isOpen) return null;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingAvatar(true);
    try {
      const prepared = await prepareAvatarImageOrGif(file);
      setAvatarDataUrl(prepared);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible de charger cette image.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingBanner(true);
    try {
      const prepared = await prepareBannerImageOrGif(file);
      setBannerDataUrl(prepared);
      setBannerPreset('custom');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger cette bannière.'
      );
    } finally {
      setUploadingBanner(false);
    }
  }

  function handleResetAppearance() {
    setAvatarDataUrl(null);
    setAvatarIcon('initials');
    setAccentTone('platinum');
    setBannerDataUrl(null);
    setBannerPreset('obsidian');
    setBubbleShape('rounded');
    setBubbleStyle('glass');
    onChangeMessageTextSize('normal');
    onChangeGlassIntensity('balanced');
    setError(null);
  }

  async function handleCopyHandle() {
    try {
      await navigator.clipboard.writeText(user.handle);
      setCopiedHandle(true);
      window.setTimeout(() => setCopiedHandle(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  }

  async function handleCopyFingerprint() {
    try {
      await navigator.clipboard.writeText(user.fingerprint);
      setCopiedFingerprint(true);
      window.setTimeout(() => setCopiedFingerprint(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleanPseudo = displayName.trim();
    if (cleanPseudo.length < 2 || normalizePseudoKey(cleanPseudo).length < 2) {
      setActiveTab('identity');
      setError('Le pseudonyme doit contenir au moins 2 lettres ou chiffres.');
      return;
    }
    if (pseudoStatus === 'taken') {
      setActiveTab('identity');
      setError('Ce pseudonyme est déjà utilisé par une autre personne.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMyProfileInFirestore(user.id, {
        displayName: cleanPseudo,
        bio: bio.trim(),
        biography: biography.trim(),
        avatarDataUrl,
        avatarIcon,
        accentTone,
        bannerPreset,
        bannerDataUrl,
        bubbleShape,
        bubbleStyle,
      });

      onProfileUpdated(updated);
      setSavedNotice(true);
      window.setTimeout(() => {
        setSavedNotice(false);
        onClose();
      }, 600);
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
    bubbleShape,
    bubbleStyle,
  };

  const previewSentBubbleClass = getBubbleClassNames({
    isMine: true,
    accentTone,
    bubbleShape,
    bubbleStyle,
  });
  const previewReceivedBubbleClass = getBubbleClassNames({
    isMine: false,
    accentTone,
    bubbleShape,
    bubbleStyle,
  });
  const previewTextClass = getMessageTextSizeClass(messageTextSize);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <form
        onSubmit={handleSave}
        className="glass-elevated w-full max-w-xl max-h-[90dvh] rounded-3xl flex flex-col overflow-hidden"
      >
        {/* Sticky Minimal Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
          <div className="min-w-0">
            <h2
              id="profile-modal-title"
              className="font-[family-name:var(--font-display)] text-base sm:text-lg font-semibold text-white truncate"
            >
              Modifier le profil
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {hasChanges
                ? 'Modifications en attente d’enregistrement'
                : 'Identité publique, apparence et préférences locales'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="h-9 w-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.07] hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="px-5 sm:px-6 pt-3.5 pb-2 shrink-0">
          <div
            role="tablist"
            aria-label="Sections du profil"
            className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.025] p-1 border border-white/[0.055]"
          >
            {(
              [
                { id: 'identity', label: 'Identité', icon: UserIcon },
                { id: 'appearance', label: 'Apparence', icon: Palette },
                { id: 'preferences', label: 'Interface', icon: SlidersHorizontal },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-white/[0.11] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hidden File Inputs shared across tabs */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*,.gif"
          onChange={handleAvatarChange}
          className="hidden"
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*,.gif"
          onChange={handleBannerUpload}
          className="hidden"
        />

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
          {/* Live Profile Card Preview (shown on Identity & Appearance) */}
          {activeTab !== 'preferences' && (
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
              <div className="relative">
                <ProfileBanner user={previewUser} className="h-24 sm:h-28" />
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={uploadingBanner}
                    onClick={() => bannerInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-black/80 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {uploadingBanner ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                    <span>Bannière / GIF</span>
                  </button>
                  {bannerPreset === 'custom' && bannerDataUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setBannerDataUrl(null);
                        setBannerPreset('obsidian');
                      }}
                      title="Retirer la bannière personnalisée"
                      aria-label="Retirer la bannière personnalisée"
                      className="h-7 w-7 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/15 text-zinc-300 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="px-4 pb-4">
                <div className="-mt-8 mb-2.5 flex items-end justify-between gap-3">
                  <div className="rounded-full p-1 bg-[#0b0b0f] border border-white/10 shrink-0">
                    <UserAvatar user={previewUser} size="lg" />
                  </div>

                  <div className="flex items-center gap-1.5 pt-2">
                    <button
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.1] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Camera className="h-3.5 w-3.5" />
                      )}
                      <span>Photo / GIF</span>
                    </button>
                    {avatarDataUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarDataUrl(null)}
                        title="Retirer la photo"
                        aria-label="Retirer la photo"
                        className="h-8 w-8 flex items-center justify-center rounded-xl border border-white/[0.08] text-zinc-400 hover:text-red-300 hover:bg-white/[0.05] transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-[family-name:var(--font-display)] text-base font-semibold text-white truncate">
                    {previewUser.displayName}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyHandle}
                    title="Copier votre identifiant"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400 hover:text-white transition-colors shrink-0 cursor-pointer"
                  >
                    <span>{user.handle}</span>
                    {copiedHandle ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-60" />
                    )}
                  </button>
                </div>

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
          )}

          {/* TAB 1: IDENTITY */}
          {activeTab === 'identity' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="profile-displayname"
                    className="text-xs font-medium text-zinc-300"
                  >
                    Pseudonyme unique
                  </label>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    {displayName.trim().length}/32
                  </span>
                </div>
                <input
                  id="profile-displayname"
                  type="text"
                  required
                  minLength={2}
                  maxLength={32}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
                />
                {pseudoStatus === 'checking' && (
                  <p className="mt-1.5 text-[11px] text-zinc-400 flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Vérification de disponibilité...</span>
                  </p>
                )}
                {pseudoMessage && pseudoStatus !== 'checking' && (
                  <p
                    className={`mt-1.5 text-[11px] ${
                      pseudoStatus === 'available'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {pseudoMessage}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="profile-bio"
                    className="text-xs font-medium text-zinc-300"
                  >
                    Statut court <span className="text-zinc-500">(optionnel)</span>
                  </label>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    {bio.length}/80
                  </span>
                </div>
                <input
                  id="profile-bio"
                  type="text"
                  maxLength={80}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Ex. Disponible · Mode discret"
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_STATUS_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBio(bio === preset ? '' : preset)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors cursor-pointer border ${
                        bio === preset
                          ? 'bg-white/[0.11] text-white border-white/[0.15]'
                          : 'bg-white/[0.02] text-zinc-400 border-white/[0.06] hover:text-zinc-200 hover:bg-white/[0.05]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="profile-biography"
                    className="text-xs font-medium text-zinc-300"
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
            </div>
          )}

          {/* TAB 2: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-5">
              {/* Live Message Bubble Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-zinc-300">
                    Aperçu des bulles de messages
                  </p>
                  <span className="text-[11px] text-zinc-500">
                    Images & GIF animés pris en charge
                  </span>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-[#07070a]/75 p-3.5 space-y-2.5">
                  <div className="flex justify-start">
                    <div
                      className={`max-w-[82%] px-3.5 py-2 transition-all ${previewReceivedBubbleClass}`}
                    >
                      <p className={previewTextClass}>
                        On garde le canal discret ?
                      </p>
                      <p className="mt-0.5 text-[10px] font-mono text-zinc-500 tabular-nums">
                        22:17
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div
                      className={`max-w-[82%] px-3.5 py-2 transition-all ${previewSentBubbleClass}`}
                    >
                      <p className={previewTextClass}>
                        Oui, tout est chiffré de bout en bout.
                      </p>
                      <p className="mt-0.5 text-[10px] font-mono text-zinc-300/80 text-right tabular-nums">
                        22:18
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bubble Shape */}
              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Forme des bulles
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {BUBBLE_SHAPE_OPTIONS.map((opt) => {
                    const active = bubbleShape === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setBubbleShape(opt.key)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border py-2.5 px-2 text-[11px] font-medium transition-colors cursor-pointer ${
                          active
                            ? 'border-white/30 bg-white/[0.11] text-white'
                            : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-8 border ${
                            active
                              ? 'border-white/50 bg-white/20'
                              : 'border-white/25 bg-white/[0.06]'
                          } ${opt.sentRadius}`}
                        />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bubble Surface Style & Text Size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-zinc-300 mb-2">
                    Surface des bulles
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BUBBLE_STYLE_OPTIONS.map((opt) => {
                      const active = bubbleStyle === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setBubbleStyle(opt.key)}
                          className={`rounded-xl border py-2 px-2.5 text-xs font-medium transition-colors cursor-pointer ${
                            active
                              ? 'border-white/30 bg-white/[0.11] text-white'
                              : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-zinc-300 mb-2">
                    Taille du texte
                  </p>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.025] p-1 border border-white/[0.06]">
                    {MESSAGE_TEXT_SIZE_OPTIONS.map((opt) => {
                      const active = messageTextSize === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => onChangeMessageTextSize(opt.key)}
                          className={`rounded-lg py-2 px-2 text-xs font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Banner Presets */}
              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Bannière du profil
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {BANNER_PRESETS.map((preset) => {
                    const active = bannerPreset === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => setBannerPreset(preset.key)}
                        className={`group relative overflow-hidden rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-white/55 ring-1 ring-white/30'
                            : 'border-white/[0.07] hover:border-white/25'
                        }`}
                      >
                        <div
                          className="h-11 w-full bg-cover bg-center"
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
                        <div className="bg-black/70 px-1.5 py-1 text-center text-[10px] font-medium text-zinc-200 truncate">
                          {preset.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Avatar Emblem */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-zinc-300">
                    Emblème d’avatar
                  </p>
                  {avatarDataUrl && (
                    <span className="text-[11px] text-zinc-500">
                      Remplacé par votre photo
                    </span>
                  )}
                </div>
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
                            ? 'border-white/30 bg-white/[0.11] text-white'
                            : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
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

              {/* Accent Tone */}
              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Teinte du profil et des bulles
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
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 px-2 text-xs transition-colors cursor-pointer ${
                          active
                            ? 'border-white/30 bg-white/[0.11] text-white'
                            : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${tone.swatch}`} />
                        <span className="hidden sm:inline">{tone.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INTERFACE & SECURITY INFO */}
          {activeTab === 'preferences' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  Intensité du verre dépoli sur cet appareil
                </p>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-white/[0.025] p-1 border border-white/[0.06]">
                  {GLASS_OPTIONS.map((opt) => {
                    const active = glassIntensity === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => onChangeGlassIntensity(opt.key)}
                        className={`rounded-lg py-2 px-3 text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {GLASS_OPTIONS.find((o) => o.key === glassIntensity)?.description}
                </p>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Identité cryptographique publique</span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500">Identifiant</span>
                    <button
                      type="button"
                      onClick={handleCopyHandle}
                      className="inline-flex items-center gap-1.5 font-mono text-zinc-200 hover:text-white transition-colors cursor-pointer truncate"
                    >
                      <span className="truncate">{user.handle}</span>
                      {copiedHandle ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 opacity-60 shrink-0" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/[0.05]">
                    <span className="text-zinc-500 shrink-0">Empreinte P-256</span>
                    <button
                      type="button"
                      onClick={handleCopyFingerprint}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer truncate"
                    >
                      <span className="truncate">{user.fingerprint}</span>
                      {copiedFingerprint ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 opacity-60 shrink-0" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-zinc-300">
                    Style par défaut
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Réinitialiser bannière, photo, emblème et teinte
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleResetAppearance}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Réinitialiser</span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
            >
              {error}
            </div>
          )}
        </div>

        {/* Sticky Minimal Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 sm:px-6 py-4 border-t border-white/[0.06] bg-black/25 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
          >
            {hasChanges ? 'Annuler' : 'Fermer'}
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              savedNotice ||
              !hasChanges ||
              pseudoStatus === 'checking' ||
              pseudoStatus === 'taken' ||
              pseudoStatus === 'invalid'
            }
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            {savedNotice ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span>Enregistré</span>
              </>
            ) : saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Enregistrement...</span>
              </>
            ) : (
              <span>Enregistrer</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
