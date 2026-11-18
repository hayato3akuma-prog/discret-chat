import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Eye, X } from 'lucide-react';
import { computeConversationSafetyNumber } from '../lib/crypto';
import type { PublicUser } from '../types';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser;
  peer: PublicUser | null;
  inspectorMode: boolean;
  onToggleInspector: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  peer,
  inspectorMode,
  onToggleInspector,
}) => {
  const [safetyNumber, setSafetyNumber] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const target = peer ?? currentUser;
    computeConversationSafetyNumber(currentUser.fingerprint, target.fingerprint)
      .then(setSafetyNumber)
      .catch(() => setSafetyNumber(''));
  }, [isOpen, currentUser, peer]);

  if (!isOpen) return null;

  const targetPeer = peer ?? currentUser;
  const isSelf = targetPeer.id === currentUser.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-modal-title"
    >
      <div className="glass-liquid w-full max-w-lg rounded-3xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h2
              id="security-modal-title"
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-white"
            >
              Vérification cryptographique
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="glass-control rounded-xl p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-400">
          Les messages échangés {isSelf ? 'dans votre coffre personnel' : `avec ${targetPeer.displayName}`} sont chiffrés localement avant tout envoi réseau. Le serveur relais ne possède jamais les clés privées.
        </p>

        {/* Safety number */}
        <div className="glass-surface rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Numéro de sécurité de la session</span>
            <span className="font-mono text-emerald-400">ECDH P-256</span>
          </div>
          <div className="font-mono text-sm sm:text-base tracking-widest text-white tabular-nums">
            {safetyNumber || 'Calcul en cours...'}
          </div>
          <p className="text-[11px] text-zinc-500">
            Comparez ce code avec votre interlocuteur pour garantir l’absence d’interception.
          </p>
        </div>

        {/* Fingerprints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="glass-surface rounded-2xl p-3.5">
            <p className="text-xs text-zinc-400">Votre empreinte ({currentUser.handle})</p>
            <p className="mt-1.5 font-mono text-xs text-zinc-200 leading-relaxed tabular-nums">
              {currentUser.fingerprint}
            </p>
          </div>
          <div className="glass-surface rounded-2xl p-3.5">
            <p className="text-xs text-zinc-400">
              {isSelf ? 'Coffre local' : `Contact (${targetPeer.handle})`}
            </p>
            <p className="mt-1.5 font-mono text-xs text-zinc-200 leading-relaxed tabular-nums">
              {targetPeer.fingerprint}
            </p>
          </div>
        </div>

        {/* Technical specs */}
        <div className="border-t border-white/[0.07] pt-4 space-y-2 text-xs text-zinc-400">
          <div className="flex items-center justify-between">
            <span>Chiffrement des messages</span>
            <span className="font-mono text-zinc-200">AES-256-GCM + HKDF-SHA256</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Signatures d’authenticité</span>
            <span className="font-mono text-zinc-200">ECDSA P-256 (SHA-256)</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Protection de la clé unique</span>
            <span className="font-mono text-zinc-200">PBKDF2 (250 000 itérations)</span>
          </div>
        </div>

        {/* Packet inspector toggle */}
        <div className="glass-surface flex items-center justify-between rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2.5 pr-4">
            <Eye className="h-4 w-4 text-zinc-300 shrink-0" />
            <div>
              <p className="text-xs font-medium text-white">
                Inspecteur de paquets chiffrés
              </p>
              <p className="text-[11px] text-zinc-500">
                Afficher le texte chiffré Base64 et le vecteur d’initialisation sous chaque message
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={inspectorMode}
            onClick={onToggleInspector}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors ${
              inspectorMode
                ? 'border-emerald-500/50 bg-emerald-500/30'
                : 'border-white/15 bg-white/10'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                inspectorMode ? 'translate-x-5' : 'translate-x-0.5'
              } mt-[1px]`}
            />
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-white to-zinc-200 px-4 py-2 text-xs font-medium text-zinc-950 shadow-[inset_0_1px_0_0_#ffffff] hover:brightness-95 transition-all cursor-pointer"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Fermer</span>
          </button>
        </div>
      </div>
    </div>
  );
};
