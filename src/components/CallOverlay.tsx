import React, { useEffect, useRef } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
} from 'lucide-react';
import type { CallPhase, CallType } from '../hooks/useWebRTCCall';
import type { PublicUser } from '../types';
import { ProfileBanner } from './ProfileBanner';
import { UserAvatar } from './UserAvatar';

interface CallOverlayProps {
  phase: CallPhase;
  callType: CallType;
  peer: PublicUser | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioMuted: boolean;
  videoEnabled: boolean;
  peerAudioMuted: boolean;
  peerVideoEnabled: boolean;
  peerRinging: boolean;
  isMinimized: boolean;
  durationSec: number;
  notice: string | null;
  onDismissNotice: () => void;
  onToggleMinimize: () => void;
  onAccept: (withVideo?: boolean) => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
}

function formatDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  phase,
  callType,
  peer,
  localStream,
  remoteStream,
  audioMuted,
  videoEnabled,
  peerAudioMuted,
  peerVideoEnabled,
  peerRinging,
  isMinimized,
  durationSec,
  notice,
  onDismissNotice,
  onToggleMinimize,
  onAccept,
  onDecline,
  onHangup,
  onToggleMute,
  onToggleVideo,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, videoEnabled, isMinimized, phase]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      void remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream, peerVideoEnabled, isMinimized, phase]);

  const hasRemoteVideoTrack =
    Boolean(remoteStream?.getVideoTracks().some((t) => t.readyState === 'live')) &&
    peerVideoEnabled;

  // Floating toast notice when idle
  if (phase === 'idle') {
    if (!notice) return null;
    return (
      <div className="fixed bottom-5 right-5 z-50 glass-elevated rounded-xl border border-white/[0.12] px-4 py-3 flex items-center gap-3 shadow-2xl max-w-sm">
        <PhoneOff className="h-4 w-4 text-zinc-400 shrink-0" />
        <p className="text-xs text-zinc-200 flex-1">{notice}</p>
        <button
          type="button"
          onClick={onDismissNotice}
          className="text-[11px] text-zinc-400 hover:text-white cursor-pointer"
        >
          OK
        </button>
      </div>
    );
  }

  // Always keep hidden audio element mounted during active call so audio works even when minimized or audio-only
  const audioElement = <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />;

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
          <div className="glass-elevated w-full max-w-sm rounded-3xl overflow-hidden border border-white/[0.12] shadow-2xl">
            <div className="relative">
              <ProfileBanner
                user={peer}
                className="h-28"
                scrimClassName="bg-gradient-to-b from-black/30 via-black/55 to-[#09090d]"
              />
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
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
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onDecline}
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-2xl border border-red-500/35 bg-red-500/20 text-xs font-semibold text-red-200 hover:bg-red-500/30 transition-colors cursor-pointer"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>Refuser</span>
                </button>

                {callType === 'video' && (
                  <button
                    type="button"
                    onClick={() => onAccept(false)}
                    title="Répondre en audio uniquement"
                    className="min-h-[48px] px-4 flex items-center justify-center gap-1.5 rounded-2xl border border-white/[0.12] bg-white/[0.06] text-xs font-medium text-zinc-200 hover:bg-white/[0.12] transition-colors cursor-pointer"
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

  // Minimized floating call pill while using chat
  if (isMinimized && peer) {
    return (
      <>
        {audioElement}
        <div className="fixed bottom-4 right-4 z-50 glass-elevated rounded-2xl border border-white/[0.14] bg-[#0b0b10]/95 backdrop-blur-2xl p-3 shadow-2xl flex items-center gap-3 max-w-[340px]">
          <UserAvatar user={peer} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">
              {peer.displayName}
            </p>
            <p className="font-mono text-[11px] text-emerald-400 tabular-nums">
              {phase === 'connected'
                ? formatDuration(durationSec)
                : phase === 'connecting'
                  ? 'Connexion...'
                  : peerRinging
                    ? 'Sonnerie...'
                    : 'Appel...'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleMute}
              title={audioMuted ? 'Réactiver le micro' : 'Couper le micro'}
              className={`h-9 w-9 flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                audioMuted
                  ? 'border-red-500/40 bg-red-500/20 text-red-200'
                  : 'border-white/[0.1] bg-white/[0.05] text-white hover:bg-white/[0.1]'
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
              onClick={onToggleMinimize}
              title="Agrandir l'appel"
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.05] text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onHangup}
              title="Raccrocher"
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-400 transition-colors cursor-pointer"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>
      </>
    );
  }

  // Full Active / Outgoing / Connecting Call Stage
  return (
    <>
      {audioElement}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Appel temps réel DISCRET"
      >
        <div className="glass-elevated relative w-full max-w-3xl h-[82dvh] max-h-[680px] rounded-3xl overflow-hidden border border-white/[0.12] bg-[#07070b] flex flex-col shadow-2xl">
          {/* Top Call Bar */}
          <div className="relative z-10 flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-black/45 backdrop-blur-xl">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Chiffré DTLS-SRTP</span>
              </div>
              {peer && (
                <span className="text-xs font-medium text-zinc-300 truncate">
                  {peer.displayName}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-zinc-300 tabular-nums">
                {phase === 'connected'
                  ? formatDuration(durationSec)
                  : phase === 'connecting'
                    ? 'Connexion P2P...'
                    : peerRinging
                      ? 'Sonnerie...'
                      : 'Appel en cours...'}
              </span>
              <button
                type="button"
                onClick={onToggleMinimize}
                title="Réduire et continuer à discuter"
                className="h-9 w-9 flex items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.05] text-zinc-200 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

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

            {/* Remote video (always mounted when video track present) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`h-full w-full object-cover ${
                hasRemoteVideoTrack ? 'block' : 'hidden'
              }`}
            />

            {/* Audio-only / Camera-off Avatar Centerpiece */}
            {!hasRemoteVideoTrack && peer && (
              <div className="relative z-10 flex flex-col items-center text-center px-6 space-y-4">
                <div className="relative inline-flex">
                  {phase !== 'connected' && (
                    <span className="absolute -inset-3 rounded-full bg-white/10 animate-ping" />
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
                    {phase === 'connected'
                      ? peerVideoEnabled
                        ? 'Flux vidéo en attente...'
                        : 'Appel audio temps réel actif'
                      : phase === 'connecting'
                        ? 'Établissement du canal chiffré...'
                        : peerRinging
                          ? 'Sonnerie chez votre contact...'
                          : 'Invitation envoyée...'}
                  </p>
                </div>
              </div>
            )}

            {/* Remote mute/cam badges */}
            {phase === 'connected' && (peerAudioMuted || !peerVideoEnabled) && (
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                {peerAudioMuted && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-black/70 backdrop-blur-md px-2.5 py-1 text-[11px] text-red-200">
                    <MicOff className="h-3 w-3" />
                    <span>Micro coupé</span>
                  </span>
                )}
              </div>
            )}

            {/* Local Self-View PiP */}
            {videoEnabled && localStream && (
              <div className="absolute bottom-4 right-4 z-20 w-32 sm:w-44 aspect-video rounded-2xl overflow-hidden border border-white/20 bg-black shadow-2xl">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover -scale-x-100"
                />
              </div>
            )}
          </div>

          {/* Bottom Controls */}
          <div className="relative z-10 flex items-center justify-center gap-3 sm:gap-4 px-5 py-4 border-t border-white/[0.08] bg-black/60 backdrop-blur-xl">
            <button
              type="button"
              onClick={onToggleMute}
              title={audioMuted ? 'Réactiver le micro' : 'Couper le micro'}
              className={`min-h-[48px] px-4 flex items-center gap-2 rounded-2xl border text-xs font-medium transition-colors cursor-pointer ${
                audioMuted
                  ? 'border-red-500/40 bg-red-500/20 text-red-200'
                  : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
              }`}
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
                videoEnabled
                  ? 'border-white/30 bg-white text-zinc-950 hover:bg-zinc-200'
                  : 'border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.12]'
              }`}
            >
              {videoEnabled ? (
                <Video className="h-4 w-4" />
              ) : (
                <VideoOff className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {videoEnabled ? 'Caméra active' : 'Caméra'}
              </span>
            </button>

            <button
              type="button"
              onClick={onHangup}
              title="Raccrocher"
              className="min-h-[48px] px-6 flex items-center gap-2 rounded-2xl bg-red-500 text-xs font-semibold text-white hover:bg-red-400 transition-colors cursor-pointer"
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
