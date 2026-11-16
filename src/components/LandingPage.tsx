import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Clock,
  Download,
  Eye,
  KeyRound,
  Lock,
  MessageSquareLock,
  Phone,
  ShieldCheck,
  Smartphone,
  Users,
  Volume2,
} from 'lucide-react';
import acousticCallImg from '../assets/images/acoustic_call_studio_1794859620583.jpg';
import cryptoKeyImg from '../assets/images/crypto_key_craft_1794859619870.jpg';
import heroVaultImg from '../assets/images/hero_discret_vault_1794859619487.jpg';
import { AppInstallModal } from './AppInstallModal';

interface LandingPageProps {
  isAuthenticated: boolean;
  onOpenAuth: (mode: 'login' | 'create') => void;
  onReturnToWorkspace?: () => void;
}

type CapabilityCategory = 'all' | 'messaging' | 'security' | 'media';

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
    title: 'Messagerie directe chiffrée de bout en bout',
    spec: 'ECDH P-256 · AES-256-GCM · Signature ECDSA',
    description:
      'Chaque message est chiffré sur votre appareil avec un secret partagé ECDH P-256, un vecteur d’initialisation unique et une signature numérique vérifiée à la réception. Accusés de lecture en direct, indicateur de saisie et suppression définitive pour tous inclus.',
    spanWide: true,
    icon: MessageSquareLock,
  },
  {
    number: '02',
    category: 'security',
    title: 'Messages éphémères auto-destructeurs',
    spec: 'Permanent · 30 sec · 5 min · 24 h',
    description:
      'Définissez une durée de vie avant l’envoi. Un compte à rebours s’affiche en temps réel sur chaque bulle puis le message est purgé automatiquement à l’échéance.',
    icon: Clock,
  },
  {
    number: '03',
    category: 'messaging',
    title: 'Groupes privés chiffrés et inspecteur brut',
    spec: 'Clé AES de groupe enveloppée par membre',
    description:
      'Créez des salons privés où la clé symétrique du groupe est protégée individuellement pour chaque participant. Activez le mode inspecteur pour vérifier le texte chiffré et l’IV exacts transmis.',
    icon: Users,
  },
  {
    number: '04',
    category: 'security',
    title: 'Coffre personnel, amis et vérification d’empreinte',
    spec: 'Notes privées · Blocage · Empreinte SHA-256',
    description:
      'Conservez des notes personnelles chiffrées dans votre coffre privé, gérez vos contacts par identifiant @pseudo#hash, bloquez tout utilisateur indésirable et comparez vos empreintes cryptographiques.',
    spanWide: true,
    icon: ShieldCheck,
  },
  {
    number: '05',
    category: 'media',
    title: 'Appels audio et vidéo pair-à-pair en temps réel',
    spec: 'WebRTC DTLS-SRTP · Signalisation WebSocket',
    description:
      'Passez des appels vocaux et vidéo directement entre navigateurs sans intermédiaire média, avec contrôle instantané du micro, de la caméra et affichage plein écran.',
    spanWide: true,
    icon: Phone,
  },
  {
    number: '06',
    category: 'media',
    title: 'Synthèse vocale locale des messages chiffrés',
    spec: 'Web Speech API · Zéro envoi serveur · 0.85× à 1.4×',
    description:
      'Écoutez vos messages déchiffrés en mémoire directement sur votre appareil. Activez la lecture automatique des nouveaux messages reçus et ajustez la cadence de lecture.',
    icon: Volume2,
  },
  {
    number: '07',
    category: 'media',
    title: 'Notifications Push discrètes et mode hors-ligne',
    spec: 'Web Push VAPID · Mode Discret · PWA installable',
    description:
      'Recevez des alertes même lorsque l’application est fermée, tout en masquant le nom et le contenu grâce au mode discret. Installez DISCRET sur ordinateur et mobile.',
    icon: BellRing,
  },
  {
    number: '08',
    category: 'security',
    title: 'Identité sans compte tiers et persistance protégée',
    spec: 'Clé 120 bits · IndexedDB non-extractible',
    description:
      'Aucune adresse e-mail, aucun compte Google et aucun numéro requis. Votre session reste ouverte de façon chiffrée dans le navigateur pour ne pas ressaisir votre clé à chaque visite.',
    spanWide: true,
    icon: KeyRound,
  },
];

