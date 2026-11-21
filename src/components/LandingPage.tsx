import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Calculator,
  Clock,
  Download,
  Eye,
  EyeOff,
  Hourglass,
  KeyRound,
  Lock,
  MessageSquareLock,
  Mic,
  Palette,
  Phone,
  Shield,
  ShieldCheck,
  Smartphone,
  Users,
  Video,
  Volume2,
} from 'lucide-react';
import { getBubbleClassNames } from '../lib/bubbleTheme';
import type { BubbleStyleKey } from '../types';
import { AppInstallModal } from './AppInstallModal';
import { ThemeBackdrop } from './ThemeBackdrop';
import { ThemeSwitcherButton } from './ThemePicker';

interface LandingPageProps {
  isAuthenticated: boolean;
  onOpenAuth: (mode: 'login' | 'create') => void;
  onReturnToWorkspace?: () => void;
}

type CapabilityCategory = 'all' | 'privacy' | 'messaging' | 'media';

interface CapabilityItem {
  number: string;
  category: Exclude<CapabilityCategory, 'all'>;
  title: string;
  spec: string;
  description: string;
  spanWide?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const CAPABILITIES: CapabilityItem[] = [
  {
    number: '01',
    category: 'messaging',
    title: 'Messagerie E2EE & Encre invisible',
    spec: 'ECDH P-256 · AES-256-GCM · Voile 8 s au toucher',
    description:
      'Chaque message texte, image ou GIF animé est chiffré sur votre appareil et signé par ECDSA. Activez l’encre invisible pour dissimuler le contenu derrière un voile cristallin qui ne se révèle que 8 secondes au toucher.',
    spanWide: true,
    icon: EyeOff,
  },
  {
    number: '02',
    category: 'privacy',
    title: 'Capsules temporelles & messages éphémères',
    spec: 'Déverrouillage programmé · Auto-destruction 30s à 24h',
    description:
      'Verrouillez un message dans le futur (+1 min, +15 min, Demain 09h ou date exacte) avec compte à rebours en direct, ou programmez sa disparition automatique dès la fin du délai.',
    icon: Hourglass,
  },
  {
    number: '03',
    category: 'media',
    title: 'Notes vocales chiffrées & « Voix anonyme »',
    spec: 'Modulation locale OfflineAudioContext · Lecteur à onde',
    description:
      'Enregistrez des mémos vocaux chiffrés avec barre d’onde interactive (1× / 1.5×). En un geste, activez le modulateur Voix anonyme pour transformer votre timbre localement avant le chiffrement.',
    icon: Mic,
  },
  {
    number: '04',
    category: 'privacy',
    title: 'Bouclier anti-épaule & Mode camouflage',
    spec: 'Flou sélectif (Alt+V) · Calculatrice à code secret',
    description:
      'Floutez instantanément aperçus et bulles dans les transports, ou basculez en une seconde sur une véritable Calculatrice & Bloc-notes dont seul votre code secret suivi de = permet de sortir.',
    spanWide: true,
    icon: Calculator,
  },
  {
    number: '05',
    category: 'media',
    title: 'Appels audio et vidéo P2P avec bulle déplaçable',
    spec: 'WebRTC DTLS-SRTP · Signalisation WebSocket · Partage d’écran',
    description:
      'Passez des appels vocaux et vidéo chiffrés directement entre navigateurs avec changement de caméra, partage d’écran, télémétrie réseau et bulle réduite librement déplaçable.',
    spanWide: true,
    icon: Phone,
  },
  {
    number: '06',
    category: 'messaging',
    title: 'Groupes chiffrés, galerie médias & coffre personnel',
    spec: 'Clé AES enveloppée · Pseudonyme unique · Galerie en mémoire',
    description:
      'Créez des salons privés avec bannière et avatar personnalisés, attribuez des surnoms privés à vos contacts, retrouvez tous vos médias partagés et masquez les fils de votre accueil.',
    icon: Users,
  },
  {
    number: '07',
    category: 'media',
    title: 'Synthèse vocale locale & Notifications discrètes',
    spec: 'Web Speech API · Web Push VAPID · Mode Discret',
    description:
      'Écoutez vos messages déchiffrés sur votre appareil (0.85× à 1.4×) et recevez des alertes Push temps réel sans exposer ni l’expéditeur ni le contenu sur l’écran verrouillé.',
    icon: BellRing,
  },
  {
    number: '08',
    category: 'privacy',
    title: 'Thèmes animés Liquid Glass & PWA Huawei / Mobile',
    spec: 'Boréal · Prisme · Nébuleuse · Braise · HarmonyOS & iOS',
    description:
      'Choisissez parmi dix ambiances dont quatre thèmes animés en temps réel, personnalisez vos bulles et installez HOI sur Huawei (HarmonyOS), Android, iOS, macOS ou Windows.',
    spanWide: true,
    icon: Palette,
  },
];

const FILTER_TABS: { id: CapabilityCategory; label: string }[] = [
  { id: 'all', label: 'Toutes les fonctions' },
  { id: 'privacy', label: 'Discrétion & Secrets' },
  { id: 'messaging', label: 'Messagerie & Groupes' },
  { id: 'media', label: 'Voix, Appels & PWA' },
];

const PREVIEW_STYLES: { key: BubbleStyleKey; label: string }[] = [
  { key: 'glass', label: 'Verre fumé' },
  { key: 'elevated', label: 'Relief' },
  { key: 'outline', label: 'Contour' },
];

const VOICE_RATES = [0.85, 1, 1.15, 1.4] as const;

export const LandingPage: React.FC<LandingPageProps> = ({
  isAuthenticated,
  onOpenAuth,
  onReturnToWorkspace,
}) => {
  const [activeCategory, setActiveCategory] = useState<CapabilityCategory>('all');
  const [installModalOpen, setInstallModalOpen] = useState(false);

  // Interactive Liquid Glass showcase controls inside Hero & Media sections
  const [previewStyle, setPreviewStyle] = useState<BubbleStyleKey>('glass');
  const [inspectCipher, setInspectCipher] = useState(false);
  const [heroInkRevealed, setHeroInkRevealed] = useState(false);
  const [heroShoulderShield, setHeroShoulderShield] = useState(false);
  const [demoVoiceRate, setDemoVoiceRate] = useState<(typeof VOICE_RATES)[number]>(1);
  const [demoMuted, setDemoMuted] = useState(false);
  const [demoAnonVoice, setDemoAnonVoice] = useState(true);

  const visibleCapabilities = useMemo(() => {
    if (activeCategory === 'all') return CAPABILITIES;
    return CAPABILITIES.filter((item) => item.category === activeCategory);
  }, [activeCategory]);

  const handlePrimaryCta = () => {
    if (isAuthenticated && onReturnToWorkspace) {
      onReturnToWorkspace();
    } else {
      onOpenAuth('create');
    }
  };

  const receivedBubbleClass = getBubbleClassNames({
    isMine: false,
    bubbleShape: 'editorial',
    bubbleStyle: previewStyle,
    accentTone: 'emerald',
  });

  const sentBubbleClass = getBubbleClassNames({
    isMine: true,
    bubbleShape: 'editorial',
    bubbleStyle: previewStyle,
    accentTone: 'emerald',
  });

  return (
    <div
      id="top"
      className="app-canvas relative min-h-screen w-full overflow-x-hidden flex flex-col"
    >
      {/* Multi-layered themed liquid ambient field */}
      <ThemeBackdrop />

      {/* Top Bar Contract: exactly 3 zones (Brand — 4 Nav Links — 1 Primary Action) */}
      <header className="glass-liquid sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto max-w-[1200px] h-16 px-4 sm:px-8 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            HOI
          </a>

          <nav
            aria-label="Navigation de présentation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
          >
            <a
              href="#capacites"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              Capacités
            </a>
            <a
              href="#cryptographie"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              Cryptographie
            </a>
            <a
              href="#voix"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              Voix &amp; Appels
            </a>
            <a
              href="#application"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              Application
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            {isAuthenticated && onReturnToWorkspace ? (
              <button
                type="button"
                onClick={onReturnToWorkspace}
                className="btn-specular min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                Retour à la messagerie
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="btn-specular min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                Accéder au coffre
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* Hero Section: Editorial Proposition + Interactive Liquid Glass Interface Preview */}
        <section className="mx-auto max-w-[1200px] px-4 sm:px-8 pt-12 pb-16 sm:pt-20 sm:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6">
              <p className="text-xs text-zinc-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span>Zéro compte Google</span>
                <span aria-hidden="true">·</span>
                <span>Encre invisible &amp; capsules</span>
                <span aria-hidden="true">·</span>
                <span>Chiffrement Web Crypto API</span>
              </p>

              <h1
                className="mt-4 font-[family-name:var(--font-display)] font-semibold tracking-tight text-white leading-[1.08] text-balance"
                style={{ fontSize: 'clamp(2.2rem, 3.9vw, 3.55rem)' }}
              >
                La messagerie souveraine pensée pour l’intimité absolue.
              </h1>

              <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-zinc-400">
                Échangez messages, images, GIF et notes vocales à voix anonymisée en tête-à-tête ou en groupe privé. Protégez vos secrets avec l’encre invisible, les capsules temporelles, le bouclier anti-épaule et le mode camouflage calculatrice.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={handlePrimaryCta}
                  className="btn-specular min-h-[44px] inline-flex items-center gap-2.5 rounded-xl px-6 py-3 text-sm font-medium whitespace-nowrap cursor-pointer"
                >
                  <span>
                    {isAuthenticated ? 'Ouvrir ma messagerie' : 'Créer ma clé unique'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>J’ai déjà une clé d’accès</span>
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Liquid Glass Workspace Showcase */}
            <div className="lg:col-span-6">
              <div className="relative glass-liquid rounded-3xl p-4 sm:p-5 overflow-hidden">
                {/* Subtle refractive light behind preview bubbles */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                >
                  <div className="absolute -top-12 -right-10 h-44 w-56 rounded-full bg-emerald-400/[0.11] blur-3xl" />
                  <div className="absolute -bottom-14 -left-10 h-44 w-56 rounded-full bg-sky-300/[0.1] blur-3xl" />
                </div>

                {/* Floating Glass Window Header */}
                <div className="relative z-10 flex items-center justify-between gap-2 rounded-2xl glass-surface px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white truncate">
                      Sora
                    </p>
                    <p className="font-mono text-[11px] text-zinc-400 truncate">
                      @sora#8f2a · Canal ECDH P-256
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setHeroShoulderShield((v) => !v)}
                      title="Tester le bouclier anti-épaule"
                      className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer border ${
                        heroShoulderShield
                          ? 'glass-control-active text-emerald-300'
                          : 'glass-control text-zinc-300 hover:text-white'
                      }`}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Anti-épaule</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectCipher((v) => !v)}
                      className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer border ${
                        inspectCipher
                          ? 'glass-control-active text-emerald-300'
                          : 'glass-control text-zinc-200 hover:text-white'
                      }`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{inspectCipher ? 'Clair' : 'AES'}</span>
                    </button>
                  </div>
                </div>

                {/* Live Refraction Bubble Stream */}
                <div className="relative z-10 py-5 px-1 space-y-3">
                  <div className="group flex justify-start">
                    <div
                      className={`max-w-[85%] px-4 py-2.5 transition-all ${receivedBubbleClass}`}
                    >
                      <div className={heroShoulderShield ? 'shoulder-shield-blur' : undefined}>
                        <p className="text-[13px] sm:text-sm leading-relaxed">
                          {inspectCipher
                            ? 'g7Kp+8wR2xL9vQ3mN0tY4bZ1cH6jF5sD=='
                            : 'Clé éphémère prête. Le canal reste uniquement sur nos appareils.'}
                        </p>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-zinc-400 tabular-nums">
                        {inspectCipher ? 'IV 9f3c...a410 · ECDSA vérifié' : '22:17'}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Invisible Ink Demo Bubble */}
                  <div className="group flex justify-end">
                    <div
                      className={`max-w-[85%] px-4 py-2.5 transition-all ${sentBubbleClass}`}
                    >
                      {inspectCipher ? (
                        <p className="text-[13px] sm:text-sm leading-relaxed font-mono">
                          X4mQ9pL2vN8rK1wT6yB3cZ7hJ0sF4dA==
                        </p>
                      ) : !heroInkRevealed ? (
                        <button
                          type="button"
                          onClick={() => setHeroInkRevealed(true)}
                          className="invisible-ink-shimmer flex w-full items-center gap-2.5 rounded-xl border border-white/15 px-3 py-2 text-left cursor-pointer"
                        >
                          <EyeOff className="h-4 w-4 text-zinc-200 shrink-0" />
                          <div className="min-w-0">
                            <span className="block text-xs font-medium text-white">
                              Encre invisible
                            </span>
                            <span className="block text-[11px] text-zinc-300">
                              Touchez pour tester la révélation
                            </span>
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setHeroInkRevealed(false)}
                          className={`text-left cursor-pointer ${
                            heroShoulderShield ? 'shoulder-shield-blur' : ''
                          }`}
                        >
                          <p className="text-[13px] sm:text-sm leading-relaxed">
                            Code du coffre : 4820. Re-voiler d’un toucher.
                          </p>
                        </button>
                      )}
                      <p className="mt-1 font-mono text-[10px] text-zinc-200/80 text-right tabular-nums">
                        {inspectCipher ? 'AES-256-GCM · Lu' : '22:18 · Encre invisible'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Interactive Bubble Style & Theme Switcher */}
                <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ThemeSwitcherButton variant="icon" align="left" direction="up" />
                    <span className="text-[11px] font-medium text-zinc-400 whitespace-nowrap">
                      Bulles &amp; thème
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {PREVIEW_STYLES.map((opt) => {
                      const active = previewStyle === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setPreviewStyle(opt.key)}
                          className={`min-h-[30px] rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer border ${
                            active
                              ? 'glass-control-active text-white'
                              : 'border-transparent text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Proof Strip */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 glass-surface rounded-2xl divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08]">
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xl sm:text-2xl font-semibold text-white tabular-nums">
                120 bits
              </p>
              <p className="mt-1.5 text-xs text-zinc-400">
                Entropie générée localement pour chaque clé unique
              </p>
            </div>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xl sm:text-2xl font-semibold text-white tabular-nums">
                250 000
              </p>
              <p className="mt-1.5 text-xs text-zinc-400">
                Itérations PBKDF2-SHA256 pour déverrouiller le coffre
              </p>
            </div>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xl sm:text-2xl font-semibold text-white tabular-nums">
                AES-256-GCM
              </p>
              <p className="mt-1.5 text-xs text-zinc-400">
                Textes, images, GIF, capsules et vocaux chiffrés
              </p>
            </div>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xl sm:text-2xl font-semibold text-white tabular-nums">
                10 thèmes
              </p>
              <p className="mt-1.5 text-xs text-zinc-400">
                Dont 4 ambiances animées Liquid Glass en temps réel
              </p>
            </div>
          </div>
        </section>

        {/* Capabilities Bento Showcase */}
        <section
          id="capacites"
          className="scroll-mt-20 border-t border-white/[0.07] py-16 sm:py-24"
        >
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <div className="max-w-2xl">
                <p className="text-xs font-medium text-emerald-400">
                  Inventaire complet des fonctionnalités
                </p>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-4xl font-semibold tracking-tight text-white text-balance">
                  Tout ce que HOI permet de faire au quotidien.
                </h2>
                <p className="mt-3 text-sm sm:text-base leading-relaxed text-zinc-400">
                  Chaque outil de l’espace de discussion fonctionne sans serveur de déchiffrement central : vos textes, vocaux anonymisés, capsules, médias, appels et thèmes restent sous votre contrôle.
                </p>
              </div>

              {/* Interactive Category Filter Controls */}
              <div
                role="tablist"
                aria-label="Filtrer les fonctionnalités"
                className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-black/30 p-1 self-start lg:self-auto shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
              >
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap cursor-pointer border ${
                      activeCategory === tab.id
                        ? 'glass-control-active text-white'
                        : 'border-transparent text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              key={activeCategory}
              className="animate-tab-enter mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4"
            >
              {visibleCapabilities.map((item) => {
                const Icon = item.icon;
                const useWide = activeCategory === 'all' && item.spanWide;
                return (
                  <article
                    key={item.number}
                    className={`glass-surface glass-interactive rounded-2xl p-6 sm:p-7 flex flex-col justify-between ${
                      useWide ? 'lg:col-span-2' : 'lg:col-span-1'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-xs text-zinc-500 tabular-nums">
                          {item.number}.
                        </span>
                        <Icon className="h-4 w-4 text-zinc-400 shrink-0" />
                      </div>

                      <h3 className="mt-4 font-[family-name:var(--font-display)] text-lg sm:text-xl font-semibold text-white">
                        {item.title}
                      </h3>

                      <p className="mt-2.5 text-sm leading-relaxed text-zinc-400 max-w-[68ch]">
                        {item.description}
                      </p>
                    </div>

                    <p className="mt-6 pt-4 border-t border-white/[0.07] font-mono text-xs text-zinc-400">
                      {item.spec}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Cryptographic Architecture Split */}
        <section
          id="cryptographie"
          className="scroll-mt-20 border-t border-white/[0.07] py-16 sm:py-24"
        >
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-emerald-400">
                Souveraineté et discrétion de terrain
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-4xl font-semibold tracking-tight text-white text-balance">
                Une clé unique à la place des comptes Google, e-mails et mots de passe.
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-zinc-400">
                À la création de votre espace, votre navigateur génère localement une clé unique au format <span className="font-mono text-zinc-200">HOI-XXXX-...</span> ainsi que vos paires de clés ECDH et ECDSA P-256.
              </p>

              <div className="mt-8 divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Persistance chiffrée et réimportation instantanée
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Vos clés privées restent protégées dans IndexedDB sous clé non-extractible, et vous pouvez restaurer votre accès d’un simple clic en réimportant votre fichier <span className="font-mono text-zinc-300">.txt</span>.
                  </p>
                </div>
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Mode camouflage à code secret personnalisable
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Basculez en un instant sur une Calculatrice &amp; Notes neutre sans bouton de sortie visible : seule votre combinaison secrète suivie de <span className="font-mono text-zinc-200">=</span> ramène l’application.
                  </p>
                </div>
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Encre invisible, capsules et inspecteur AES
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Les métadonnées de voile invisible et d’heure de déverrouillage sont chiffrées à l’intérieur même de la charge AES-256-GCM sans jamais être lisibles côté serveur.
                  </p>
                </div>
              </div>
            </div>

            {/* Liquid Glass Cryptographic Pipeline Card */}
            <div className="lg:col-span-6 flex">
              <div className="relative glass-liquid w-full rounded-3xl p-6 sm:p-8 flex flex-col justify-between overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-sky-300/[0.08] blur-3xl"
                />
                <div className="relative z-10 flex items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl glass-control flex items-center justify-center text-emerald-300">
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
                        Architecture du coffre local
                      </p>
                      <p className="text-xs text-zinc-400">
                        Exécutée exclusivement dans votre navigateur
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-300 whitespace-nowrap">
                    Web Crypto API
                  </span>
                </div>

                <div className="relative z-10 my-6 divide-y divide-white/[0.07]">
                  <div className="py-4 first:pt-0 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">
                        01. Dérivation de la clé maître
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Entropie CSPRNG 120 bits → déverrouillage PBKDF2-SHA256
                      </p>
                    </div>
                    <span className="font-mono text-xs text-zinc-200 tabular-nums shrink-0">
                      250 000 itér.
                    </span>
                  </div>

                  <div className="py-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">
                        02. Enveloppe asymétrique P-256
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Secret partagé ECDH par discussion et signature ECDSA par message
                      </p>
                    </div>
                    <span className="font-mono text-xs text-zinc-200 shrink-0">
                      NIST P-256
                    </span>
                  </div>

                  <div className="py-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">
                        03. Médias, vocaux anonymisés &amp; capsules
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Textes, GIF, audio modulé et verrous temporels chiffrés en AES-256-GCM
                      </p>
                    </div>
                    <span className="font-mono text-xs text-emerald-300 shrink-0">
                      AES-256-GCM
                    </span>
                  </div>

                  <div className="py-4 last:pb-0 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">
                        04. Persistance navigateur protégée
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Coffre chiffré sous clé non-extractible dans IndexedDB
                      </p>
                    </div>
                    <span className="font-mono text-xs text-zinc-200 shrink-0">
                      Zéro clair
                    </span>
                  </div>
                </div>

                <div className="relative z-10 rounded-2xl border border-white/[0.08] bg-black/35 px-4 py-3 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-zinc-400 truncate">
                    HOI-9F4K-2M8Q-7X1P-6R5T-...
                  </span>
                  <span className="text-[11px] font-medium text-zinc-300 whitespace-nowrap shrink-0">
                    Clé souveraine locale
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3-Step Quick Onboarding Strip */}
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 mt-12">
            <div className="grid grid-cols-1 md:grid-cols-3 glass-surface rounded-2xl divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 1
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Générez votre clé 120 bits
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Choisissez un pseudonyme unique : votre coffre et vos clés P-256 sont créés localement en moins d’une seconde.
                </p>
              </div>
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 2
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Ajoutez vos proches
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Retrouvez vos contacts par leur identifiant unique <span className="font-mono text-zinc-300">@pseudo#hash</span> ou créez un groupe privé chiffré.
                </p>
              </div>
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 3
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Communiquez sans trace
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Encre invisible, capsules temporelles, vocaux anonymisés, appels WebRTC, thèmes animés et mode camouflage.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Real-Time Calls, Voice & PWA Split */}
        <section
          id="voix"
          className="scroll-mt-20 border-t border-white/[0.07] py-16 sm:py-24"
        >
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 order-2 lg:order-1 flex">
              <div className="relative glass-liquid w-full rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-6 overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-16 -left-12 h-56 w-56 rounded-full bg-emerald-400/[0.09] blur-3xl"
                />

                {/* Simulated Draggable Liquid Glass Call Bubble */}
                <div className="relative z-10 glass-surface rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-center py-1.5 border-b border-white/[0.06] bg-white/[0.03]">
                    <span className="h-1 w-8 rounded-full bg-white/25" />
                  </div>
                  <div className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        Kael_07 · Appel vidéo P2P
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-emerald-400 tabular-nums">
                        04:12 · DTLS-SRTP vérifié
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDemoMuted((v) => !v)}
                        aria-label={demoMuted ? 'Réactiver le micro' : 'Couper le micro'}
                        className={`h-9 w-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer border ${
                          demoMuted
                            ? 'border-red-500/35 bg-red-500/20 text-red-200'
                            : 'glass-control text-zinc-100'
                        }`}
                      >
                        <Mic className="h-4 w-4" />
                      </button>
                      <span className="h-9 w-9 flex items-center justify-center rounded-xl glass-control text-zinc-100">
                        <Video className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Interactive Anonymous Voice Note Preview */}
                <div className="relative z-10 glass-surface rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                      <Shield className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Modulateur « Voix anonyme »</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDemoAnonVoice((v) => !v)}
                      className={`min-h-[30px] rounded-lg px-2.5 text-[11px] font-medium transition-all cursor-pointer border ${
                        demoAnonVoice
                          ? 'glass-control-active text-emerald-300'
                          : 'glass-control text-zinc-400'
                      }`}
                    >
                      {demoAnonVoice ? 'Timbre modifié' : 'Voix naturelle'}
                    </button>
                  </div>

                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {demoAnonVoice
                      ? 'La hauteur et les fréquences vocales sont transformées localement sur votre appareil avant le chiffrement AES-256-GCM.'
                      : 'Votre enregistrement audio est compressé et chiffré de bout en bout avant envoi.'}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
                    <span className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                      <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Cadence de lecture</span>
                    </span>
                    <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1 border border-white/[0.07]">
                      {VOICE_RATES.map((rate) => {
                        const active = demoVoiceRate === rate;
                        return (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => setDemoVoiceRate(rate)}
                            className={`min-h-[28px] rounded-lg px-2 font-mono text-[11px] font-medium tabular-nums transition-all cursor-pointer border ${
                              active
                                ? 'glass-control-active text-white'
                                : 'border-transparent text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {rate}×
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col justify-center">
              <p className="text-xs font-medium text-emerald-400">
                Temps réel, voix et mobilité
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-4xl font-semibold tracking-tight text-white text-balance">
                Vocaux anonymisés, appels WebRTC, thèmes animés et PWA Huawei.
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-zinc-400">
                Au-delà du texte chiffré, HOI réunit l’audio anonymisé, la vidéo directe, la galerie de médias chiffrés et le confort d’une application installable.
              </p>

              <div className="mt-8 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Notes vocales à voix anonymisée &amp; appels WebRTC
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Envoyez des notes vocales avec barre d’onde interactive et modification locale du timbre, ou lancez un appel audio/vidéo réduit en bulle Liquid Glass déplaçable.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Lecture vocale locale &amp; galerie chiffrée
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Écoutez vos messages par synthèse vocale locale (<span className="font-mono text-zinc-200 tabular-nums">0.85×</span> à <span className="font-mono text-zinc-200 tabular-nums">1.4×</span>) et retrouvez tous les images, GIF et vocaux d’une discussion dans la galerie en mémoire.
                  </p>
                </div>

                <div id="application" className="scroll-mt-24">
                  <h3 className="text-sm font-semibold text-white">
                    Thèmes animés Liquid Glass &amp; installation multi-appareils
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Profitez des ambiances dynamiques Boréal, Prisme, Nébuleuse et Braise, des notifications Push discrètes et de l’installation guidée pour Huawei (HarmonyOS), Android, iOS, macOS et Windows.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final Action Block */}
        <section className="border-t border-white/[0.07] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
            <div className="glass-liquid rounded-3xl p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              <div className="max-w-2xl">
                <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-semibold tracking-tight text-white text-balance">
                  Prêt à communiquer sans laisser de trace en clair ?
                </h2>
                <p className="mt-3 text-sm sm:text-base leading-relaxed text-zinc-400">
                  Générez votre clé unique en quelques secondes ou déverrouillez un coffre existant, puis installez l’application sur votre appareil.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={handlePrimaryCta}
                  className="btn-specular min-h-[44px] inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium whitespace-nowrap cursor-pointer"
                >
                  <span>
                    {isAuthenticated ? 'Retour à la messagerie' : 'Créer ma clé unique'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setInstallModalOpen(true)}
                  className="glass-control min-h-[44px] inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-zinc-200 hover:text-white whitespace-nowrap cursor-pointer"
                >
                  <Smartphone className="h-4 w-4" />
                  <span>Installer l’app</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 border-t border-white/[0.07] py-8">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-[family-name:var(--font-display)] font-semibold text-zinc-300">
              HOI
            </span>
            <span aria-hidden="true">·</span>
            <span>Web Crypto API · WebRTC DTLS-SRTP · Web Audio &amp; Speech</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <ThemeSwitcherButton variant="labeled" align="right" direction="up" />
            <button
              type="button"
              onClick={() => setInstallModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Installer l’application</span>
            </button>
            {isAuthenticated && onReturnToWorkspace ? (
              <button
                type="button"
                onClick={onReturnToWorkspace}
                className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Ouvrir la messagerie</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Connexion par clé</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      <AppInstallModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
      />
    </div>
  );
};
