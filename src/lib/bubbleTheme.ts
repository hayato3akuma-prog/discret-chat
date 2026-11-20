import type {
  AccentToneKey,
  BubbleShapeKey,
  BubbleStyleKey,
  MessageTextSize,
} from '../types';

export const BUBBLE_SHAPE_OPTIONS: {
  key: BubbleShapeKey;
  label: string;
  sentRadius: string;
  receivedRadius: string;
}[] = [
  {
    key: 'rounded',
    label: 'Arrondi',
    sentRadius: 'rounded-2xl',
    receivedRadius: 'rounded-2xl',
  },
  {
    key: 'editorial',
    label: 'Éditorial',
    sentRadius: 'rounded-2xl rounded-br-sm',
    receivedRadius: 'rounded-2xl rounded-bl-sm',
  },
  {
    key: 'pill',
    label: 'Doux',
    sentRadius: 'rounded-[22px]',
    receivedRadius: 'rounded-[22px]',
  },
  {
    key: 'sharp',
    label: 'Minimal',
    sentRadius: 'rounded-lg',
    receivedRadius: 'rounded-lg',
  },
];

export const BUBBLE_STYLE_OPTIONS: {
  key: BubbleStyleKey;
  label: string;
}[] = [
  { key: 'glass', label: 'Verre fumé' },
  { key: 'solid', label: 'Uni' },
  { key: 'outline', label: 'Contour' },
  { key: 'elevated', label: 'Relief' },
];

export const MESSAGE_TEXT_SIZE_OPTIONS: {
  key: MessageTextSize;
  label: string;
  textClass: string;
}[] = [
  { key: 'compact', label: 'Compact', textClass: 'text-[13px] leading-relaxed' },
  { key: 'normal', label: 'Standard', textClass: 'text-[14px] leading-relaxed' },
  { key: 'large', label: 'Confort', textClass: 'text-[15px] leading-relaxed' },
];

const SENT_STYLE_TONE_CLASSES: Record<
  BubbleStyleKey,
  Record<AccentToneKey, string>
> = {
  glass: {
    platinum:
      'bg-gradient-to-br from-white/[0.18] via-white/[0.09] to-white/[0.045] border border-white/[0.22] text-white backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28),inset_0_-1px_0_0_rgba(255,255,255,0.05),0_10px_28px_-10px_rgba(0,0,0,0.62)]',
    emerald:
      'bg-gradient-to-br from-emerald-400/[0.22] via-emerald-500/[0.12] to-teal-500/[0.06] border border-emerald-300/[0.28] text-white backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(209,250,229,0.32),inset_0_-1px_0_0_rgba(16,185,129,0.08),0_10px_28px_-10px_rgba(0,0,0,0.62)]',
    slate:
      'bg-gradient-to-br from-sky-300/[0.2] via-sky-400/[0.11] to-indigo-400/[0.055] border border-sky-200/[0.26] text-white backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(224,242,254,0.3),inset_0_-1px_0_0_rgba(56,189,248,0.08),0_10px_28px_-10px_rgba(0,0,0,0.62)]',
    amber:
      'bg-gradient-to-br from-amber-300/[0.2] via-amber-400/[0.11] to-orange-400/[0.055] border border-amber-200/[0.26] text-white backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(254,243,199,0.3),inset_0_-1px_0_0_rgba(245,158,11,0.08),0_10px_28px_-10px_rgba(0,0,0,0.62)]',
    crimson:
      'bg-gradient-to-br from-rose-300/[0.2] via-rose-400/[0.11] to-pink-500/[0.055] border border-rose-200/[0.26] text-white backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(255,228,230,0.3),inset_0_-1px_0_0_rgba(244,63,94,0.08),0_10px_28px_-10px_rgba(0,0,0,0.62)]',
  },
  solid: {
    platinum: 'bg-zinc-800/95 border border-zinc-700/70 text-white shadow-sm',
    emerald: 'bg-emerald-950/90 border border-emerald-700/50 text-emerald-50 shadow-sm',
    slate: 'bg-sky-950/90 border border-sky-700/50 text-sky-50 shadow-sm',
    amber: 'bg-amber-950/90 border border-amber-700/50 text-amber-50 shadow-sm',
    crimson: 'bg-rose-950/90 border border-rose-700/50 text-rose-50 shadow-sm',
  },
  outline: {
    platinum: 'bg-[#09090d]/85 border border-white/30 text-white',
    emerald: 'bg-[#08100d]/85 border border-emerald-400/45 text-emerald-50',
    slate: 'bg-[#080d12]/85 border border-sky-300/45 text-sky-50',
    amber: 'bg-[#110e08]/85 border border-amber-300/45 text-amber-50',
    crimson: 'bg-[#12090d]/85 border border-rose-300/45 text-rose-50',
  },
  elevated: {
    platinum:
      'bg-gradient-to-b from-white/[0.22] via-white/[0.11] to-white/[0.06] border border-white/[0.28] text-white backdrop-blur-2xl backdrop-saturate-[200%] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.72),inset_0_1.5px_0_0_rgba(255,255,255,0.36),inset_0_-1px_0_0_rgba(255,255,255,0.07)]',
    emerald:
      'bg-gradient-to-b from-emerald-300/[0.28] via-emerald-500/[0.15] to-emerald-600/[0.07] border border-emerald-300/[0.34] text-white backdrop-blur-2xl backdrop-saturate-[200%] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.72),inset_0_1.5px_0_0_rgba(209,250,229,0.38),inset_0_-1px_0_0_rgba(16,185,129,0.1)]',
    slate:
      'bg-gradient-to-b from-sky-200/[0.25] via-sky-400/[0.14] to-sky-500/[0.065] border border-sky-200/[0.32] text-white backdrop-blur-2xl backdrop-saturate-[200%] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.72),inset_0_1.5px_0_0_rgba(224,242,254,0.36),inset_0_-1px_0_0_rgba(56,189,248,0.1)]',
    amber:
      'bg-gradient-to-b from-amber-200/[0.25] via-amber-400/[0.14] to-amber-500/[0.065] border border-amber-200/[0.32] text-white backdrop-blur-2xl backdrop-saturate-[200%] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.72),inset_0_1.5px_0_0_rgba(254,243,199,0.36),inset_0_-1px_0_0_rgba(245,158,11,0.1)]',
    crimson:
      'bg-gradient-to-b from-rose-200/[0.25] via-rose-400/[0.14] to-rose-500/[0.065] border border-rose-200/[0.32] text-white backdrop-blur-2xl backdrop-saturate-[200%] shadow-[0_14px_34px_-10px_rgba(0,0,0,0.72),inset_0_1.5px_0_0_rgba(255,228,230,0.36),inset_0_-1px_0_0_rgba(244,63,94,0.1)]',
  },
};

