import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Phone,
  PhoneCall,
  PhoneOff,
  ShieldCheck,
  SlidersHorizontal,
  SwitchCamera,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type {
  CallPhase,
  CallQualityStats,
  CallType,
  EndedCallPrompt,
} from '../hooks/useWebRTCCall';
import { computeConversationSafetyNumber } from '../lib/crypto';
import type { PublicUser } from '../types';
import { ProfileBanner } from './ProfileBanner';
import { UserAvatar } from './UserAvatar';

interface CallOverlayProps {
  phase: CallPhase;
  callType: CallType;
  currentUserFingerprint: string;
  peer: PublicUser | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioMuted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  facingMode: 'user' | 'environment';
  hasMultipleCameras: boolean;
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  peerAudioMuted: boolean;
  peerVideoEnabled: boolean;
  peerRinging: boolean;
  peerQueued: boolean;
  peerPushSent: boolean;
  isMinimized: boolean;
  durationSec: number;
  notice: string | null;
  endedPrompt: EndedCallPrompt | null;
  localAudioLevel: number;
  remoteAudioLevel: number;
  stats: CallQualityStats;
  onDismissNotice: () => void;
  onRedial: (peer: PublicUser, callType: CallType) => void;
  onToggleMinimize: () => void;
  onAccept: (withVideo?: boolean) => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onSwitchCamera: () => void;
  onSelectAudioInput: (deviceId: string) => void;
  onSelectAudioOutput: (deviceId: string) => void;
}

function formatDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  phase,
  callType,
  currentUserFingerprint,
  peer,
  localStream,
  remoteStream,
  audioMuted,
  videoEnabled,
  screenSharing,
  facingMode,
  hasMultipleCameras,
  audioInputs,
  audioOutputs,
  selectedAudioInputId,
  selectedAudioOutputId,
  peerAudioMuted,
  peerVideoEnabled,
  peerRinging,
  peerQueued,
  peerPushSent,
  isMinimized,
  durationSec,
  notice,
  endedPrompt,
  localAudioLevel,
  remoteAudioLevel,
  stats,
  onDismissNotice,
  onRedial,
  onToggleMinimize,
  onAccept,
  onDecline,
  onHangup,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onSwitchCamera,
  onSelectAudioInput,
  onSelectAudioOutput,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const miniCardRef = useRef<HTMLDivElement | null>(null);
  const dragInfoRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
    fromVideo: boolean;
  } | null>(null);
  const suppressVideoClickRef = useRef(false);

  const [swapPip, setSwapPip] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState('');
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingMini, setIsDraggingMini] = useState(false);

  const supportsScreenShare =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);

  const hasRemoteVideoTrack =
    Boolean(remoteStream?.getVideoTracks().some((t) => t.readyState === 'live')) &&
    peerVideoEnabled;
  const hasLocalVideo = Boolean(
    (videoEnabled || screenSharing) &&
      localStream?.getVideoTracks().some((t) => t.readyState === 'live')
  );

  // Clamp helper so the minimized call bubble never leaves the safe viewport area
  const clampMiniPosition = (x: number, y: number): { x: number; y: number } => {
    if (typeof window === 'undefined') return { x, y };
    const margin = 12;
    const rect = miniCardRef.current?.getBoundingClientRect();
    const width = rect?.width || (window.innerWidth < 640 ? 276 : 308);
    const height = rect?.height || (hasRemoteVideoTrack ? 236 : 78);
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  };

  // Reset stage popovers when returning to idle or un-minimizing
  useEffect(() => {
    if (phase === 'idle') {
      setSwapPip(false);
      setShowInspector(false);
      setShowDevices(false);
      setSafetyNumber('');
      setMiniPos(null);
      setIsDraggingMini(false);
      dragInfoRef.current = null;
    }
  }, [phase]);

  // Synchronously initialize & clamp minimized call bubble inside viewport (prevents jump or stretch)
  useLayoutEffect(() => {
    if (!isMinimized || phase === 'idle' || typeof window === 'undefined') {
      setMiniPos(null);
      setIsDraggingMini(false);
      dragInfoRef.current = null;
      return;
    }

    const syncPosition = () => {
      const rect = miniCardRef.current?.getBoundingClientRect();
      const width = rect?.width || (window.innerWidth < 640 ? 276 : 308);
      const height = rect?.height || (hasRemoteVideoTrack ? 236 : 78);
      const margin = 12;
      const bottomOffset = window.innerWidth < 640 ? 84 : 20;
      const rightOffset = window.innerWidth < 640 ? 12 : 20;

      setMiniPos((prev) => {
        const target = prev ?? {
          x: window.innerWidth - width - rightOffset,
          y: window.innerHeight - height - bottomOffset,
        };
        const maxX = Math.max(margin, window.innerWidth - width - margin);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        return {
          x: Math.min(Math.max(margin, target.x), maxX),
          y: Math.min(Math.max(margin, target.y), maxY),
        };
      });
    };

    syncPosition();
    window.addEventListener('resize', syncPosition);
    return () => {
      window.removeEventListener('resize', syncPosition);
    };
  }, [isMinimized, phase, hasRemoteVideoTrack]);

  // Unified pointer drag lifecycle for minimized call bubble (mouse + touch + pen)
  useEffect(() => {
    if (!isDraggingMini) return;

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragInfoRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dx, dy) >= 6) {
        drag.moved = true;
      }

      if (drag.moved) {
        setMiniPos(clampMiniPosition(drag.originX + dx, drag.originY + dy));
      }
    };

    const handlePointerEnd = (e: PointerEvent) => {
      const drag = dragInfoRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      if (drag.moved) {
        suppressVideoClickRef.current = true;
        window.setTimeout(() => {
          suppressVideoClickRef.current = false;
        }, 80);
      }

      dragInfoRef.current = null;
      setIsDraggingMini(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [isDraggingMini, hasRemoteVideoTrack]);

  const handleMiniPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    fromVideo = false
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-call-control="true"]')) return;

    const rect = miniCardRef.current?.getBoundingClientRect();
    const currentX = miniPos?.x ?? rect?.left ?? 16;
    const currentY = miniPos?.y ?? rect?.top ?? 16;

    dragInfoRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: currentX,
      originY: currentY,
      moved: false,
      fromVideo,
    };
    setIsDraggingMini(true);
  };

  // Compute P-256 Safety Number for active peer
  useEffect(() => {
    if (phase === 'idle' || !peer?.fingerprint || !currentUserFingerprint) return;
    computeConversationSafetyNumber(currentUserFingerprint, peer.fingerprint)
      .then(setSafetyNumber)
      .catch(() => setSafetyNumber(''));
  }, [phase, peer?.fingerprint, currentUserFingerprint]);

  // Attach streams cleanly (supporting PiP view swap)
  useEffect(() => {
    const mainStream = swapPip ? localStream : remoteStream;
    const pipStream = swapPip ? remoteStream : localStream;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = mainStream ?? null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = pipStream ?? null;
    }
  }, [
    swapPip,
    localStream,
    remoteStream,
    videoEnabled,
    screenSharing,
    peerVideoEnabled,
    isMinimized,
    phase,
  ]);

  // Always keep audio routed to hidden audio element + apply output sinkId if supported
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el || !remoteStream) return;
    el.srcObject = remoteStream;
    void el.play().catch(() => {});

    if (
      selectedAudioOutputId &&
      'setSinkId' in el &&
      typeof (el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> })
        .setSinkId === 'function'
    ) {
      void (el as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> })
        .setSinkId(selectedAudioOutputId)
        .catch(() => {});
    }
  }, [remoteStream, selectedAudioOutputId, phase]);

  // Floating toast notice when idle (with 1-tap redial when available)
  if (phase === 'idle') {
    if (!notice) return null;
    return (
      <div className="fixed bottom-20 sm:bottom-5 right-3 sm:right-5 left-3 sm:left-auto z-50 glass-elevated rounded-2xl border border-white/[0.1] px-4 py-3 flex items-center gap-3 shadow-2xl sm:max-w-sm">
        <PhoneOff className="h-4 w-4 text-zinc-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-100 truncate">{notice}</p>
          {endedPrompt && (
            <p className="text-[11px] text-zinc-400 truncate">
              {endedPrompt.peer.displayName} · {endedPrompt.summary}
            </p>
          )}
        </div>
        {endedPrompt && (
          <button
            type="button"
            onClick={() => onRedial(endedPrompt.peer, endedPrompt.callType)}
            className="min-h-[34px] inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-zinc-200 transition-colors shrink-0 cursor-pointer"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            <span>Rappeler</span>
          </button>
        )}
        <button
          type="button"
          onClick={onDismissNotice}
          aria-label="Fermer"
          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const audioElement = (
    <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
  );

  // Incoming Call Modal
  if (phase === 'incoming' && peer) {
    return (
      <>
        {audioElement}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Appel entrant"
        >
          <div className="glass-elevated w-full max-w-sm rounded-3xl overflow-hidden border border-white/[0.1] shadow-2xl">
            <div className="relative">
              <ProfileBanner
                user={peer}
                className="h-28"
                scrimClassName="bg-gradient-to-b from-black/30 via-black/55 to-[#09090d]"
              />
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>DTLS-SRTP E2EE</span>
              </div>
            </div>

            <div className="px-6 pb-6 -mt-10 relative text-center space-y-4">
              <div className="relative inline-flex">
                <span className="absolute -inset-2 rounded-full bg-emerald-400/20 animate-ping" />
                <div className="relative rounded-full p-1 bg-[#09090d] border border-white/15">
                  <UserAvatar user={peer} size="lg" />
                </div>
              </div>

              <div>
                <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
                  {peer.displayName}
                </h2>
                <p className="font-mono text-xs text-zinc-400 mt-0.5">
                  {peer.handle}
                </p>
                <p className="mt-2 text-xs font-medium text-emerald-300">
                  {callType === 'video'
                    ? 'Appel vidéo chiffré entrant...'
                    : 'Appel audio chiffré entrant...'}
                </p>
                {safetyNumber && (
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-500 tabular-nums">
                    Sécurité : {safetyNumber}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onDecline}
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/15 text-xs font-semibold text-red-200 hover:bg-red-500/25 transition-colors cursor-pointer"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>Refuser</span>
                </button>

                {callType === 'video' && (
                  <button
                    type="button"
                    onClick={() => onAccept(false)}
                    title="Répondre en audio uniquement"
                    className="min-h-[48px] px-4 flex items-center justify-center gap-1.5 rounded-2xl border border-white/[0.1] bg-white/[0.05] text-xs font-medium text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
                  >
                    <Phone className="h-4 w-4" />
                    <span>Audio</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onAccept(callType === 'video')}
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors cursor-pointer"
                >
                  {callType === 'video' ? (
                    <Video className="h-4 w-4" />
                  ) : (
                    <Phone className="h-4 w-4" />
                  )}
                  <span>Répondre</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const statusText =
    phase === 'connected'
      ? formatDuration(durationSec)
      : phase === 'reconnecting'
        ? 'Reconnexion...'
        : phase === 'connecting'
          ? 'Connexion P2P...'
          : peerRinging
            ? 'Sonnerie...'
            : peerQueued
              ? peerPushSent
                ? 'Notification envoyée...'
                : 'En attente du contact...'
              : 'Appel en cours...';

  // Minimized floating call bubble (freely draggable across viewport)
  if (isMinimized && peer) {
    const miniVoiceRingScale = 1 + Math.min(0.18, remoteAudioLevel * 0.25);

    return (
      <>
        {audioElement}
        <div
          ref={miniCardRef}
          onPointerDown={(e) => handleMiniPointerDown(e, false)}
          style={
            miniPos
              ? {
                  transform: `translate3d(${miniPos.x}px, ${miniPos.y}px, 0)`,
                  transition: isDraggingMini
                    ? 'none'
                    : 'box-shadow 180ms ease',
                }
              : undefined
          }
          className={`fixed z-50 glass-liquid rounded-2xl overflow-hidden w-[276px] sm:w-[308px] h-auto max-h-[calc(100dvh-24px)] touch-none select-none ${
            miniPos ? 'top-0 left-0' : 'bottom-20 sm:bottom-5 right-3 sm:right-5'
          } ${
            isDraggingMini
              ? 'cursor-grabbing border-white/[0.3] shadow-[0_28px_68px_-12px_rgba(0,0,0,0.92)]'
              : 'cursor-grab border-white/[0.16] shadow-[0_22px_52px_-12px_rgba(0,0,0,0.85)]'
          }`}
        >
          {/* Minimalist drag handle */}
          <div
            title="Déplacer la bulle d’appel"
            className="flex items-center justify-center py-1.5 border-b border-white/[0.06] bg-white/[0.03]"
          >
            <span className="h-1 w-8 rounded-full bg-white/25" />
          </div>

          {hasRemoteVideoTrack && (
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                handleMiniPointerDown(e, true);
              }}
              onClick={() => {
                if (!suppressVideoClickRef.current) {
                  onToggleMinimize();
                }
              }}
              title="Glisser pour déplacer · Appuyer pour agrandir"
              className="relative block w-full aspect-video bg-black group"
            >
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="h-full w-full object-cover pointer-events-none"
              />
              <button
                type="button"
                data-call-control="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMinimize();
                }}
                aria-label="Agrandir la vidéo"
                className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center rounded-lg bg-black/65 text-white/90 opacity-85 group-hover:opacity-100 hover:bg-black/85 transition-colors cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="px-3 py-2.5 flex items-center gap-2.5">
            <div className="relative shrink-0">
              {phase === 'connected' && remoteAudioLevel > 0.05 && (
                <span
                  aria-hidden="true"
                  style={{ transform: `scale(${miniVoiceRingScale})` }}
                  className="pointer-events-none absolute -inset-0.5 rounded-full border border-emerald-400/60 transition-transform duration-150"
                />
              )}
              <UserAvatar user={peer} size="sm" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">
                {peer.displayName}
              </p>
              <p
                className={`font-mono text-[11px] tabular-nums ${
                  phase === 'reconnecting' ? 'text-amber-300' : 'text-emerald-400'
                }`}
              >
                {statusText}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-call-control="true"
                onClick={onToggleMute}
                title={audioMuted ? 'Réactiver le micro' : 'Couper le micro'}
                aria-label={audioMuted ? 'Réactiver le micro' : 'Couper le micro'}
                className={`h-9 w-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
                  audioMuted
                    ? 'bg-red-500/20 text-red-200 border border-red-500/35'
                    : 'bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]'
                }`}
              >
                {audioMuted ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                data-call-control="true"
                onClick={onToggleMinimize}
                title="Agrandir l'appel"
                aria-label="Agrandir l'appel"
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12] transition-colors cursor-pointer"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-call-control="true"
                onClick={onHangup}
                title="Raccrocher"
                aria-label="Raccrocher"
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-400 transition-colors cursor-pointer"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const mainShowsVideo = swapPip ? hasLocalVideo : hasRemoteVideoTrack;
  const pipShowsVideo = swapPip ? hasRemoteVideoTrack : hasLocalVideo;
  const shouldMirrorMain = swapPip && facingMode === 'user' && !screenSharing;
  const shouldMirrorPip = !swapPip && facingMode === 'user' && !screenSharing;
  const hasDeviceChoices = audioInputs.length > 1 || audioOutputs.length > 1;
  const voiceRingScale = 1 + Math.min(0.28, remoteAudioLevel * 0.35);

  return (
    <>
      {audioElement}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Appel temps réel DISCRET"
      >
        <div className="glass-elevated relative w-full h-dvh sm:h-[86dvh] sm:max-h-[720px] sm:max-w-4xl sm:rounded-3xl overflow-hidden border-0 sm:border sm:border-white/[0.14] bg-[#07070b] flex flex-col shadow-2xl">
          {/* Top Call Bar */}
          <div className="relative z-20 flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-white/[0.08] glass-liquid rounded-none">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setShowInspector((v) => !v);
                  setShowDevices(false);
                }}
                title="Vérifier l'empreinte P-256 et la qualité réseau"
                className={`min-h-[34px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                  showInspector
                    ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/[0.08] bg-white/[0.04] text-emerald-300 hover:bg-white/[0.08]'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">DTLS-SRTP</span>
              </button>

              {peer && (
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-white truncate">
                    {peer.displayName}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`font-mono text-xs tabular-nums ${
                  phase === 'reconnecting' ? 'text-amber-300' : 'text-zinc-300'
                }`}
              >
                {statusText}
              </span>
              <button
                type="button"
                onClick={onToggleMinimize}
                title="Réduire pour écrire dans la discussion"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/[0.06] text-zinc-200 hover:bg-white/[0.12] hover:text-white transition-colors cursor-pointer"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Expandable Security & Real-Time Network Quality Drawer */}
          {showInspector && peer && (
            <div className="relative z-20 border-b border-white/[0.08] bg-[#0b0b11]/95 px-4 sm:px-6 py-3.5 text-xs space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-300 font-medium">
                  <Activity className="h-3.5 w-3.5" />
                  <span>Sécurité & télémétrie P2P en direct</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInspector(false)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-zinc-500">Latence (RTT)</p>
                  <p className="mt-0.5 font-mono text-zinc-100 tabular-nums">
                    {stats.rttMs !== null ? `${stats.rttMs} ms` : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-zinc-500">Débit reçu</p>
                  <p className="mt-0.5 font-mono text-zinc-100 tabular-nums">
                    {stats.bitrateKbps !== null ? `${stats.bitrateKbps} kbps` : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-zinc-500">Perte paquets</p>
                  <p className="mt-0.5 font-mono text-zinc-100 tabular-nums">
                    {stats.packetLossPct !== null ? `${stats.packetLossPct}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-zinc-500">Transport</p>
                  <p className="mt-0.5 font-mono text-zinc-100 truncate">
                    {stats.transportLabel || (stats.resolution ? stats.resolution : 'ICE')}
                  </p>
                </div>
              </div>
              {safetyNumber && (
                <p className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  Numéro de sécurité P-256 :{' '}
                  <span className="text-zinc-200">{safetyNumber}</span>
                </p>
              )}
            </div>
          )}

          {/* Audio Input/Output Device Switcher Drawer */}
          {showDevices && hasDeviceChoices && (
            <div className="relative z-20 border-b border-white/[0.08] bg-[#0b0b11]/95 px-4 sm:px-6 py-3.5 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-200">
                  Périphériques audio de l’appel
                </span>
                <button
                  type="button"
                  onClick={() => setShowDevices(false)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {audioInputs.length > 1 && (
                  <label className="space-y-1">
                    <span className="block text-[11px] text-zinc-400">Microphone</span>
                    <select
                      value={selectedAudioInputId}
                      onChange={(e) => onSelectAudioInput(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    >
                      {audioInputs.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId} className="bg-zinc-950">
                          {d.label || `Microphone ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {audioOutputs.length > 1 && (
                  <label className="space-y-1">
                    <span className="block text-[11px] text-zinc-400">Sortie audio</span>
                    <select
                      value={selectedAudioOutputId}
                      onChange={(e) => onSelectAudioOutput(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    >
                      {audioOutputs.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId} className="bg-zinc-950">
                          {d.label || `Haut-parleur ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Center Media Stage */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-[#050507]">
            {peer && (
              <div className="pointer-events-none absolute inset-0 opacity-20">
                <ProfileBanner
                  user={peer}
                  className="h-full"
                  scrimClassName="bg-gradient-to-b from-black/50 via-[#050507]/85 to-[#050507]"
                />
              </div>
            )}

            {/* Main Video Stream (Remote by default, or Local when PiP swapped) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={swapPip}
              className={`h-full w-full ${
                swapPip && screenSharing ? 'object-contain' : 'object-cover'
              } ${shouldMirrorMain ? '-scale-x-100' : ''} ${
                mainShowsVideo ? 'block' : 'hidden'
              }`}
            />

            {/* Audio-only / Camera-off Avatar Centerpiece with live voice activity ring */}
            {!mainShowsVideo && peer && (
              <div className="relative z-10 flex flex-col items-center text-center px-6 space-y-4">
                <div className="relative inline-flex items-center justify-center">
                  {phase !== 'connected' ? (
                    <span className="absolute -inset-3 rounded-full bg-white/10 animate-ping" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border-2 border-emerald-400/50 transition-transform duration-150"
                      style={{
                        transform: `scale(${voiceRingScale})`,
                        opacity: remoteAudioLevel > 0.04 ? 0.85 : 0.15,
                      }}
                    />
                  )}
                  <div className="relative rounded-full p-1.5 bg-[#0a0a0f] border border-white/15 shadow-xl">
                    <UserAvatar user={peer} size="lg" />
                  </div>
                </div>
                <div>
                  <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
                    {peer.displayName}
                  </h2>
                  <p className="font-mono text-xs text-zinc-400 mt-0.5">
                    {peer.handle}
                  </p>
                  <p className="mt-2 text-xs text-zinc-300">
                    {phase === 'reconnecting'
                      ? 'Interruption réseau détectée — tentative de reconnexion ICE...'
                      : phase === 'connected'
                        ? peerVideoEnabled
                          ? 'Flux vidéo en attente...'
                          : 'Appel audio temps réel actif'
                        : phase === 'connecting'
                          ? 'Établissement du canal chiffré...'
                          : peerRinging
                            ? 'Sonnerie chez votre contact...'
                            : peerQueued
                              ? peerPushSent
                                ? 'Alerte Push envoyée, en attente d’ouverture...'
                                : 'Contact hors-ligne — attente de reconnexion...'
                              : 'Invitation envoyée...'}
                  </p>
                </div>
              </div>
            )}

            {/* Status indicators on stage */}
            <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2">
              {phase === 'connected' && peerAudioMuted && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-black/75 backdrop-blur-md px-2.5 py-1 text-[11px] text-red-200">
                  <MicOff className="h-3 w-3" />
                  <span>Micro du contact coupé</span>
                </span>
              )}
              {screenSharing && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-black/75 backdrop-blur-md px-2.5 py-1 text-[11px] text-emerald-200">
                  <MonitorUp className="h-3 w-3" />
                  <span>Partage d’écran actif</span>
                </span>
              )}
              {phase === 'reconnecting' && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-black/75 backdrop-blur-md px-2.5 py-1 text-[11px] text-amber-200">
                  <Activity className="h-3 w-3" />
                  <span>Reconnexion P2P...</span>
                </span>
              )}
            </div>

            {/* Secondary PiP Preview (Tap to swap views) */}
            {pipShowsVideo && (
              <div className="absolute bottom-4 right-4 z-20 w-32 sm:w-44 aspect-video rounded-2xl overflow-hidden border border-white/25 bg-black shadow-2xl group">
                <button
                  type="button"
                  onClick={() => setSwapPip((v) => !v)}
                  title="Inverser la vue principale et la miniature"
                  className="h-full w-full block cursor-pointer"
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted={!swapPip}
                    className={`h-full w-full object-cover ${
                      shouldMirrorPip ? '-scale-x-100' : ''
                    }`}
                  />
                </button>
                {videoEnabled && !screenSharing && hasMultipleCameras && !swapPip && (
                  <button
                    type="button"
                    onClick={() => void onSwitchCamera()}
                    title="Changer de caméra"
                    aria-label="Changer de caméra"
                    className="absolute top-1.5 right-1.5 h-7 w-7 flex items-center justify-center rounded-lg bg-black/65 text-white hover:bg-black/85 transition-colors cursor-pointer"
                  >
                    <SwitchCamera className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bottom Controls */}
          <div className="relative z-20 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/[0.08] glass-liquid rounded-none">
            <button
              type="button"
              onClick={onToggleMute}
              title={audioMuted ? 'Réactiver le micro' : 'Couper le micro'}
              className={`relative min-h-[48px] px-4 flex items-center gap-2 rounded-2xl border text-xs font-medium transition-colors cursor-pointer ${
                audioMuted
                  ? 'border-red-500/40 bg-red-500/20 text-red-200'
                  : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
              }`}
              style={
                !audioMuted && localAudioLevel > 0.06
                  ? { boxShadow: `0 0 0 2px rgba(52, 211, 153, ${Math.min(0.75, localAudioLevel)})` }
                  : undefined
              }
            >
              {audioMuted ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {audioMuted ? 'Micro coupé' : 'Micro'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void onToggleVideo()}
              title={videoEnabled ? 'Couper la caméra' : 'Activer la caméra'}
              className={`min-h-[48px] px-4 flex items-center gap-2 rounded-2xl border text-xs font-medium transition-colors cursor-pointer ${
                videoEnabled && !screenSharing
                  ? 'border-white/30 bg-white text-zinc-950 hover:bg-zinc-200'
                  : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
              }`}
            >
              {videoEnabled && !screenSharing ? (
                <Video className="h-4 w-4" />
              ) : (
                <VideoOff className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {videoEnabled && !screenSharing ? 'Caméra active' : 'Caméra'}
              </span>
            </button>

            {videoEnabled && !screenSharing && hasMultipleCameras && (
              <button
                type="button"
                onClick={() => void onSwitchCamera()}
                title="Basculer caméra avant / arrière"
                aria-label="Basculer caméra avant / arrière"
                className="min-h-[48px] px-3.5 flex items-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.06] text-xs font-medium text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
              >
                <SwitchCamera className="h-4 w-4" />
                <span className="hidden md:inline">Caméra</span>
              </button>
            )}

            {supportsScreenShare && (phase === 'connected' || phase === 'reconnecting') && (
              <button
                type="button"
                onClick={() => void onToggleScreenShare()}
                title={
                  screenSharing ? 'Arrêter le partage d’écran' : 'Partager l’écran'
                }
                className={`min-h-[48px] px-3.5 flex items-center gap-2 rounded-2xl border text-xs font-medium transition-colors cursor-pointer ${
                  screenSharing
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
                }`}
              >
                <MonitorUp className="h-4 w-4" />
                <span className="hidden md:inline">
                  {screenSharing ? 'Arrêter écran' : 'Partager'}
                </span>
              </button>
            )}

            {hasDeviceChoices && (
              <button
                type="button"
                onClick={() => {
                  setShowDevices((v) => !v);
                  setShowInspector(false);
                }}
                title="Choisir micro et sortie audio"
                aria-label="Choisir les périphériques audio"
                className={`min-h-[48px] px-3.5 flex items-center gap-2 rounded-2xl border text-xs font-medium transition-colors cursor-pointer ${
                  showDevices
                    ? 'border-white/30 bg-white/15 text-white'
                    : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onHangup}
              title="Raccrocher"
              className="min-h-[48px] px-5 sm:px-6 flex items-center gap-2 rounded-2xl bg-red-500 text-xs font-semibold text-white hover:bg-red-400 transition-colors cursor-pointer"
            >
              <PhoneOff className="h-4 w-4" />
              <span>Raccrocher</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
