import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Laptop,
  Share,
  Share2,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { type InstallPlatform, usePWAInstall } from '../hooks/usePWAInstall';

interface AppInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppInstallModal: React.FC<AppInstallModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, isInstalled, platform, install } = usePWAInstall();
  const [selectedTab, setSelectedTab] = useState<InstallPlatform>(platform);
  const [installedNow, setInstalledNow] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedTab(platform);
    }
  }, [isOpen, platform]);

  if (!isOpen) return null;

  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : '';

  async function handleNativeInstall() {
    const ok = await install();
    if (ok) {
      setInstalledNow(true);
    }
  }

  async function handleCopyUrl() {
    if (!appUrl) return;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  }

  async function handleShareApp() {
    if (!appUrl) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'HOI — Messagerie Privée Chiffrée',
          text: 'Ouvrez et installez HOI (compatible Huawei HarmonyOS, Android, iOS et ordinateur) :',
          url: appUrl,
        });
        return;
      } catch {
        // Fallback to copying link if user cancelled or share unavailable
      }
    }
    await handleCopyUrl();
  }

  return (
    <div
      className="animate-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="glass-liquid animate-panel-enter w-full max-w-lg rounded-3xl p-6 space-y-5 my-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/hoi-192.png"
              alt="Icône HOI"
              className="h-11 w-11 rounded-2xl border border-white/[0.15] shadow-md shrink-0"
            />
            <div className="min-w-0">
              <h2
                id="install-modal-title"
                className="font-[family-name:var(--font-display)] text-lg font-semibold text-white truncate"
              >
                Installer HOI
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                Bureau, Huawei (HarmonyOS), Android et iPhone
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isInstalled || installedNow ? (
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 flex items-center gap-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>
              HOI est installé sur cet appareil en mode application autonome.
            </span>
          </div>
        ) : (
          <>
            {isInstallable && (
              <div className="glass-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    Installation directe prête
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Lancez HOI dans sa propre fenêtre sans barre de navigateur.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleNativeInstall}
                  className="btn-specular shrink-0 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Installer maintenant</span>
                </button>
              </div>
            )}

            {/* Platform Tabs */}
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1 border border-white/[0.07] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
              <button
                type="button"
                onClick={() => setSelectedTab('desktop')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition-all cursor-pointer border whitespace-nowrap ${
                  selectedTab === 'desktop'
                    ? 'glass-control-active text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Laptop className="h-3.5 w-3.5 shrink-0" />
                <span>Bureau</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('huawei')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition-all cursor-pointer border whitespace-nowrap ${
                  selectedTab === 'huawei'
                    ? 'glass-control-active text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>Huawei</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('android')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition-all cursor-pointer border whitespace-nowrap ${
                  selectedTab === 'android'
                    ? 'glass-control-active text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>Android</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('ios')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-1.5 text-xs font-medium transition-all cursor-pointer border whitespace-nowrap ${
                  selectedTab === 'ios'
                    ? 'glass-control-active text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>iPhone</span>
              </button>
            </div>

            <div key={selectedTab} className="animate-tab-enter space-y-3">
              {selectedTab === 'desktop' && (
                <div className="glass-surface rounded-2xl p-4 space-y-2.5 text-xs text-zinc-300 leading-relaxed">
                  <p className="font-medium text-white">
                    Mac, Windows &amp; Linux (Chrome, Edge, Brave, Arc)
                  </p>
                  <p>
                    1. Ouvrez l’application dans un onglet autonome (hors aperçu intégré si nécessaire).
                  </p>
                  <p>
                    2. Cliquez sur l’icône d’installation dans la barre d’adresse ou dans le menu du navigateur → <span className="text-white font-medium">Installer HOI</span>.
                  </p>
                  <p className="text-zinc-400">
                    HOI apparaît ensuite dans votre Dock / menu Démarrer comme une application native avec support hors-ligne.
                  </p>
                </div>
              )}

              {selectedTab === 'huawei' && (
                <div className="glass-surface rounded-2xl p-4 space-y-3 text-xs text-zinc-300 leading-relaxed">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">
                        Huawei HarmonyOS &amp; EMUI (Navigateur Huawei / Petal)
                      </p>
                      <p className="mt-0.5 text-emerald-300 inline-flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                        <span>100 % autonome sans Google Play Services (GMS)</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-white/[0.07] pt-2.5">
                    <p>
                      1. Ouvrez HOI dans <span className="text-white font-medium">Navigateur Huawei</span> (ou Petal Browser / Edge).
                    </p>
                    <p>
                      2. Appuyez sur le menu <span className="text-white font-medium">☰</span> ou <span className="text-white font-medium">⋮</span> en bas, puis sélectionnez <span className="text-white font-medium">Ajouter à l’écran d’accueil</span> ou <span className="text-white font-medium">Installer l’application</span>.
                    </p>
                    <p className="text-zinc-400">
                      3. Pour garder les appels WebRTC et alertes actifs sous EMUI / HarmonyOS : <span className="text-zinc-200">Paramètres → Batterie → Lancement d’application → Navigateur Huawei</span> → passez en <span className="text-zinc-200">Gérer manuellement</span>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleShareApp}
                      className="btn-specular flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium cursor-pointer"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      <span>Ouvrir / Partager vers Huawei</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="glass-control min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Lien copié</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copier le lien</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {selectedTab === 'android' && (
                <div className="glass-surface rounded-2xl p-4 space-y-2.5 text-xs text-zinc-300 leading-relaxed">
                  <p className="font-medium text-white">
                    Smartphone Android (Chrome / Samsung Internet / Edge)
                  </p>
                  <p>
                    1. Ouvrez le menu <span className="text-white font-medium">⋮</span> en haut à droite du navigateur.
                  </p>
                  <p>
                    2. Appuyez sur <span className="text-white font-medium">Installer l’application</span> ou <span className="text-white font-medium">Ajouter à l’écran d’accueil</span>.
                  </p>
                </div>
              )}

              {selectedTab === 'ios' && (
                <div className="glass-surface rounded-2xl p-4 space-y-2.5 text-xs text-zinc-300 leading-relaxed">
                  <p className="font-medium text-white">
                    iPhone &amp; iPad (Safari)
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span>1. Appuyez sur le bouton</span>
                    <span className="glass-control inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-white">
                      <Share className="h-3 w-3" /> Partager
                    </span>
                    <span>dans la barre Safari.</span>
                  </p>
                  <p>
                    2. Faites défiler et sélectionnez <span className="text-white font-medium">Sur l’écran d’accueil</span>, puis confirmez <span className="text-white font-medium">Ajouter</span>.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="glass-control rounded-xl px-4 py-2 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

interface PWAInstallButtonProps {
  compact?: boolean;
  onOpenModal: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  onOpenModal,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  // Hide when already running in standalone installed mode
  if (isInstalled) {
    return null;
  }

  async function handleClick() {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    onOpenModal();
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title="Installer l'application bureau et téléphone"
        className="glass-control flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:text-white whitespace-nowrap cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" />
        <span>App Bureau &amp; Mobile</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="glass-control w-full flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
    >
      <Download className="h-3.5 w-3.5" />
      <span>Installer sur bureau / téléphone</span>
    </button>
  );
};
