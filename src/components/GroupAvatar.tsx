import React from 'react';
import { Users } from 'lucide-react';
import type { GroupInfo } from '../types';
import { TONE_CLASSES } from './UserAvatar';

interface GroupAvatarProps {
  group: Pick<GroupInfo, 'name' | 'avatarDataUrl' | 'accentTone'>;
  size?: 'sm' | 'md' | 'lg';
}

export const GroupAvatar: React.FC<GroupAvatarProps> = ({
  group,
  size = 'md',
}) => {
  const tone =
    TONE_CLASSES[group.accentTone ?? 'platinum'] ?? TONE_CLASSES.platinum;

  const sizeClass =
    size === 'sm'
      ? 'h-9 w-9 rounded-xl'
      : size === 'lg'
        ? 'h-16 w-16 rounded-2xl'
        : 'h-10 w-10 rounded-xl';

  const iconSize = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center border ${sizeClass} ${tone.avatarBg} ${tone.avatarBorder} text-white overflow-hidden`}
    >
      {group.avatarDataUrl ? (
        <img
          src={group.avatarDataUrl}
          alt={group.name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <Users className={iconSize} />
      )}
    </div>
  );
};
