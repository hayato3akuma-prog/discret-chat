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
      'bg-white/[0.11] border border-white/[0.16] text-white backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    emerald:
      'bg-emerald-500/[0.14] border border-emerald-400/[0.22] text-white backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    slate:
      'bg-sky-400/[0.12] border border-sky-300/[0.20] text-white backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    amber:
      'bg-amber-400/[0.12] border border-amber-300/[0.20] text-white backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]',
    crimson:
      'bg-rose-400/[0.12] border border-rose-300/[0.20] text-white backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]',
  },
  solid: {
    platinum: 'bg-zinc-800/95 border border-zinc-700/70 text-white',
    emerald: 'bg-emerald-950/90 border border-emerald-700/50 text-emerald-50',
    slate: 'bg-sky-950/90 border border-sky-700/50 text-sky-50',
    amber: 'bg-amber-950/90 border border-amber-700/50 text-amber-50',
    crimson: 'bg-rose-950/90 border border-rose-700/50 text-rose-50',
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
      'bg-gradient-to-b from-white/[0.16] to-white/[0.08] border border-white/[0.22] text-white backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.14)]',
    emerald:
      'bg-gradient-to-b from-emerald-400/[0.22] to-emerald-500/[0.1] border border-emerald-400/[0.3] text-white backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
    slate:
      'bg-gradient-to-b from-sky-300/[0.19] to-sky-400/[0.09] border border-sky-300/[0.28] text-white backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
    amber:
      'bg-gradient-to-b from-amber-300/[0.19] to-amber-400/[0.09] border border-amber-300/[0.28] text-white backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
    crimson:
      'bg-gradient-to-b from-rose-300/[0.19] to-rose-400/[0.09] border border-rose-300/[0.28] text-white backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
  },
};

const RECEIVED_STYLE_CLASSES: Record<BubbleStyleKey, string> = {
  glass:
    'bg-white/[0.035] border border-white/[0.065] text-zinc-100 backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]',
  solid: 'bg-[#14141a] border border-white/[0.06] text-zinc-100',
  outline: 'bg-[#08080c]/75 border border-white/[0.18] text-zinc-100',
  elevated:
    'bg-gradient-to-b from-white/[0.065] to-white/[0.025] border border-white/[0.1] text-zinc-100 backdrop-blur-xl shadow-[0_6px_18px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
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
