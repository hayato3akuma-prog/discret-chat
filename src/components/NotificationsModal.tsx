import React from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  EyeOff,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  supported: boolean;
  inIframe: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  discreetMode: boolean;
  loading: boolean;
  testing: boolean;
  error: string | null;
  statusMessage: string | null;
  onEnable: () => Promise<boolean>;
  onDisable: () => Promise<boolean>;
  onToggleDiscreetMode: () => Promise<void>;
  onSendTest: () => Promise<void>;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  supported,
  inIframe,
  permission,
  isSubscribed,
  discreetMode,
  loading,
  testing,
  error,
  statusMessage,
  onEnable,
  onDisable,
  onToggleDiscreetMode,
  onSendTest,
}) => {
  if (!isOpen) return null;

  const isActive = supported && permission === 'granted' && isSubscribed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notifications-modal-title"
    >
      <div className="glass-liquid w-full max-w-lg rounded-3xl p-6 space-y-5 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isActive ? (
              <BellRing className="h-5 w-5 text-emerald-400" />
            ) : (
              <Bell className="h-5 w-5 text-zinc-200" />
            )}
            <h2
              id="notifications-modal-title"
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
            >
              Notifications Push
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-400">
          Recevez des alertes en temps réel via le Service Worker lorsqu’un nouveau message chiffré, un message de groupe ou une demande d’ami arrive — même lorsque HOI est en arrière-plan ou fermé.
        </p>

        {/* Current status card */}
        <div className="glass-surface rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {isActive ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : permission === 'denied' || !supported ? (
                <BellOff className="h-4 w-4 text-red-400 shrink-0" />
              ) : (
                <Bell className="h-4 w-4 text-amber-300 shrink-0" />
              )}
              <div>
                <p className="text-xs font-medium text-white">
                  {!supported
                    ? 'Non supportées sur ce navigateur'
                    : permission === 'denied'
                      ? 'Autorisation bloquée par le navigateur'
                      : isActive
                        ? 'Notifications push actives sur cet appareil'
                        : 'Notifications push inactives'}
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {!supported
                    ? 'Sur iPhone/iPad, installez d’abord HOI sur l’écran d’accueil (iOS 16.4+).'
                    : permission === 'denied'
                      ? 'Réautorisez les notifications dans les réglages du site de votre navigateur.'
                      : isActive
                        ? 'Protocole Web Push VAPID chiffré actif.'
                        : 'Activez les alertes pour être prévenu en arrière-plan.'}
                </p>
              </div>
            </div>
          </div>

          {supported && permission !== 'denied' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isActive ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onEnable()}
                  className="btn-specular flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50 cursor-pointer"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  <span>
                    {loading ? 'Activation...' : 'Activer les notifications push'}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void onSendTest()}
                    className="btn-specular flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{testing ? 'Envoi...' : 'Tester une notification'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void onDisable()}
                    className="glass-control flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium text-zinc-200 hover:text-white disabled:opacity-50 cursor-pointer"
                  >
                    <BellOff className="h-3.5 w-3.5" />
                    <span>{loading ? 'Désactivation...' : 'Désactiver'}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Discreet preview toggle */}
        <div className="glass-surface flex items-center justify-between rounded-2xl px-4 py-3.5">
          <div className="flex items-center gap-2.5 pr-4">
            <EyeOff className="h-4 w-4 text-zinc-300 shrink-0" />
            <div>
              <p className="text-xs font-medium text-white">
                Mode discret sur l’écran verrouillé
              </p>
              <p className="text-[11px] text-zinc-500">
                Masquer le nom de l’expéditeur et du groupe dans les alertes système
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={discreetMode}
            onClick={() => void onToggleDiscreetMode()}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors ${
              discreetMode
                ? 'border-emerald-500/50 bg-emerald-500/30'
                : 'border-white/15 bg-white/10'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                discreetMode ? 'translate-x-5' : 'translate-x-0.5'
              } mt-[1px]`}
            />
          </button>
        </div>

        {/* Zero-knowledge privacy note */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-zinc-300">
            <span className="font-medium text-white">Confidentialité de bout en bout préservée :</span>{' '}
            le texte de vos messages n’est jamais transmis dans les payloads push. Le contenu reste chiffré et se déchiffre uniquement dans votre navigateur à l’ouverture.
          </p>
        </div>

        {inIframe && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-[11px] leading-relaxed text-amber-200">
            Aperçu intégré détecté : certains navigateurs bloquent les demandes de permission push dans un iframe. Ouvrez l’application dans un onglet dédié ou installez-la en tant qu’application autonome si le bouton est bloqué.
          </div>
        )}

        {statusMessage && (
          <p className="text-xs text-emerald-400">{statusMessage}</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

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