const FILTER_TABS: { id: CapabilityCategory; label: string }[] = [
  { id: 'all', label: 'Toutes les fonctions' },
  { id: 'messaging', label: 'Messagerie & Groupes' },
  { id: 'security', label: 'Sécurité & Clés' },
  { id: 'media', label: 'Appels, Voix & PWA' },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  isAuthenticated,
  onOpenAuth,
  onReturnToWorkspace,
}) => {
  const [activeCategory, setActiveCategory] = useState<CapabilityCategory>('all');
  const [installModalOpen, setInstallModalOpen] = useState(false);

  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [cryptoImgFailed, setCryptoImgFailed] = useState(false);
  const [mediaImgFailed, setMediaImgFailed] = useState(false);

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

  return (
    <div
      id="top"
      className="min-h-screen w-full bg-[#050507] text-[#F4F4F5] flex flex-col"
    >
      {/* Top Bar Contract: exactly 3 zones (Brand — 4 Nav Links — 1 Primary Action) */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#050507]/90 backdrop-blur-xl">
        <div className="mx-auto max-w-[1200px] h-16 px-4 sm:px-8 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            DISCRET
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
              Appels & Voix
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
                className="min-h-[40px] rounded-xl bg-white px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                Retour à la messagerie
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="min-h-[40px] rounded-xl bg-white px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                Accéder au coffre
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-[1200px] px-4 sm:px-8 pt-12 pb-16 sm:pt-20 sm:pb-24">
          <div className="max-w-3xl">
            <p className="text-xs text-zinc-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span>Zéro compte Google</span>
              <span aria-hidden="true">·</span>
              <span>Zéro e-mail</span>
              <span aria-hidden="true">·</span>
              <span>Chiffrement client Web Crypto API</span>
            </p>

            <h1
              className="mt-4 font-[family-name:var(--font-display)] font-semibold tracking-tight text-white leading-[1.08] text-balance"
              style={{ fontSize: 'clamp(2.25rem, 4.2vw, 3.75rem)' }}
            >
              La messagerie souveraine chiffrée de bout en bout, sans aucun compte tiers.
            </h1>

            <p className="mt-5 max-w-[65ch] text-base leading-relaxed text-zinc-400">
              Échangez en tête-à-tête ou en groupe privé, passez des appels audio et vidéo en temps réel, envoyez des messages éphémères et écoutez vos conversations par synthèse vocale locale. Une seule clé cryptographique de 120 bits suffit pour ouvrir et restaurer votre coffre.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={handlePrimaryCta}
                className="min-h-[44px] inline-flex items-center gap-2.5 rounded-xl bg-white px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 transition-colors whitespace-nowrap cursor-pointer"
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

          {/* Dominant 16:9 Focal Visual */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
            <div className="relative aspect-video w-full">
              {!heroImgFailed ? (
                <img
                  src={heroVaultImg}
                  alt="Poste de travail minimaliste dans un environnement sombre et vitré représentant le coffre privé DISCRET"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0e0e14] via-[#09090d] to-[#050507] p-8 text-center">
                  <div className="space-y-2">
                    <Lock className="mx-auto h-8 w-8 text-zinc-400" />
                    <p className="text-sm font-medium text-zinc-300">
                      Coffre de communication chiffré DISCRET
                    </p>
                  </div>
                </div>
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#050507] via-black/25 to-transparent"
              />
              <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-300">
                    Architecture zéro connaissance
                  </p>
                  <p className="mt-1 text-sm sm:text-base font-medium text-white">
                    Vos clés privées ECDH et ECDSA ne quittent jamais votre navigateur en clair.
                  </p>
                </div>
                <span className="font-mono text-xs text-emerald-300 whitespace-nowrap tabular-nums">
                  AES-256-GCM · P-256
                </span>
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Proof Strip */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 border border-white/[0.08] rounded-2xl divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08] bg-white/[0.02]">
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
                Chiffrement authentifié avec IV unique par message
              </p>
            </div>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xl sm:text-2xl font-semibold text-white tabular-nums">
                ECDH / ECDSA
              </p>
              <p className="mt-1.5 text-xs text-zinc-400">
                Échange de secret et signature vérifiée sur courbe P-256
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
                  Tout ce que DISCRET permet de faire au quotidien.
                </h2>
                <p className="mt-3 text-sm sm:text-base leading-relaxed text-zinc-400">
                  Chaque outil de l’espace de discussion fonctionne sans serveur de déchiffrement central : vos textes, groupes, appels et préférences restent sous votre contrôle cryptographique.
                </p>
              </div>

              {/* Interactive Category Filter Controls */}
              <div
                role="tablist"
                aria-label="Filtrer les fonctionnalités"
                className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 self-start lg:self-auto"
              >
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      activeCategory === tab.id
                        ? 'bg-white text-zinc-950'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {visibleCapabilities.map((item) => {
                const Icon = item.icon;
                const useWide = activeCategory === 'all' && item.spanWide;
                return (
                  <article
                    key={item.number}
                    className={`rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 sm:p-7 flex flex-col justify-between transition-colors hover:border-white/[0.16] ${
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

                    <p className="mt-6 pt-4 border-t border-white/[0.06] font-mono text-xs text-zinc-400">
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
                Souveraineté et authentification
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-4xl font-semibold tracking-tight text-white text-balance">
                Une clé unique à la place des comptes Google, e-mails et mots de passe.
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-zinc-400">
                À la création de votre espace, votre navigateur génère localement une clé unique au format <span className="font-mono text-zinc-200">DISCRET-XXXX-...</span> ainsi que vos paires de clés ECDH et ECDSA P-256.
              </p>

              <div className="mt-8 divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Persistance chiffrée sans déconnexion forcée
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Vos clés privées restent mémorisées localement dans un coffre AES-256-GCM protégé par une clé non-extractible stockée dans IndexedDB : vous restez connecté entre les visites et les mises à jour sans exposer vos secrets en clair.
                  </p>
                </div>
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Restauration sur tout autre appareil
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Copiez votre clé ou sauvegardez le fichier <span className="font-mono text-zinc-300">.txt</span> hors-ligne pour retrouver votre profil, vos contacts, vos groupes et tout votre historique déchiffrable instantanément.
                  </p>
                </div>
                <div className="py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Vérification d’identité et inspecteur chiffré
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Comparez l’empreinte SHA-256 de vos interlocuteurs et affichez les paquets bruts AES-256-GCM dans les groupes pour contrôler à tout moment ce qui transite sur le réseau.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
              {!cryptoImgFailed ? (
                <img
                  src={cryptoKeyImg}
                  alt="Clé cryptographique usinée en titane et prisme en verre fumé sur pierre sombre"
                  referrerPolicy="no-referrer"
                  onError={() => setCryptoImgFailed(true)}
                  className="h-full w-full min-h-[280px] object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-gradient-to-br from-[#101016] to-[#060609] p-8">
                  <KeyRound className="h-10 w-10 text-zinc-400" />
                </div>
              )}
            </div>
          </div>

          {/* 3-Step Quick Onboarding Strip */}
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 mt-12">
            <div className="grid grid-cols-1 md:grid-cols-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 1
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Générez votre clé 120 bits
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Choisissez un pseudonyme optionnel : votre coffre et vos clés P-256 sont créés localement en moins d’une seconde.
                </p>
              </div>
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 2
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Partagez votre identifiant
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Ajoutez vos proches via leur identifiant unique <span className="font-mono text-zinc-300">@pseudo#hash</span> ou rassemblez-les dans un groupe chiffré.
                </p>
              </div>
              <div className="p-6">
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  Étape 3
                </span>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                  Échangez, appelez, écoutez
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                  Discutez avec messages éphémères, appels audio/vidéo WebRTC, notifications discrètes et synthèse vocale locale.
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
            <div className="lg:col-span-6 order-2 lg:order-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0e]">
              {!mediaImgFailed ? (
                <img
                  src={acousticCallImg}
                  alt="Microphone de studio noir mat et écran minimaliste illustrant les appels temps réel et la synthèse vocale locale"
                  referrerPolicy="no-referrer"
                  onError={() => setMediaImgFailed(true)}
                  className="h-full w-full min-h-[280px] object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-gradient-to-br from-[#101016] to-[#060609] p-8">
                  <Volume2 className="h-10 w-10 text-zinc-400" />
                </div>
              )}
            </div>

            <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col justify-center">
              <p className="text-xs font-medium text-emerald-400">
                Temps réel, accessibilité et mobilité
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-4xl font-semibold tracking-tight text-white text-balance">
                Appels WebRTC, synthèse vocale locale et notifications discrètes.
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-zinc-400">
                Au-delà du texte chiffré, DISCRET réunit l’audio, la vidéo, la lecture vocale sur l’appareil et le confort d’une application installable.
              </p>

              <div className="mt-8 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Appels audio et vidéo directs (WebRTC)
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Lancez un appel vocal ou vidéo depuis n’importe quelle conversation directe. Les flux média sont chiffrés de pair à pair en DTLS-SRTP avec coupure micro/caméra instantanée.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Lecture vocale intégrée (API Web Speech)
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Écoutez chaque message déchiffré d’un clic ou activez la lecture automatique des nouveaux messages entrants. La synthèse reste 100 % locale dans votre navigateur (vitesse réglable de <span className="font-mono text-zinc-200 tabular-nums">0.85×</span> à <span className="font-mono text-zinc-200 tabular-nums">1.4×</span>) et s’interrompt automatiquement dès qu’un appel démarre ou que vous verrouillez le coffre.
                  </p>
                </div>

                <div id="application" className="scroll-mt-24">
                  <h3 className="text-sm font-semibold text-white">
                    Personnalisation, Push discret et installation PWA
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                    Personnalisez votre pseudonyme, biographie, avatar, bannière, teinte des bulles et transparence du verre fumé. Activez les notifications Push Web avec option Mode Discret, et installez DISCRET comme application dédiée sur Android, iOS, macOS ou Windows.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final Action Block */}
        <section className="border-t border-white/[0.07] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
            <div className="rounded-2xl border border-white/[0.1] bg-white/[0.03] p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
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
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>
                    {isAuthenticated ? 'Retour à la messagerie' : 'Créer ma clé unique'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setInstallModalOpen(true)}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-medium text-zinc-200 hover:bg-white/[0.09] transition-colors whitespace-nowrap cursor-pointer"
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
      <footer className="border-t border-white/[0.07] py-8">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-[family-name:var(--font-display)] font-semibold text-zinc-300">
              DISCRET
            </span>
            <span aria-hidden="true">·</span>
            <span>Web Crypto API · WebRTC DTLS-SRTP · Web Speech API</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
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
                <Eye className="h-3.5 w-3.5" />
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
