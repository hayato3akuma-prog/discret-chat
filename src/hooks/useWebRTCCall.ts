import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../types';

export type CallType = 'audio' | 'video';

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
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
}

interface UseWebRTCCallOptions {
  currentUserId: string;
  sendSignal: (payload: Record<string, unknown>) => boolean;
  resolveUser: (userId: string) => Promise<PublicUser | null>;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

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
  const [peerAudioMuted, setPeerAudioMuted] = useState(false);
  const [peerVideoEnabled, setPeerVideoEnabled] = useState(false);
  const [peerRinging, setPeerRinging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const activePeerRef = useRef<PublicUser | null>(null);
  const phaseRef = useRef<CallPhase>('idle');
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimeoutRef = useRef<number | null>(null);
  const toneIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 4500);
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

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
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

    setLocalStream(null);
    setRemoteStream(null);
    setPeer(null);
    setPhase('idle');
    setAudioMuted(false);
    setVideoEnabled(false);
    setPeerAudioMuted(false);
    setPeerVideoEnabled(false);
    setPeerRinging(false);
    setIsMinimized(false);
    setDurationSec(0);
  }, [stopTones]);

  // Call duration timer when connected
  useEffect(() => {
    if (phase !== 'connected') {
      setDurationSec(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setDurationSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
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

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          stopTones();
          if (ringTimeoutRef.current !== null) {
            window.clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
          }
          setPhase('connected');
        } else if (st === 'failed' || st === 'closed') {
          if (activeCallIdRef.current === callId) {
            cleanupCall();
            showNotice('Appel terminé (connexion interrompue).');
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          stopTones();
          if (ringTimeoutRef.current !== null) {
            window.clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
          }
          setPhase('connected');
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [cleanupCall, sendSignal, showNotice, stopTones]
  );

  const acquireMedia = useCallback(
    async (wantVideo: boolean): Promise<{ stream: MediaStream; hasVideo: boolean }> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Votre navigateur ou cet environnement ne permet pas l’accès au micro/caméra.'
        );
      }

      if (wantVideo) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            },
          });
          return { stream, hasVideo: true };
        } catch {
          // Fallback to audio-only if webcam is unavailable while mic works
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          showNotice('Caméra indisponible — appel lancé en audio uniquement.');
          return { stream: audioOnly, hasVideo: false };
        }
      }

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      return { stream: audioStream, hasVideo: false };
    },
    [showNotice]
  );

  const startCall = useCallback(
    async (targetPeer: PublicUser, requestedType: CallType) => {
      if (targetPeer.id === currentUserId) return;
      if (phaseRef.current !== 'idle') {
        showNotice('Un appel est déjà en cours.');
        return;
      }

      try {
        const { stream, hasVideo } = await acquireMedia(requestedType === 'video');
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
        setPeerVideoEnabled(actualType === 'video');
        setPeerRinging(false);
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
            showNotice(`${targetPeer.displayName} n'a pas répondu.`);
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
        const { stream, hasVideo } = await acquireMedia(wantVideo);

        localStreamRef.current = stream;
        setLocalStream(stream);
        setAudioMuted(false);
        setVideoEnabled(hasVideo);
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
  }, [cleanupCall, sendSignal]);

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
        videoEnabled,
      });
    }
  }, [audioMuted, sendSignal, videoEnabled]);

  const toggleVideo = useCallback(async () => {
    const stream = localStreamRef.current;
    const pc = pcRef.current;
    const callId = activeCallIdRef.current;
    const currentPeer = activePeerRef.current;
    if (!stream) return;

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

    // Upgrade audio-only call to video by acquiring camera + renegotiating
    if (!videoEnabled && pc && callId && currentPeer) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (!videoTrack) return;

        stream.addTrack(videoTrack);
        pc.addTrack(videoTrack, stream);
        setLocalStream(new MediaStream(stream.getTracks()));
        setVideoEnabled(true);
        setCallType('video');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({
          type: 'call:renegotiate',
          callId,
          toId: currentPeer.id,
          sdp: offer,
        });
        sendSignal({
          type: 'call:media-state',
          callId,
          toId: currentPeer.id,
          audioMuted,
          videoEnabled: true,
        });
      } catch {
        showNotice('Caméra inaccessible sur cet appareil.');
      }
    }
  }, [audioMuted, sendSignal, showNotice, videoEnabled]);

  const handleCallSignal = useCallback(
    async (payload: CallSignalPayload) => {
      if (!payload.type.startsWith('call:') || !payload.callId) return;

      if (payload.type === 'call:invite' && payload.fromId && payload.sdp) {
        if (phaseRef.current !== 'idle') {
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
            showNotice(`Appel manqué de ${caller.displayName}.`);
          }
        }, 45000);
        return;
      }

      if (payload.callId !== activeCallIdRef.current) return;

      if (payload.type === 'call:ringing') {
        setPeerRinging(true);
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

      if (payload.type === 'call:renegotiate' && payload.sdp && pcRef.current && payload.fromId) {
        const pc = pcRef.current;
        if (payload.sdp.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
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
        const currentPeerName = activePeerRef.current?.displayName || 'Contact';
        cleanupCall();
        if (payload.reason === 'busy') {
          showNotice(`${currentPeerName} est déjà en ligne.`);
        } else if (payload.reason === 'blocked') {
          showNotice('Appel bloqué par les paramètres de confidentialité.');
        } else {
          showNotice(`${currentPeerName} a refusé l'appel.`);
        }
        return;
      }

      if (payload.type === 'call:hangup') {
        const wasIncoming = phaseRef.current === 'incoming';
        const callerName = activePeerRef.current?.displayName || 'Contact';
        cleanupCall();
        if (wasIncoming) {
          showNotice(`Appel manqué de ${callerName}.`);
        } else if (payload.reason === 'timeout') {
          showNotice('Aucune réponse.');
        } else {
          showNotice('Appel terminé.');
        }
      }
    },
    [
      cleanupCall,
      flushPendingIce,
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
    peerAudioMuted,
    peerVideoEnabled,
    peerRinging,
    isMinimized,
    durationSec,
    notice,
    setIsMinimized,
    dismissNotice: () => setNotice(null),
    startCall,
    acceptIncomingCall,
    declineIncomingCall,
    hangupCall,
    toggleMute,
    toggleVideo,
    handleCallSignal,
  };
}
