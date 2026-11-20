import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import {
  APP_THEMES,
  type AppThemeDefinition,
  getAppThemeDefinition,
  useAppTheme,
} from '../lib/appTheme';
import type { AppThemeKey } from '../types';

interface ThemeGridProps {
  value: AppThemeKey;
  onChange: (next: AppThemeKey) => void;
  compact?: boolean;
}

const ANIMATED_PREVIEW_CLASS: Partial<Record<AppThemeKey, string>> = {
  borealis: 'preview-anim-borealis',
  prism: 'preview-anim-prism',
  nebula: 'preview-anim-nebula',
  ember: 'preview-anim-ember',
};

export const ThemeGrid: React.FC<ThemeGridProps> = ({
  value,
  onChange,
  compact = false,
}) => {
  const animatedThemes = APP_THEMES.filter((t) => t.animated);
  const classicThemes = APP_THEMES.filter((t) => !t.animated);

  const renderThemeCard = (theme: AppThemeDefinition) => {
    const active = value === theme.key;
    const animClass = ANIMATED_PREVIEW_CLASS[theme.key];

    return (
      <button
        key={theme.key}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => onChange(theme.key)}
        className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
          active
            ? 'glass-control-active border-white/35 shadow-lg'
            : 'glass-surface hover:border-white/25'
        }`}
      >
        {/* Miniature Liquid Glass Preview */}
        <div
          className="relative h-14 w-full overflow-hidden p-2 flex items-end justify-between"
          style={{ backgroundColor: theme.previewBg }}
        >
          <span
            aria-hidden="true"
            className="absolute -top-4 -left-3 h-14 w-16 rounded-full blur-lg opacity-55"
            style={{ backgroundColor: theme.previewOrbA }}
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-4 -right-3 h-12 w-14 rounded-full blur-lg opacity-45"
            style={{ backgroundColor: theme.previewOrbB }}
          />
          {animClass && (
            <span
              aria-hidden="true"
              className={`absolute inset-0 pointer-events-none ${animClass}`}
            />
          )}
          {/* Mini frosted card */}
          <div
            className="relative z-10 h-6 w-12 rounded-md backdrop-blur-md border"
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderColor: theme.previewBorder,
            }}
          />
          {/* Mini specular pill */}
          <div
            className="relative z-10 h-2.5 w-6 rounded-full shadow-sm"
            style={{ backgroundColor: theme.previewButton }}
          />
          {active && (
            <span className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white text-zinc-950 shadow">
              <Check className="h-3 w-3" strokeWidth={2.5} />
            </span>
          )}
        </div>

        {/* Label & short mood */}
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full shrink-0 ${theme.accentSwatch}`}
              />
              <span className="text-xs font-semibold text-white truncate">
                {theme.label}
              </span>
            </div>
            {theme.animated && (
              <span className="text-[10px] font-medium text-zinc-400 shrink-0">
                Animé
              </span>
            )}
          </div>
          {!compact && (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400 line-clamp-1">
              {theme.description}
            </p>
          )}
        </div>
      </button>
    );
  };

  return (
    <div
      className="space-y-3.5"
      role="radiogroup"
      aria-label="Thème de l'application"
    >
      <div className="space-y-2">
        <p className="px-0.5 text-[11px] font-medium text-zinc-400">
          Thèmes animés spéciaux
        </p>
        <div
          className={
            compact
              ? 'grid grid-cols-2 gap-2'
              : 'grid grid-cols-2 sm:grid-cols-4 gap-2.5'
          }
        >
          {animatedThemes.map(renderThemeCard)}
        </div>
      </div>

      <div className="space-y-2">
        <p className="px-0.5 text-[11px] font-medium text-zinc-400">
          Thèmes classiques
        </p>
        <div
          className={
            compact
              ? 'grid grid-cols-2 gap-2'
              : 'grid grid-cols-2 sm:grid-cols-3 gap-2.5'
          }
        >
          {classicThemes.map(renderThemeCard)}
        </div>
      </div>
    </div>
  );
};

interface ThemeSwitcherButtonProps {
  variant?: 'icon' | 'labeled';
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
  buttonClassName?: string;
}

export const ThemeSwitcherButton: React.FC<ThemeSwitcherButtonProps> = ({
  variant = 'icon',
  align = 'right',
  direction = 'down',
  buttonClassName,
}) => {
  const [appTheme, setAppTheme] = useAppTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentDef = getAppThemeDefinition(appTheme);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
          title={`Thème : ${currentDef.label}`}
          aria-label={`Changer le thème (${currentDef.label})`}
          className={`${buttonClassName ?? 'h-9 w-9 rounded-xl'} flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
            open
              ? 'glass-control-active text-white'
              : 'glass-control text-zinc-300 hover:text-white'
          }`}
        >
          <Palette className="h-4 w-4" strokeWidth={1.75} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
          className={`glass-control min-h-[38px] inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
            open ? 'glass-control-active text-white' : ''
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full shrink-0 ${currentDef.accentSwatch}`}
          />
          <span>Thème · {currentDef.label}</span>
        </button>
      )}

      {open && (
        <div
          className={`glass-liquid animate-panel-enter absolute z-50 w-72 sm:w-[320px] max-h-[75dvh] overflow-y-auto rounded-2xl p-3 shadow-2xl ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="flex items-center justify-between px-1 pb-2.5">
            <span className="text-xs font-semibold text-white">
              Thème de l’interface
            </span>
            <span className="text-[11px] text-zinc-400">
              {currentDef.animated ? `Animé · ${currentDef.label}` : currentDef.label}
            </span>
          </div>

          <ThemeGrid
            compact
            value={appTheme}
            onChange={(next) => {
              setAppTheme(next);
            }}
          />
        </div>
      )}
    </div>
  );
};
