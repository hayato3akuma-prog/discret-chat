import React from 'react';
import {
  Compass,
  Diamond,
  Eye,
  Feather,
  Lock,
  Moon,
  Shield,
} from 'lucide-react';
import type { AccentToneKey, AvatarIconKey, PublicUser } from '../types';

export const TONE_CLASSES: Record<
  AccentToneKey,
  {
    avatarBg: string;
    avatarBorder: string;
    bubbleBg: string;
    bubbleBorder: string;
    swatch: string;
    label: string;
  }
> = {
  platinum: {
    avatarBg: 'bg-white/[0.08]',
    avatarBorder: 'border-white/[0.16]',
    bubbleBg: 'bg-white/[0.11]',
    bubbleBorder: 'border-white/[0.16]',
    swatch: 'bg-zinc-200',
    label: 'Platine',
  },
  emerald: {
    avatarBg: 'bg-emerald-500/[0.12]',
    avatarBorder: 'border-emerald-400/[0.28]',
    bubbleBg: 'bg-emerald-500/[0.14]',
    bubbleBorder: 'border-emerald-400/[0.22]',
    swatch: 'bg-emerald-400',
    label: 'Émeraude',
  },
  slate: {
    avatarBg: 'bg-sky-400/[0.11]',
    avatarBorder: 'border-sky-300/[0.26]',
    bubbleBg: 'bg-sky-400/[0.12]',
    bubbleBorder: 'border-sky-300/[0.20]',
    swatch: 'bg-sky-300',
    label: 'Acier',
  },
  amber: {
    avatarBg: 'bg-amber-400/[0.11]',
    avatarBorder: 'border-amber-300/[0.26]',
    bubbleBg: 'bg-amber-400/[0.12]',
    bubbleBorder: 'border-amber-300/[0.20]',
    swatch: 'bg-amber-300',
    label: 'Ambre',
  },
  crimson: {
    avatarBg: 'bg-rose-400/[0.11]',
    avatarBorder: 'border-rose-300/[0.26]',
    bubbleBg: 'bg-rose-400/[0.12]',
    bubbleBorder: 'border-rose-300/[0.20]',
    swatch: 'bg-rose-400',
    label: 'Rubis',
  },
};

export function renderAvatarGlyph(icon?: AvatarIconKey, sizeClass = 'h-4 w-4') {
  switch (icon) {
    case 'shield':
      return <Shield className={sizeClass} />;
    case 'moon':
      return <Moon className={sizeClass} />;
    case 'compass':
      return <Compass className={sizeClass} />;
    case 'eye':
      return <Eye className={sizeClass} />;
    case 'feather':
      return <Feather className={sizeClass} />;
    case 'diamond':
      return <Diamond className={sizeClass} />;
    default:
      return null;
  }
}

interface UserAvatarProps {
  user: Pick<
    PublicUser,
    'displayName' | 'avatarDataUrl' | 'avatarIcon' | 'accentTone'
  >;
  isSelfVault?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  isSelfVault = false,
  size = 'md',
}) => {
  const tone = TONE_CLASSES[user.accentTone ?? 'platinum'] ?? TONE_CLASSES.platinum;

  const sizeClass =
    size === 'sm'
      ? 'h-9 w-9 text-xs'
      : size === 'lg'
        ? 'h-16 w-16 text-lg'
        : 'h-10 w-10 text-xs';

  const iconSize = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
  const glyph = !isSelfVault ? renderAvatarGlyph(user.avatarIcon, iconSize) : null;

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-full border ${sizeClass} ${tone.avatarBg} ${tone.avatarBorder} font-[family-name:var(--font-display)] font-semibold text-white overflow-hidden`}
    >
      {isSelfVault ? (
        <Lock className={`${iconSize} text-zinc-200`} />
      ) : user.avatarDataUrl ? (
        <img
          src={user.avatarDataUrl}
          alt={user.displayName}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : glyph ? (
        glyph
      ) : (
        <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
};
