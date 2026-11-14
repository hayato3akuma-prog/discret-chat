import bannerObsidianImg from '../assets/images/banner_obsidian_silk_1794665179881.jpg';
import bannerMonolithImg from '../assets/images/banner_monolith_glass_1794665180389.jpg';
import bannerEclipseImg from '../assets/images/banner_lunar_eclipse_1794665181460.jpg';
import bannerEmeraldImg from '../assets/images/banner_emerald_mist_1794665181438.jpg';
import type { BannerPresetKey, PublicUser } from '../types';

export interface BannerPresetMeta {
  key: BannerPresetKey;
  label: string;
  imageUrl: string | null;
  fallbackGradient: string;
}

export const BANNER_PRESETS: BannerPresetMeta[] = [
  {
    key: 'none',
    label: 'Verre uni',
    imageUrl: null,
    fallbackGradient:
      'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(12,12,16,0.9) 100%)',
  },
  {
    key: 'obsidian',
    label: 'Soie noire',
    imageUrl: bannerObsidianImg,
    fallbackGradient:
      'linear-gradient(135deg, #18181f 0%, #09090c 55%, #121218 100%)',
  },
  {
    key: 'monolith',
    label: 'Monolithe',
    imageUrl: bannerMonolithImg,
    fallbackGradient:
      'linear-gradient(135deg, #1d222b 0%, #0a0b0e 60%, #141820 100%)',
  },
  {
    key: 'eclipse',
    label: 'Éclipse',
    imageUrl: bannerEclipseImg,
    fallbackGradient:
      'linear-gradient(180deg, #050507 0%, #16161d 100%)',
  },
  {
    key: 'emerald',
    label: 'Brume',
    imageUrl: bannerEmeraldImg,
    fallbackGradient:
      'linear-gradient(135deg, #0d1c16 0%, #060908 65%, #11221b 100%)',
  },
];

export function resolveUserBanner(
  user: Pick<PublicUser, 'bannerPreset' | 'bannerDataUrl'>
): { imageUrl: string | null; fallbackGradient: string } {
  if (user.bannerPreset === 'custom' && user.bannerDataUrl) {
    return {
      imageUrl: user.bannerDataUrl,
      fallbackGradient:
        'linear-gradient(135deg, #141418 0%, #070709 100%)',
    };
  }

  const presetKey = user.bannerPreset ?? 'obsidian';
  const match = BANNER_PRESETS.find((p) => p.key === presetKey);
  if (match) {
    return {
      imageUrl: match.imageUrl,
      fallbackGradient: match.fallbackGradient,
    };
  }

  return {
    imageUrl: bannerObsidianImg,
    fallbackGradient:
      'linear-gradient(135deg, #18181f 0%, #09090c 100%)',
  };
}
