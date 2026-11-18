import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../types';

export type CallType = 'audio' | 'video';

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'reconnecting'
  | 'connected';

export interface CallSignalPayload {
  type: string;
  callId?: string;
  fromId?: string;
  caller?: PublicUser;
  callType?: CallType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  reason?: string;
  audioMuted?: boolean;
  videoEnabled?: boolean;
  pushSent?: boolean;
}

export interface CallQualityStats {
  rttMs: number | null;
  bitrateKbps: number | null;
  packetLossPct: number | null;
  transportLabel: string | null;
  resolution: string | null;
}

export interface EndedCallPrompt {
  peer: PublicUser;
  callType: CallType;
  summary: string;
}

interface UseWebRTCCallOptions {
  currentUserId: string;
  sendSignal: (payload: Record<string, unknown>) => boolean;
  resolveUser: (userId: string) => Promise<PublicUser | null>;
}

const RTC_CONFIG: RTCConfiguration = {
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

function computeStreamLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    const norm = (buffer[i] - 128) / 128;
    sumSq += norm * norm;
  }
  const rms = Math.sqrt(sumSq / buffer.length);
  return Math.min(1, rms * 3.8);
}

export function useWebRTCCall({
  currentUserId,
  sendSignal,
  resolveUser,
}: UseWebRTCCallOptions) {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [callType, setCallType] = useState<CallType>('audio');
  const [peer, setPeer] = useState<PublicUser | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>('');
  const [peerAudioMuted, setPeerAudioMuted] = useState(false);
  const [peerVideoEnabled, setPeerVideoEnabled] = useState(false);
  const [peerRinging, setPeerRinging] = useState(false);
  const [peerQueued, setPeerQueued] = useState(false);
  const [peerPushSent, setPeerPushSent] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [endedPrompt, setEndedPrompt] = useState<EndedCallPrompt | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const [stats, setStats] = useState<CallQualityStats>({
    rttMs: null,
    bitrateKbps: null,
    packetLossPct: null,
    transportLabel: null,
    resolution: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackBackupRef = useRef<MediaStreamTrack | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const activePeerRef = useRef<PublicUser | null>(null);
  const activeCallTypeRef = useRef<CallType>('audio');
  const phaseRef = useRef<CallPhase>('idle');
  const connectedSinceRef = useRef<number | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimeoutRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const toneIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const prevBytesSampleRef = useRef<{ ts: number; bytes: number } | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    activeCallTypeRef.current = callType;
  }, [callType]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setHasMultipleCameras(videoInputs.length > 1);
      setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
      setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    } catch {
      // Ignore enumerateDevices errors in restricted browsers
    }
  }, []);

  const showNotice = useCallback((msg: string, redial?: EndedCallPrompt | null) => {
    setNotice(msg);
    setEndedPrompt(redial ?? null);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      setEndedPrompt(null);
    }, redial ? 8500 : 4500);
  }, []);

  const playCue = useCallback((kind: 'connected' | 'ended') => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      if (kind === 'connected') {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      } else {
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.setValueAtTime(360, now + 0.09);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
      window.setTimeout(() => {
        ctx.close().catch(() => {});
      }, 450);
    } catch {
      // Ignore audio errors
    }
  }, []);

  const stopTones = useCallback(() => {
    if (toneIntervalRef.current !== null) {
      window.clearInterval(toneIntervalRef.current);
      toneIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startToneLoop = useCallback(
    (kind: 'incoming' | 'outgoing') => {
      stopTones();
      if (kind === 'incoming' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([220, 140, 220]);
        } catch {
          // Ignore vibrate error
        }
      }

      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;

        const playPulse = () => {
          try {
            if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
              audioCtxRef.current = new AudioCtx();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
              void ctx.resume().catch(() => {});
            }
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';

            if (kind === 'incoming') {
              osc.frequency.setValueAtTime(587.33, now);
              osc.frequency.setValueAtTime(783.99, now + 0.14);
              gain.gain.setValueAtTime(0.0001, now);
              gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
              gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(now);
              osc.stop(now + 0.38);
            } else {
              osc.frequency.setValueAtTime(440, now);
              gain.gain.setValueAtTime(0.0001, now);
              gain.gain.exponentialRampToValueAtTime(0.045, now + 0.04);
              gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(now);
              osc.stop(now + 0.48);
            }
          } catch {
            // Ignore autoplay restriction errors
          }
        };

        playPulse();
        toneIntervalRef.current = window.setInterval(
          playPulse,
          kind === 'incoming' ? 1800 : 2400
        );
      } catch {
        // Ignore AudioContext errors
      }
    },
    [stopTones]
  );

  const cleanupCall = useCallback(() => {
    stopTones();
    if (ringTimeoutRef.current !== null) {
      window.clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      for (const sender of pcRef.current.getSenders()) {
        if (sender.track) {
          sender.track.stop();
        }
      }
      pcRef.current.close();
      pcRef.current = null;
    }

    if (screenStreamRef.current) {
      for (const track of screenStreamRef.current.getTracks()) {
        track.stop();
      }
      screenStreamRef.current = null;
    }

    if (cameraTrackBackupRef.current) {
      cameraTrackBackupRef.current.stop();
      cameraTrackBackupRef.current = null;
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    activeCallIdRef.current = null;
    activePeerRef.current = null;
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    connectedSinceRef.current = null;
    prevBytesSampleRef.current = null;

    setLocalStream(null);
    setRemoteStream(null);
    setPeer(null);
    setPhase('idle');
    setAudioMuted(false);
    setVideoEnabled(false);
    setScreenSharing(false);
    setFacingMode('user');
    setPeerAudioMuted(false);
    setPeerVideoEnabled(false);
    setPeerRinging(false);
    setPeerQueued(false);
    setPeerPushSent(false);
    setIsMinimized(false);
    setDurationSec(0);
    setLocalAudioLevel(0);
    setRemoteAudioLevel(0);
    setStats({
      rttMs: null,
      bitrateKbps: null,
      packetLossPct: null,
      transportLabel: null,
      resolution: null,
    });
  }, [stopTones]);

  // Call duration timer while connected or temporarily reconnecting
  useEffect(() => {
    if (phase !== 'connected' && phase !== 'reconnecting') {
      if (phase === 'idle') {
        connectedSinceRef.current = null;
        setDurationSec(0);
      }
      return;
    }
    if (!connectedSinceRef.current) {
      connectedSinceRef.current = Date.now();
    }
    const base = connectedSinceRef.current;
    const id = window.setInterval(() => {
      setDurationSec(Math.floor((Date.now() - base) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Real audio activity monitoring (local mic + remote audio)
  useEffect(() => {
    if (phase !== 'connected' && phase !== 'reconnecting' && phase !== 'outgoing') {
      setLocalAudioLevel(0);
      setRemoteAudioLevel(0);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    let rafTimer: number | null = null;

    try {
      ctx = new AudioCtx();
      let localAnalyser: AnalyserNode | null = null;
      let localBuf: Uint8Array<ArrayBuffer> | null = null;
      let remoteAnalyser: AnalyserNode | null = null;
      let remoteBuf: Uint8Array<ArrayBuffer> | null = null;

      if (localStream && localStream.getAudioTracks().length > 0 && !audioMuted) {
        const src = ctx.createMediaStreamSource(localStream);
        localAnalyser = ctx.createAnalyser();
        localAnalyser.fftSize = 256;
        src.connect(localAnalyser);
        localBuf = new Uint8Array(new ArrayBuffer(localAnalyser.frequencyBinCount));
      } else {
        setLocalAudioLevel(0);
      }

      if (remoteStream && remoteStream.getAudioTracks().length > 0 && !peerAudioMuted) {
        const src = ctx.createMediaStreamSource(remoteStream);
        remoteAnalyser = ctx.createAnalyser();
        remoteAnalyser.fftSize = 256;
        src.connect(remoteAnalyser);
        remoteBuf = new Uint8Array(new ArrayBuffer(remoteAnalyser.frequencyBinCount));
      } else {
        setRemoteAudioLevel(0);
      }

      if (localAnalyser || remoteAnalyser) {
        rafTimer = window.setInterval(() => {
          if (localAnalyser && localBuf) {
            setLocalAudioLevel(computeStreamLevel(localAnalyser, localBuf));
          }
          if (remoteAnalyser && remoteBuf) {
            setRemoteAudioLevel(computeStreamLevel(remoteAnalyser, remoteBuf));
          }
        }, 110);
      }
    } catch {
      // Ignore Web Audio errors
    }

    return () => {
      if (rafTimer !== null) window.clearInterval(rafTimer);
      ctx?.close().catch(() => {});
    };
  }, [phase, localStream, remoteStream, audioMuted, peerAudioMuted]);

  // Real WebRTC telemetry polling via pc.getStats()
  useEffect(() => {
    if (phase !== 'connected' || !pcRef.current) return;

    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let rttMs: number | null = null;
        let transportLabel: string | null = null;
        let totalBytes = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let resolution: string | null = null;

        const candidates = new Map<string, { candidateType?: string }>();
        report.forEach((stat) => {
          if (stat.type === 'local-candidate' || stat.type === 'remote-candidate') {
            candidates.set(stat.id, stat as { candidateType?: string });
          }
        });

        report.forEach((stat) => {
          if (stat.type === 'candidate-pair' && (stat as { nominated?: boolean }).nominated) {
            const pair = stat as {
              currentRoundTripTime?: number;
              remoteCandidateId?: string;
              localCandidateId?: string;
            };
            if (typeof pair.currentRoundTripTime === 'number') {
              rttMs = Math.round(pair.currentRoundTripTime * 1000);
            }
            const localCand = pair.localCandidateId
              ? candidates.get(pair.localCandidateId)
              : undefined;
            const remoteCand = pair.remoteCandidateId
              ? candidates.get(pair.remoteCandidateId)
              : undefined;
            if (
              localCand?.candidateType === 'relay' ||
              remoteCand?.candidateType === 'relay'
            ) {
              transportLabel = 'Relais TURN';
            } else if (localCand || remoteCand) {
              transportLabel = 'Pair-à-pair direct';
            }
          }

          if (stat.type === 'inbound-rtp') {
            const inb = stat as {
              kind?: string;
              bytesReceived?: number;
              packetsLost?: number;
              packetsReceived?: number;
              frameWidth?: number;
              frameHeight?: number;
            };
            if (typeof inb.bytesReceived === 'number') {
              totalBytes += inb.bytesReceived;
            }
            if (typeof inb.packetsLost === 'number') {
              packetsLost += Math.max(0, inb.packetsLost);
            }
            if (typeof inb.packetsReceived === 'number') {
              packetsReceived += Math.max(0, inb.packetsReceived);
            }
            if (
              inb.kind === 'video' &&
              typeof inb.frameWidth === 'number' &&
              typeof inb.frameHeight === 'number' &&
              inb.frameWidth > 0
            ) {
              resolution = `${inb.frameWidth}×${inb.frameHeight}`;
            }
          }
        });

        const now = Date.now();
        let bitrateKbps: number | null = null;
        if (prevBytesSampleRef.current) {
          const dt = (now - prevBytesSampleRef.current.ts) / 1000;
          const db = totalBytes - prevBytesSampleRef.current.bytes;
          if (dt > 0.3 && db >= 0) {
            bitrateKbps = Math.round((db * 8) / dt / 1000);
          }
        }
        prevBytesSampleRef.current = { ts: now, bytes: totalBytes };

        const totalPkts = packetsLost + packetsReceived;
        const packetLossPct =
          totalPkts > 0 ? Number(((packetsLost / totalPkts) * 100).toFixed(1)) : 0;

        setStats({
          rttMs,
          bitrateKbps,
          packetLossPct,
          transportLabel,
          resolution,
        });
      } catch {
        // Ignore getStats errors
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupCall();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, [cleanupCall]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidate
      }
    }
  }, []);

  const attemptIceRestart = useCallback(
    async (callId: string, targetPeerId: string) => {
      const pc = pcRef.current;
      if (!pc || activeCallIdRef.current !== callId) return;
      try {
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
        }
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendSignal({
          type: 'call:renegotiate',
          callId,
          toId: targetPeerId,
          sdp: offer,
        });
      } catch {
        // Ignore ICE restart failures
      }
    },
    [sendSignal]
  );

  const createPeerConnection = useCallback(
    (callId: string, targetPeerId: string) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'call:ice',
            callId,
            toId: targetPeerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = remoteStreamRef.current ?? new MediaStream();
        if (event.streams && event.streams[0]) {
          for (const track of event.streams[0].getTracks()) {
            if (!stream.getTracks().some((t) => t.id === track.id)) {
              stream.addTrack(track);
            }
          }
        } else if (event.track) {
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }
        }
        remoteStreamRef.current = stream;
        setRemoteStream(new MediaStream(stream.getTracks()));
        if (event.track.kind === 'video') {
          setPeerVideoEnabled(true);
        }
      };

      const markConnected = () => {
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        const wasIdleOrConnecting =
          phaseRef.current !== 'connected' && phaseRef.current !== 'reconnecting';
        stopTones();
        if (ringTimeoutRef.current !== null) {
          window.clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
        }
        setPhase('connected');
        if (wasIdleOrConnecting) {
          playCue('connected');
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          markConnected();
        } else if (st === 'disconnected') {
          if (
            activeCallIdRef.current === callId &&
            phaseRef.current === 'connected'
          ) {
            setPhase('reconnecting');
            if (reconnectTimerRef.current === null) {
              reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                if (
                  activeCallIdRef.current === callId &&
                  phaseRef.current === 'reconnecting'
                ) {
                  void attemptIceRestart(callId, targetPeerId);
                }
              }, 2400);
            }
          }
        } else if (st === 'failed' || st === 'closed') {
          if (activeCallIdRef.current === callId) {
            const p = activePeerRef.current;
            const cType = activeCallTypeRef.current;
            cleanupCall();
            playCue('ended');
            showNotice(
              'Appel terminé (connexion interrompue).',
              p ? { peer: p, callType: cType, summary: 'Connexion interrompue' } : null
            );
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          markConnected();
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [attemptIceRestart, cleanupCall, playCue, sendSignal, showNotice, stopTones]
  );

  const acquireMedia = useCallback(
    async (
      wantVideo: boolean,
      preferredFacing: 'user' | 'environment' = 'user',
      audioDeviceId?: string
    ): Promise<{ stream: MediaStream; hasVideo: boolean }> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Votre navigateur ou cet environnement ne permet pas l’accès au micro/caméra.'
        );
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
      };

      if (wantVideo) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: preferredFacing },
            },
          });
          await refreshDevices();
          return { stream, hasVideo: true };
        } catch {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
          });
          await refreshDevices();
          showNotice('Caméra indisponible — appel lancé en audio uniquement.');
          return { stream: audioOnly, hasVideo: false };
        }
      }

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      await refreshDevices();
      return { stream: audioStream, hasVideo: false };
    },
    [refreshDevices, showNotice]
  );

  const startCall = useCallback(
    async (targetPeer: PublicUser, requestedType: CallType) => {
      if (targetPeer.id === currentUserId) return;
      if (phaseRef.current !== 'idle') {
        showNotice('Un appel est déjà en cours.');
        return;
      }

      setNotice(null);
      setEndedPrompt(null);

      try {
        const { stream, hasVideo } = await acquireMedia(
          requestedType === 'video',
          'user',
          selectedAudioInputId || undefined
        );
        const actualType: CallType = hasVideo ? 'video' : 'audio';
        const callId = crypto.randomUUID();

        localStreamRef.current = stream;
        activeCallIdRef.current = callId;
        activePeerRef.current = targetPeer;
        pendingIceRef.current = [];

        setLocalStream(stream);
        setPeer(targetPeer);
        setCallType(actualType);
        setAudioMuted(false);
        setVideoEnabled(hasVideo);
        setScreenSharing(false);
        setFacingMode('user');
        setPeerVideoEnabled(actualType === 'video');
        setPeerAudioMuted(false);
        setPeerRinging(false);
        setPeerQueued(false);
        setPeerPushSent(false);
        setIsMinimized(false);
        setPhase('outgoing');

        const pc = createPeerConnection(callId, targetPeer.id);
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);

        const sent = sendSignal({
          type: 'call:invite',
          callId,
          toId: targetPeer.id,
          callType: actualType,
          sdp: offer,
        });

        if (!sent) {
          cleanupCall();
          showNotice('Connexion temps réel indisponible. Réessayez dans un instant.');
          return;
        }

        startToneLoop('outgoing');

        ringTimeoutRef.current = window.setTimeout(() => {
          if (
            activeCallIdRef.current === callId &&
            phaseRef.current === 'outgoing'
          ) {
            sendSignal({
              type: 'call:hangup',
              callId,
              toId: targetPeer.id,
              reason: 'timeout',
            });
            cleanupCall();
            playCue('ended');
            showNotice(`${targetPeer.displayName} n'a pas répondu.`, {
              peer: targetPeer,
              callType: actualType,
              summary: 'Sans réponse',
            });
          }
        }, 45000);
      } catch (err) {
        cleanupCall();
        showNotice(
          err instanceof Error
            ? err.message
            : "Impossible d'accéder au microphone ou à la caméra."
        );
      }
    },
    [
      acquireMedia,
      cleanupCall,
      createPeerConnection,
      currentUserId,
      playCue,
      selectedAudioInputId,
      sendSignal,
      showNotice,
      startToneLoop,
    ]
  );

  const acceptIncomingCall = useCallback(
    async (withVideo?: boolean) => {
      const callId = activeCallIdRef.current;
      const caller = activePeerRef.current;
      const offer = pendingOfferRef.current;
      if (!callId || !caller || !offer) return;

      stopTones();
      if (ringTimeoutRef.current !== null) {
        window.clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }

      try {
        const wantVideo =
          typeof withVideo === 'boolean' ? withVideo : callType === 'video';
        const { stream, hasVideo } = await acquireMedia(
          wantVideo,
          'user',
          selectedAudioInputId || undefined
        );

        localStreamRef.current = stream;
        setLocalStream(stream);
        setAudioMuted(false);
        setVideoEnabled(hasVideo);
        setScreenSharing(false);
        setPhase('connecting');

        const pc = createPeerConnection(callId, caller.id);
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingIce(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal({
          type: 'call:accept',
          callId,
          toId: caller.id,
          sdp: answer,
        });

        sendSignal({
          type: 'call:media-state',
          callId,
          toId: caller.id,
          audioMuted: false,
          videoEnabled: hasVideo,
        });
      } catch (err) {
        sendSignal({
          type: 'call:decline',
          callId,
          toId: caller.id,
          reason: 'media_error',
        });
        cleanupCall();
        showNotice(
          err instanceof Error
            ? err.message
            : "Impossible d'accéder au microphone pour répondre."
        );
      }
    },
    [
      acquireMedia,
      callType,
      cleanupCall,
      createPeerConnection,
      flushPendingIce,
      selectedAudioInputId,
      sendSignal,
      showNotice,
      stopTones,
    ]
  );

  const declineIncomingCall = useCallback(() => {
    const callId = activeCallIdRef.current;
    const caller = activePeerRef.current;
    if (callId && caller) {
      sendSignal({
        type: 'call:decline',
        callId,
        toId: caller.id,
        reason: 'declined',
      });
    }
    cleanupCall();
  }, [cleanupCall, sendSignal]);

  const hangupCall = useCallback(() => {
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;
    if (callId && currentPeer) {
      sendSignal({
        type: 'call:hangup',
        callId,
        toId: currentPeer.id,
        reason: 'hangup',
      });
    }
    cleanupCall();
    playCue('ended');
  }, [cleanupCall, playCue, sendSignal]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;
    if (!stream) return;

    const nextMuted = !audioMuted;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
    setAudioMuted(nextMuted);

    if (callId && currentPeer) {
      sendSignal({
        type: 'call:media-state',
        callId,
        toId: currentPeer.id,
        audioMuted: nextMuted,
        videoEnabled: videoEnabled || screenSharing,
      });
    }
  }, [audioMuted, screenSharing, sendSignal, videoEnabled]);

  const stopScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const stream = localStreamRef.current;
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;

    if (screenStreamRef.current) {
      for (const t of screenStreamRef.current.getTracks()) {
        t.stop();
      }
      screenStreamRef.current = null;
    }
    setScreenSharing(false);

    if (!pc || !stream) return;

    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    const backupCamTrack = cameraTrackBackupRef.current;
    cameraTrackBackupRef.current = null;

    if (backupCamTrack && backupCamTrack.readyState === 'live') {
      if (videoSender) {
        await videoSender.replaceTrack(backupCamTrack);
      }
      for (const oldT of stream.getVideoTracks()) {
        stream.removeTrack(oldT);
      }
      stream.addTrack(backupCamTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      setVideoEnabled(backupCamTrack.enabled);
      if (callId && currentPeer) {
        sendSignal({
          type: 'call:media-state',
          callId,
          toId: currentPeer.id,
          audioMuted,
          videoEnabled: backupCamTrack.enabled,
        });
      }
    } else {
      for (const oldT of stream.getVideoTracks()) {
        oldT.stop();
        stream.removeTrack(oldT);
      }
      if (videoSender) {
        await videoSender.replaceTrack(null);
      }
      setLocalStream(new MediaStream(stream.getTracks()));
      setVideoEnabled(false);
      if (callId && currentPeer) {
        sendSignal({
          type: 'call:media-state',
          callId,
          toId: currentPeer.id,
          audioMuted,
          videoEnabled: false,
        });
      }
    }
  }, [audioMuted, sendSignal]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      await stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      showNotice("Le partage d'écran n'est pas pris en charge sur cet appareil.");
      return;
    }

    const pc = pcRef.current;
    const stream = localStreamRef.current;
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;
    if (!pc || !stream || !callId || !currentPeer) return;

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayStream;
      const existingCam = stream.getVideoTracks()[0] ?? null;
      cameraTrackBackupRef.current = existingCam;

      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
        for (const oldT of stream.getVideoTracks()) {
          stream.removeTrack(oldT);
        }
        stream.addTrack(screenTrack);
      } else {
        stream.addTrack(screenTrack);
        pc.addTrack(screenTrack, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({
          type: 'call:renegotiate',
          callId,
          toId: currentPeer.id,
          sdp: offer,
        });
      }

      screenTrack.onended = () => {
        void stopScreenShare();
      };

      setLocalStream(new MediaStream(stream.getTracks()));
      setScreenSharing(true);
      setCallType('video');
      sendSignal({
        type: 'call:media-state',
        callId,
        toId: currentPeer.id,
        audioMuted,
        videoEnabled: true,
      });
    } catch {
      // User cancelled screen picker
    }
  }, [audioMuted, screenSharing, sendSignal, showNotice, stopScreenShare]);

  const toggleVideo = useCallback(async () => {
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;
    if (!stream) return;

    if (screenSharing) {
      await stopScreenShare();
      return;
    }

    const existingVideoTracks = stream.getVideoTracks();
    if (existingVideoTracks.length > 0) {
      const nextEnabled = !videoEnabled;
      for (const track of existingVideoTracks) {
        track.enabled = nextEnabled;
      }
      setVideoEnabled(nextEnabled);
      if (callId && currentPeer) {
        sendSignal({
          type: 'call:media-state',
          callId,
          toId: currentPeer.id,
          audioMuted,
          videoEnabled: nextEnabled,
        });
      }
      return;
    }

    if (!videoEnabled && pc && callId && currentPeer) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: { ideal: facingMode },
          },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (!videoTrack) return;

        const existingSender = pc
          .getSenders()
          .find((s) => s.track === null && s.dtmf === null);
        stream.addTrack(videoTrack);
        if (existingSender) {
          await existingSender.replaceTrack(videoTrack);
        } else {
          pc.addTrack(videoTrack, stream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({
            type: 'call:renegotiate',
            callId,
            toId: currentPeer.id,
            sdp: offer,
          });
        }

        setLocalStream(new MediaStream(stream.getTracks()));
        setVideoEnabled(true);
        setCallType('video');
        sendSignal({
          type: 'call:media-state',
          callId,
          toId: currentPeer.id,
          audioMuted,
          videoEnabled: true,
        });
        await refreshDevices();
      } catch {
        showNotice('Caméra inaccessible sur cet appareil.');
      }
    }
  }, [
    audioMuted,
    facingMode,
    refreshDevices,
    screenSharing,
    sendSignal,
    showNotice,
    stopScreenShare,
    videoEnabled,
  ]);

  const switchCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    if (!stream || !pc || !videoEnabled || screenSharing) return;

    const nextFacing: 'user' | 'environment' =
      facingMode === 'user' ? 'environment' : 'user';

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { exact: nextFacing },
        },
      });
      const newTrack = camStream.getVideoTracks()[0];
      if (!newTrack) return;

      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
      }
      for (const oldTrack of stream.getVideoTracks()) {
        oldTrack.stop();
        stream.removeTrack(oldTrack);
      }
      stream.addTrack(newTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      setFacingMode(nextFacing);
    } catch {
      showNotice('Changement de caméra indisponible sur cet appareil.');
    }
  }, [facingMode, screenSharing, showNotice, videoEnabled]);

  const selectAudioInput = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInputId(deviceId);
      const stream = localStreamRef.current;
      const pc = pcRef.current;
      if (!stream || !pc) return;

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        const newTrack = micStream.getAudioTracks()[0];
        if (!newTrack) return;
        newTrack.enabled = !audioMuted;

        const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (audioSender) {
          await audioSender.replaceTrack(newTrack);
        }
        for (const oldTrack of stream.getAudioTracks()) {
          oldTrack.stop();
          stream.removeTrack(oldTrack);
        }
        stream.addTrack(newTrack);
        setLocalStream(new MediaStream(stream.getTracks()));
      } catch {
        showNotice('Impossible de changer de microphone.');
      }
    },
    [audioMuted, showNotice]
  );

  const selectAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
  }, []);

  const handleCallSignal = useCallback(
    async (payload: CallSignalPayload) => {
      if (!payload.type.startsWith('call:') || !payload.callId) return;

      if (payload.type === 'call:invite' && payload.fromId && payload.sdp) {
        if (phaseRef.current !== 'idle') {
          if (activeCallIdRef.current === payload.callId) return;
          sendSignal({
            type: 'call:decline',
            callId: payload.callId,
            toId: payload.fromId,
            reason: 'busy',
          });
          return;
        }

        const caller =
          payload.caller ?? (await resolveUser(payload.fromId));
        if (!caller) return;

        activeCallIdRef.current = payload.callId;
        activePeerRef.current = caller;
        pendingOfferRef.current = payload.sdp;
        pendingIceRef.current = [];

        const incomingType: CallType =
          payload.callType === 'video' ? 'video' : 'audio';
        setPeer(caller);
        setCallType(incomingType);
        setPeerVideoEnabled(incomingType === 'video');
        setPeerAudioMuted(false);
        setIsMinimized(false);
        setPhase('incoming');

        sendSignal({
          type: 'call:ringing',
          callId: payload.callId,
          toId: caller.id,
        });

        startToneLoop('incoming');

        ringTimeoutRef.current = window.setTimeout(() => {
          if (
            activeCallIdRef.current === payload.callId &&
            phaseRef.current === 'incoming'
          ) {
            cleanupCall();
            showNotice(`Appel manqué de ${caller.displayName}.`, {
              peer: caller,
              callType: incomingType,
              summary: 'Appel manqué',
            });
          }
        }, 45000);
        return;
      }

      if (payload.callId !== activeCallIdRef.current) return;

      if (payload.type === 'call:queued') {
        setPeerQueued(true);
        setPeerPushSent(Boolean(payload.pushSent));
        return;
      }

      if (payload.type === 'call:ringing') {
        setPeerRinging(true);
        setPeerQueued(false);
        return;
      }

      if (payload.type === 'call:accept' && payload.sdp && pcRef.current) {
        stopTones();
        if (ringTimeoutRef.current !== null) {
          window.clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
        }
        setPhase('connecting');
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(payload.sdp)
        );
        await flushPendingIce(pcRef.current);
        return;
      }

      if (
        payload.type === 'call:renegotiate' &&
        payload.sdp &&
        pcRef.current &&
        payload.fromId
      ) {
        const pc = pcRef.current;
        if (payload.sdp.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: 'call:renegotiate',
            callId: payload.callId,
            toId: payload.fromId,
            sdp: answer,
          });
        } else if (payload.sdp.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc);
        }
        return;
      }

      if (payload.type === 'call:ice' && payload.candidate) {
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {
            // Ignore invalid ICE candidate
          }
        } else {
          pendingIceRef.current.push(payload.candidate);
        }
        return;
      }

      if (payload.type === 'call:media-state') {
        if (typeof payload.audioMuted === 'boolean') {
          setPeerAudioMuted(payload.audioMuted);
        }
        if (typeof payload.videoEnabled === 'boolean') {
          setPeerVideoEnabled(payload.videoEnabled);
        }
        return;
      }

      if (payload.type === 'call:decline') {
        const p = activePeerRef.current;
        const cType = activeCallTypeRef.current;
        const currentPeerName = p?.displayName || 'Contact';
        cleanupCall();
        playCue('ended');
        if (payload.reason === 'busy') {
          showNotice(`${currentPeerName} est déjà en ligne.`, p ? { peer: p, callType: cType, summary: 'Ligne occupée' } : null);
        } else if (payload.reason === 'blocked') {
          showNotice('Appel bloqué par les paramètres de confidentialité.');
        } else {
          showNotice(`${currentPeerName} a refusé l'appel.`, p ? { peer: p, callType: cType, summary: 'Appel refusé' } : null);
        }
        return;
      }

      if (payload.type === 'call:hangup') {
        const wasIncoming = phaseRef.current === 'incoming';
        const p = activePeerRef.current;
        const cType = activeCallTypeRef.current;
        const callerName = p?.displayName || 'Contact';
        cleanupCall();
        playCue('ended');
        if (wasIncoming) {
          showNotice(`Appel manqué de ${callerName}.`, p ? { peer: p, callType: cType, summary: 'Appel manqué' } : null);
        } else if (payload.reason === 'timeout') {
          showNotice('Aucune réponse.', p ? { peer: p, callType: cType, summary: 'Sans réponse' } : null);
        } else {
          showNotice('Appel terminé.');
        }
      }
    },
    [
      cleanupCall,
      flushPendingIce,
      playCue,
      resolveUser,
      sendSignal,
      showNotice,
      startToneLoop,
      stopTones,
    ]
  );

  return {
    phase,
    callType,
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
    setIsMinimized,
    dismissNotice: () => {
      setNotice(null);
      setEndedPrompt(null);
    },
    startCall,
    acceptIncomingCall,
    declineIncomingCall,
    hangupCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    switchCamera,
    selectAudioInput,
    selectAudioOutput,
    handleCallSignal,
  };
}
