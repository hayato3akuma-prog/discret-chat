import React, { useState } from 'react';
import { resolveUserBanner } from '../lib/banners';
import type { PublicUser } from '../types';

interface ProfileBannerProps {
  user: Pick<PublicUser, 'displayName' | 'bannerPreset' | 'bannerDataUrl'>;
  className?: string;
  scrimClassName?: string;
}

export const ProfileBanner: React.FC<ProfileBannerProps> = ({
  user,
  className = 'h-24',
  scrimClassName = 'bg-gradient-to-t from-[#09090C]/90 via-black/35 to-black/15',
}) => {
  const { imageUrl, fallbackGradient } = resolveUserBanner(user);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{ background: fallbackGradient }}
    >
      {imageUrl && !imgFailed && (
        <img
          src={imageUrl}
          alt={`Bannière de ${user.displayName}`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div
        aria-hidden="true"
        className={`absolute inset-0 ${scrimClassName}`}
      />
    </div>
  );
};