const RECEIVED_STYLE_CLASSES: Record<BubbleStyleKey, string> = {
  glass:
    'bg-gradient-to-br from-white/[0.095] via-white/[0.045] to-white/[0.02] border border-white/[0.14] text-zinc-100 backdrop-blur-2xl backdrop-saturate-[185%] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.17),inset_0_-1px_0_0_rgba(255,255,255,0.025),0_10px_28px_-12px_rgba(0,0,0,0.6)]',
  solid: 'bg-[#14141a]/95 border border-white/[0.08] text-zinc-100 shadow-sm',
  outline: 'bg-[#08080c]/75 backdrop-blur-md border border-white/[0.2] text-zinc-100',
  elevated:
    'bg-gradient-to-b from-white/[0.13] via-white/[0.06] to-white/[0.03] border border-white/[0.18] text-zinc-100 backdrop-blur-2xl backdrop-saturate-[195%] shadow-[0_14px_30px_-10px_rgba(0,0,0,0.68),inset_0_1.5px_0_0_rgba(255,255,255,0.24),inset_0_-1px_0_0_rgba(255,255,255,0.035)]',
};

export function getBubbleClassNames(params: {
  isMine: boolean;
  accentTone?: AccentToneKey;
  bubbleShape?: BubbleShapeKey;
  bubbleStyle?: BubbleStyleKey;
}): string {
  const shapeKey: BubbleShapeKey = params.bubbleShape ?? 'rounded';
  const styleKey: BubbleStyleKey = params.bubbleStyle ?? 'glass';
  const toneKey: AccentToneKey = params.accentTone ?? 'platinum';

  const shapeDef =
    BUBBLE_SHAPE_OPTIONS.find((s) => s.key === shapeKey) ??
    BUBBLE_SHAPE_OPTIONS[0];
  const radiusClass = params.isMine
    ? shapeDef.sentRadius
    : shapeDef.receivedRadius;

  const surfaceClass = params.isMine
    ? SENT_STYLE_TONE_CLASSES[styleKey]?.[toneKey] ??
      SENT_STYLE_TONE_CLASSES.glass.platinum
    : RECEIVED_STYLE_CLASSES[styleKey] ?? RECEIVED_STYLE_CLASSES.glass;

  return `${radiusClass} ${surfaceClass}`;
}

export function getMessageTextSizeClass(size?: MessageTextSize): string {
  return (
    MESSAGE_TEXT_SIZE_OPTIONS.find((o) => o.key === (size ?? 'normal'))
      ?.textClass ?? MESSAGE_TEXT_SIZE_OPTIONS[1].textClass
  );
}
