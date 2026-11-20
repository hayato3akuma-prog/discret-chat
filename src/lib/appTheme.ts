import { useCallback, useEffect, useState } from 'react';
import type { AppThemeKey } from '../types';

export interface AppThemeDefinition {
  key: AppThemeKey;
  label: string;
  description: string;
  canvasColor: string;
  previewBg: string;
  previewOrbA: string;
  previewOrbB: string;
  previewBorder: string;
  previewButton: string;
  accentSwatch: string;
}

export const APP_THEMES: AppThemeDefinition[] = [
  {
    key: 'obsidian',
    label: 'Obsidienne',
    description: 'Noir pur et platine neutre',
    canvasColor: '#050507',
    previewBg: '#060609',
    previewOrbA: '#bae6fd',
    previewOrbB: '#34d399',
    previewBorder: 'rgba(255, 255, 255, 0.22)',
    previewButton: '#ffffff',
    accentSwatch: 'bg-zinc-200',
  },
  {
    key: 'aurora',
    label: 'Aurore',
    description: 'Émeraude profonde et jade polaire',
    canvasColor: '#030908',
    previewBg: '#04100d',
    previewOrbA: '#34d399',
    previewOrbB: '#2dd4bf',
    previewBorder: 'rgba(110, 231, 183, 0.28)',
    previewButton: '#d1fae5',
    accentSwatch: 'bg-emerald-400',
  },
  {
    key: 'abyssal',
    label: 'Abysses',
    description: 'Bleu nuit saphir et verre cobalt',
    canvasColor: '#040711',
    previewBg: '#060c1c',
    previewOrbA: '#38bdf8',
    previewOrbB: '#818cf8',
    previewBorder: 'rgba(125, 211, 252, 0.28)',
    previewButton: '#e0f2fe',
    accentSwatch: 'bg-sky-400',
  },
  {
    key: 'amber',
    label: 'Ambre',
    description: 'Obsidienne chaude et reflets dorés',
    canvasColor: '#090603',
    previewBg: '#120c05',
    previewOrbA: '#fbbf24',
    previewOrbB: '#fb923c',
    previewBorder: 'rgba(252, 211, 77, 0.26)',
    previewButton: '#fef3c7',
    accentSwatch: 'bg-amber-400',
  },
  {
    key: 'velvet',
    label: 'Velours',
    description: 'Prune sombre et éclat carmin',
    canvasColor: '#0a0408',
    previewBg: '#140810',
    previewOrbA: '#fb7185',
    previewOrbB: '#e879f9',
    previewBorder: 'rgba(253, 164, 175, 0.26)',
    previewButton: '#ffe4e6',
    accentSwatch: 'bg-rose-400',
  },
  {
    key: 'graphite',
    label: 'Brume',
    description: 'Ardoise minérale et cristal clair',
    canvasColor: '#0e131b',
    previewBg: '#151d29',
    previewOrbA: '#e2e8f0',
    previewOrbB: '#7dd3fc',
    previewBorder: 'rgba(226, 232, 240, 0.28)',
    previewButton: '#f8fafc',
    accentSwatch: 'bg-slate-300',
  },
];

const APP_THEME_STORAGE_KEY = 'hoi_app_theme_v1';
const APP_THEME_EVENT = 'hoi:app-theme-changed';

export function isValidAppTheme(value: unknown): value is AppThemeKey {
  return APP_THEMES.some((t) => t.key === value);
}

export function getSavedAppTheme(): AppThemeKey {
  if (typeof window === 'undefined') return 'obsidian';
  try {
    const saved = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isValidAppTheme(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage restriction
  }
  return 'obsidian';
}

export function getAppThemeDefinition(theme: AppThemeKey): AppThemeDefinition {
  return APP_THEMES.find((t) => t.key === theme) ?? APP_THEMES[0];
}

export function applyAppTheme(theme: AppThemeKey): void {
  if (typeof document === 'undefined') return;
  const def = getAppThemeDefinition(theme);
  document.documentElement.dataset.appTheme = def.key;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', def.canvasColor);
  }
}

export function setAppThemePreference(theme: AppThemeKey): void {
  applyAppTheme(theme);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage restriction
  }
  window.dispatchEvent(new CustomEvent<AppThemeKey>(APP_THEME_EVENT, { detail: theme }));
}

export function useAppTheme(): [AppThemeKey, (next: AppThemeKey) => void] {
  const [theme, setThemeState] = useState<AppThemeKey>(() => {
    const initial = getSavedAppTheme();
    applyAppTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyAppTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onCustom = (e: Event) => {
      const next = (e as CustomEvent<AppThemeKey>).detail;
      if (isValidAppTheme(next)) {
        setThemeState(next);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === APP_THEME_STORAGE_KEY && isValidAppTheme(e.newValue)) {
        applyAppTheme(e.newValue);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener(APP_THEME_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(APP_THEME_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const updateTheme = useCallback((next: AppThemeKey) => {
    setThemeState(next);
    setAppThemePreference(next);
  }, []);

  return [theme, updateTheme];
}
