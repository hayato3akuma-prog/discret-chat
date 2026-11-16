import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Eye,
  Lock,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Square,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { type CallSignalPayload, useWebRTCCall } from '../hooks/useWebRTCCall';
import { getFreshFirebaseIdToken } from '../lib/firebase';
import { showLocalServiceWorkerNotification } from '../lib/pushNotifications';
import {
  decryptAndVerifyGroupMessage,
  decryptAndVerifyMessage,
  encryptAndSignGroupMessage,
  encryptAndSignMessage,
  getCanonicalConversationId,
  importGroupAesKey,
  unwrapGroupKeyBytes,
} from '../lib/crypto';
import {
  acceptFriendRequestInFirestore,
  blockUserInFirestore,
  declineFriendRequestInFirestore,
  deleteDirectMessageInFirestore,
  deleteGroupMessageInFirestore,
  dispatchPushNotification,
  fetchPublicProfile,
  markConversationReadInFirestore,
  openConversationInFirestore,
  removeFriendInFirestore,
  sendDirectMessageInFirestore,
  sendFriendRequestInFirestore,
  sendGroupMessageInFirestore,
  subscribeConversations,
  subscribeDirectMessages,
  subscribeFriendsSnapshot,
  subscribeGroupMessages,
  subscribeGroups,
  unblockUserInFirestore,
} from '../lib/firestoreStore';
import type {
  DecryptedMessage,
  EncryptedMessageEnvelope,
  EphemeralDuration,
  FriendsSnapshot,
  GlassIntensity,
  GroupInfo,
  GroupMessageEnvelope,
  PublicUser,
  RelationshipState,
  UnlockedSession,
} from '../types';
import { AppInstallModal, PWAInstallButton } from './AppInstallModal';
import { CallOverlay } from './CallOverlay';
import { CreateGroupModal } from './CreateGroupModal';
import { FriendsModal } from './FriendsModal';
import { GroupAvatar } from './GroupAvatar';
import { GroupInfoModal } from './GroupInfoModal';
import { NewContactModal } from './NewContactModal';
import { NotificationsModal } from './NotificationsModal';
import { PeerProfileModal } from './PeerProfileModal';
import { ProfileBanner } from './ProfileBanner';
import { ProfileModal } from './ProfileModal';
import { SecurityModal } from './SecurityModal';
import { TONE_CLASSES, UserAvatar } from './UserAvatar';

interface ChatWorkspaceProps {
  session: UnlockedSession;
  onUpdateUser: (user: PublicUser) => void;
  onLockSession: () => void;
  onOpenPresentation?: () => void;
}

interface SidebarConversation {
  peer: PublicUser;
  lastMessagePreview: string | null;
  lastTimestamp: number | null;
  unreadCount: number;
}

interface SidebarGroup {
  group: GroupInfo;
  lastMessagePreview: string | null;
  lastTimestamp: number | null;
}

type ActiveTarget =
  | { kind: 'dm'; peer: PublicUser }
  | { kind: 'group'; group: GroupInfo };

const EPHEMERAL_OPTIONS: { value: EphemeralDuration; label: string }[] = [
  { value: 0, label: 'Permanent' },
  { value: 30, label: '30 sec' },
  { value: 300, label: '5 min' },
  { value: 86400, label: '24 h' },
];

const GLASS_PREF_KEY = 'discret_glass_intensity_v1';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRemaining(expiresAt: number, now: number): string {
  const diffSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.ceil(diffSec / 60)}m`;
  return `${Math.ceil(diffSec / 3600)}h`;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  session,
  onUpdateUser,
  onLockSession,
  onOpenPresentation,
}) => {
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [groups, setGroups] = useState<SidebarGroup[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);

  const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [sidebarFilter, setSidebarFilter] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'all' | 'direct' | 'groups'>('all');
  const [ephemeralDuration, setEphemeralDuration] = useState<EphemeralDuration>(0);
  const [inspectorMode, setInspectorMode] = useState(false);

  const [glassIntensity, setGlassIntensity] = useState<GlassIntensity>(() => {
    const saved = window.localStorage.getItem(GLASS_PREF_KEY);
    if (saved === 'subtle' || saved === 'balanced' || saved === 'deep') {
      return saved;
    }
    return 'balanced';
  });

  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isFriendsModalOpen, setIsFriendsModalOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [viewedProfileUser, setViewedProfileUser] = useState<PublicUser | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);

  const push = usePushNotifications(session.token);
  const pushStateRef = useRef({
    isSubscribed: push.isSubscribed,
    permission: push.permission,
    discreetMode: push.discreetMode,
  });

  useEffect(() => {
    pushStateRef.current = {
      isSubscribed: push.isSubscribed,
      permission: push.permission,
      discreetMode: push.discreetMode,
    };
  }, [push.isSubscribed, push.permission, push.discreetMode]);

  const [friendsSnapshot, setFriendsSnapshot] = useState<FriendsSnapshot>({
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: [],
    blockedByIds: [],
  });

  const [typingPeers, setTypingPeers] = useState<Record<string, boolean>>({});
  const [typingGroups, setTypingGroups] = useState<Record<string, string | null>>({});
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const activeTargetRef = useRef<ActiveTarget | null>(null);
  const groupsRef = useRef<SidebarGroup[]>([]);
  const conversationsRef = useRef<SidebarConversation[]>([]);
  const groupKeysCacheRef = useRef<Map<string, CryptoKey>>(new Map());
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const knownMsgIdsRef = useRef<Set<string>>(new Set());
  const animatedNewMsgIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialBatchRef = useRef<boolean>(false);

  useEffect(() => {
    activeTargetRef.current = activeTarget;
  }, [activeTarget]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const sendCallSignal = useCallback(
    (payload: Record<string, unknown>) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
      const enriched =
        payload.type === 'call:invite'
          ? { ...payload, caller: session.user }
          : payload;
      wsRef.current.send(JSON.stringify(enriched));
      return true;
    },
    [session.user]
  );

  const resolveCallUser = useCallback(async (userId: string): Promise<PublicUser | null> => {
    const fromConv = conversationsRef.current.find(
      (c) => c.peer.id === userId
    )?.peer;
    if (fromConv) return fromConv;

    try {
      return await fetchPublicProfile(userId);
    } catch {
      return null;
    }
  }, []);

  const call = useWebRTCCall({
    currentUserId: session.user.id,
    sendSignal: sendCallSignal,
    resolveUser: resolveCallUser,
  });

  const handleCallSignalRef = useRef(call.handleCallSignal);
  useEffect(() => {
    handleCallSignalRef.current = call.handleCallSignal;
  }, [call.handleCallSignal]);

  const tts = useTextToSpeech();
  const ttsSpeakRef = useRef(tts.speakMessage);
  const ttsStopRef = useRef(tts.stop);
  const ttsAutoReadRef = useRef(tts.autoRead);
  const callPhaseRef = useRef(call.phase);

  useEffect(() => {
    ttsSpeakRef.current = tts.speakMessage;
    ttsStopRef.current = tts.stop;
    ttsAutoReadRef.current = tts.autoRead;
  }, [tts.speakMessage, tts.stop, tts.autoRead]);

  useEffect(() => {
    callPhaseRef.current = call.phase;
    if (call.phase !== 'idle') {
      ttsStopRef.current();
    }
  }, [call.phase]);

  const handleLockSession = useCallback(() => {
    tts.stop();
    onLockSession();
  }, [tts, onLockSession]);

  function handleChangeGlassIntensity(val: GlassIntensity) {
    setGlassIntensity(val);
    try {
      window.localStorage.setItem(GLASS_PREF_KEY, val);
    } catch {
      // Ignore storage error
    }
  }

  // Tick every second when ephemeral messages exist
  useEffect(() => {
    const hasEphemeral = messages.some((m) => m.expiresAt !== null);
    if (!hasEphemeral) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      setMessages((prev) =>
        prev.filter((m) => m.expiresAt === null || m.expiresAt > now)
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [messages]);

  const getGroupAesKey = useCallback(
    async (group: GroupInfo): Promise<CryptoKey | null> => {
      const cached = groupKeysCacheRef.current.get(group.id);
      if (cached) return cached;

      const myEnvelope = group.keyEnvelopes[session.user.id];
      if (!myEnvelope) return null;

      let wrapperPub = group.members.find(
        (m) => m.id === myEnvelope.wrappedByUserId
      )?.ecdhPublicJwk;

      if (!wrapperPub) {
        const wrapperProfile = await fetchPublicProfile(myEnvelope.wrappedByUserId);
        if (wrapperProfile) {
          wrapperPub = wrapperProfile.ecdhPublicJwk;
        }
      }
      if (!wrapperPub) return null;

      const rawBytes = await unwrapGroupKeyBytes({
        myEcdhPrivateKey: session.ecdhPrivateKey,
        wrapperEcdhPublicJwk: wrapperPub,
        myUserId: session.user.id,
        wrappedByUserId: myEnvelope.wrappedByUserId,
        iv: myEnvelope.iv,
        wrappedKey: myEnvelope.wrappedKey,
      });

      const key = await importGroupAesKey(rawBytes);
      groupKeysCacheRef.current.set(group.id, key);
      return key;
    },
    [session]
  );

  const decryptEnvelope = useCallback(
    async (
      env: EncryptedMessageEnvelope,
      peer: PublicUser
    ): Promise<DecryptedMessage> => {
      const senderEcdsaPublicJwk =
        env.fromId === session.user.id
          ? session.user.ecdsaPublicJwk
          : peer.ecdsaPublicJwk;

      const result = await decryptAndVerifyMessage({
        id: env.id,
        conversationId: env.conversationId,
        fromId: env.fromId,
        toId: env.toId,
        ciphertext: env.ciphertext,
        iv: env.iv,
        signature: env.signature,
        timestamp: env.timestamp,
        myEcdhPrivateKey: session.ecdhPrivateKey,
        peerEcdhPublicJwk: peer.ecdhPublicJwk,
        senderEcdsaPublicJwk,
      });

      return {
        id: env.id,
        conversationId: env.conversationId,
        fromId: env.fromId,
        toId: env.toId,
        text: result.text,
        timestamp: env.timestamp,
        expiresAt: env.expiresAt,
        readAt: env.readAt,
        verified: result.verified,
        decryptionError: result.error,
        rawCiphertext: env.ciphertext,
        rawIv: env.iv,
        rawSignature: env.signature,
      };
    },
    [session]
  );

  const decryptGroupEnvelope = useCallback(
    async (
      env: GroupMessageEnvelope,
      group: GroupInfo,
      fallbackSender?: PublicUser
    ): Promise<DecryptedMessage> => {
      const groupKey = await getGroupAesKey(group);
      const sender =
        group.members.find((m) => m.id === env.fromId) ?? fallbackSender;

      if (!groupKey) {
        return {
          id: env.id,
          conversationId: group.id,
          fromId: env.fromId,
          toId: group.id,
          groupId: group.id,
          sender,
          text: 'Clé de groupe indisponible',
          timestamp: env.timestamp,
          expiresAt: env.expiresAt,
          readAt: null,
          verified: false,
          decryptionError: true,
          rawCiphertext: env.ciphertext,
          rawIv: env.iv,
          rawSignature: env.signature,
        };
      }

      const result = await decryptAndVerifyGroupMessage({
        id: env.id,
        groupId: env.groupId,
        fromId: env.fromId,
        ciphertext: env.ciphertext,
        iv: env.iv,
        signature: env.signature,
        timestamp: env.timestamp,
        groupAesKey: groupKey,
        senderEcdsaPublicJwk: sender?.ecdsaPublicJwk,
      });

      return {
        id: env.id,
        conversationId: group.id,
        fromId: env.fromId,
        toId: group.id,
        groupId: group.id,
        sender,
        text: result.text,
        timestamp: env.timestamp,
        expiresAt: env.expiresAt,
        readAt: null,
        verified: result.verified,
        decryptionError: result.error,
        rawCiphertext: env.ciphertext,
        rawIv: env.iv,
        rawSignature: env.signature,
      };
    },
    [getGroupAesKey]
  );

  const markConversationRead = useCallback(
    async (peerId: string) => {
      if (peerId === session.user.id) return;
      try {
        await markConversationReadInFirestore(session.user.id, peerId);
        setConversations((prev) =>
          prev.map((c) => (c.peer.id === peerId ? { ...c, unreadCount: 0 } : c))
        );
      } catch {
        // Ignore
      }
    },
    [session.user.id]
  );

  // Real-time Firestore subscriptions for conversations, groups & friends
  useEffect(() => {
    const unsubConvs = subscribeConversations(session.user.id, (summaries) => {
      void Promise.all(
        summaries.map(async (conv) => {
          let preview: string | null = null;
          if (conv.lastMessage) {
            const dec = await decryptEnvelope(conv.lastMessage, conv.peer);
            preview = dec.text;
          }
          return {
            peer: conv.peer,
            lastMessagePreview: preview,
            lastTimestamp: conv.lastMessage?.timestamp ?? null,
            unreadCount: conv.unreadCount,
          };
        })
      ).then((items) => {
        setConversations(items);
        setLoadingConversations(false);
        if (!activeTargetRef.current && items.length > 0) {
          setActiveTarget({ kind: 'dm', peer: items[0].peer });
        }
      });
    });

    const unsubGroups = subscribeGroups(session.user.id, (groupList) => {
      void Promise.all(
        groupList.map(async (g) => {
          let preview: string | null = null;
          if (g.lastMessage) {
            const dec = await decryptGroupEnvelope(g.lastMessage, g);
            const prefix =
              dec.fromId === session.user.id
                ? 'Vous : '
                : dec.sender
                  ? `${dec.sender.displayName} : `
                  : '';
            preview = `${prefix}${dec.text}`;
          }
          return {
            group: g,
            lastMessagePreview: preview,
            lastTimestamp: g.lastMessage?.timestamp ?? g.createdAt,
          };
        })
      ).then((items) => {
        setGroups(items);
        const cur = activeTargetRef.current;
        if (cur?.kind === 'group') {
          const updatedGroup = items.find((i) => i.group.id === cur.group.id)?.group;
          if (updatedGroup) {
            setActiveTarget({ kind: 'group', group: updatedGroup });
          } else {
            groupKeysCacheRef.current.delete(cur.group.id);
            setActiveTarget(null);
            setIsGroupInfoOpen(false);
            setMobileShowChat(false);
          }
        }
      });
    });

    const unsubFriends = subscribeFriendsSnapshot(session.user.id, (snapshot) => {
      setFriendsSnapshot(snapshot);
    });

    return () => {
      unsubConvs();
      unsubGroups();
      unsubFriends();
    };
  }, [session.user.id, decryptEnvelope, decryptGroupEnvelope]);

  const activeTargetId =
    activeTarget?.kind === 'dm'
      ? `dm:${activeTarget.peer.id}`
      : activeTarget?.kind === 'group'
        ? `group:${activeTarget.group.id}`
        : null;

  // Real-time Firestore subscription for active thread messages
  useEffect(() => {
    knownMsgIdsRef.current = new Set();
    animatedNewMsgIdsRef.current = new Set();
    hasLoadedInitialBatchRef.current = false;
    ttsStopRef.current();

    const target = activeTargetRef.current;
    if (!target) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);

    const recordMessageBatch = (
      list: DecryptedMessage[],
      resolveSpeaker?: (msg: DecryptedMessage) => string | undefined
    ) => {
      if (!hasLoadedInitialBatchRef.current) {
        hasLoadedInitialBatchRef.current = true;
        for (const m of list) {
          knownMsgIdsRef.current.add(m.id);
        }
        return;
      }

      const newlyArrived: DecryptedMessage[] = [];
      for (const m of list) {
        if (!knownMsgIdsRef.current.has(m.id)) {
          knownMsgIdsRef.current.add(m.id);
          animatedNewMsgIdsRef.current.add(m.id);
          newlyArrived.push(m);
        }
      }

      if (
        newlyArrived.length > 0 &&
        ttsAutoReadRef.current &&
        callPhaseRef.current === 'idle'
      ) {
        const incomingSpeakable = newlyArrived.filter(
          (m) =>
            m.fromId !== session.user.id &&
            !m.decryptionError &&
            m.text.trim().length > 0
        );
        const latest = incomingSpeakable[incomingSpeakable.length - 1];
        if (latest) {
          ttsSpeakRef.current(latest.id, latest.text, resolveSpeaker?.(latest));
        }
      }
    };

    if (target.kind === 'dm') {
      const peer = target.peer;
      const unsub = subscribeDirectMessages(session.user.id, peer.id, (envs) => {
        void Promise.all(envs.map((env) => decryptEnvelope(env, peer))).then(
          (decrypted) => {
            if (cancelled) return;
            recordMessageBatch(decrypted, () => peer.displayName);
            setMessages(decrypted);
            setLoadingMessages(false);
            const hasUnread = decrypted.some(
              (m) =>
                m.toId === session.user.id &&
                m.fromId !== session.user.id &&
                m.readAt === null
            );
            if (hasUnread) {
              void markConversationRead(peer.id);
            }
          }
        );
      });
      return () => {
        cancelled = true;
        ttsStopRef.current();
        unsub();
      };
    }

    const group = target.group;
    const unsub = subscribeGroupMessages(group.id, (envs) => {
      const latestGroup =
        groupsRef.current.find((g) => g.group.id === group.id)?.group ?? group;
      void Promise.all(envs.map((env) => decryptGroupEnvelope(env, latestGroup))).then(
        (decrypted) => {
          if (cancelled) return;
          recordMessageBatch(decrypted, (m) => m.sender?.displayName);
          setMessages(decrypted);
          setLoadingMessages(false);
        }
      );
    });
    return () => {
      cancelled = true;
      ttsStopRef.current();
      unsub();
    };
  }, [
    activeTargetId,
    session.user.id,
    decryptEnvelope,
    decryptGroupEnvelope,
    markConversationRead,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeTargetId]);

  // Real-time WebSocket connection for WebRTC call signaling & live typing indicators
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    async function connect() {
      const freshToken = (await getFreshFirebaseIdToken()) || session.token;
      if (closedByUser) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(
        freshToken
      )}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type: string;
            groupId?: string;
            fromId?: string;
            isTyping?: boolean;
            callId?: string;
            caller?: PublicUser;
            callType?: 'audio' | 'video';
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
            reason?: string;
            audioMuted?: boolean;
            videoEnabled?: boolean;
          };

          if (payload.type.startsWith('call:')) {
            void handleCallSignalRef.current(payload as CallSignalPayload);
            return;
          }

          if (payload.type === 'typing:state' && payload.fromId) {
            if (payload.groupId) {
              const grp = groupsRef.current.find(
                (item) => item.group.id === payload.groupId
              )?.group;
              const senderName =
                grp?.members.find((m) => m.id === payload.fromId)?.displayName ??
                null;
              setTypingGroups((prev) => ({
                ...prev,
                [payload.groupId!]: payload.isTyping ? senderName : null,
              }));
            } else {
              setTypingPeers((prev) => ({
                ...prev,
                [payload.fromId!]: Boolean(payload.isTyping),
              }));
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!closedByUser) {
          const delay = Math.min(1000 * Math.pow(1.6, attempt), 10000);
          attempt += 1;
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, delay);
        }
      };
    }

    void connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [session.token]);

  const openFromNotificationData = useCallback(
    async (data: { type?: string; peerId?: string; groupId?: string } | null | undefined) => {
      if (!data) return;
      if (data.type === 'friend_request') {
        setIsFriendsModalOpen(true);
        return;
      }
      if (typeof data.groupId === 'string' && data.groupId) {
        const existingGroup = groupsRef.current.find(
          (g) => g.group.id === data.groupId
        )?.group;
        if (existingGroup) {
          setActiveTarget({ kind: 'group', group: existingGroup });
          setMobileShowChat(true);
        }
        return;
      }
      if (typeof data.peerId === 'string' && data.peerId) {
        const existingPeer = conversationsRef.current.find(
          (c) => c.peer.id === data.peerId
        )?.peer;
        if (existingPeer) {
          setActiveTarget({ kind: 'dm', peer: existingPeer });
          setMobileShowChat(true);
          return;
        }
        const fetchedPeer = await fetchPublicProfile(data.peerId).catch(() => null);
        if (fetchedPeer) {
          setActiveTarget({ kind: 'dm', peer: fetchedPeer });
          setMobileShowChat(true);
        }
      }
    },
    []
  );

  // Listen for Service Worker notification clicks & initial URL deep-link params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openKind = params.get('open');
    const peerIdParam = params.get('peerId');
    const groupIdParam = params.get('groupId');
    if (openKind) {
      if (openKind === 'friends') {
        void openFromNotificationData({ type: 'friend_request' });
      } else if (openKind === 'dm' && peerIdParam) {
        void openFromNotificationData({ type: 'dm', peerId: peerIdParam });
      } else if (openKind === 'group' && groupIdParam) {
        void openFromNotificationData({ type: 'group', groupId: groupIdParam });
      }
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'discret:notification-click') {
        void openFromNotificationData(event.data.data);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [openFromNotificationData]);

  function getRelationship(userId: string): RelationshipState {
    if (userId === session.user.id) return 'self';
    if (friendsSnapshot.blocked.some((b) => b.id === userId)) return 'blocked_by_me';
    if (friendsSnapshot.blockedByIds.includes(userId)) return 'blocked_by_peer';
    if (friendsSnapshot.friends.some((f) => f.id === userId)) return 'friend';
    if (friendsSnapshot.incoming.some((r) => r.fromUser.id === userId)) {
      return 'incoming_pending';
    }
    if (friendsSnapshot.outgoing.some((r) => r.toUser.id === userId)) {
      return 'outgoing_pending';
    }
    return 'none';
  }

  async function handleSendFriendRequest(targetUserId: string) {
    const status = await sendFriendRequestInFirestore(session.user.id, targetUserId);
    if (status === 'requested') {
      void dispatchPushNotification({
        targetUserIds: [targetUserId],
        title: `Demande d'ami • ${session.user.displayName}`,
        body: `${session.user.handle} souhaite rejoindre vos contacts DISCRET.`,
        discreetTitle: 'DISCRET',
        discreetBody: 'Nouvelle demande de contact reçue',
        tag: `friend-req-${session.user.id}`,
        data: { url: '/?open=friends', type: 'friend_request', fromUserId: session.user.id },
      });
    }
  }

  async function handleAcceptFriendRequest(fromUserId: string) {
    await acceptFriendRequestInFirestore(session.user.id, fromUserId);
    void dispatchPushNotification({
      targetUserIds: [fromUserId],
      title: `Demande acceptée • ${session.user.displayName}`,
      body: `${session.user.displayName} fait maintenant partie de votre liste d'amis.`,
      discreetTitle: 'DISCRET',
      discreetBody: 'Une demande de contact a été acceptée',
      tag: `friend-acc-${session.user.id}`,
      data: {
        url: `/?open=dm&peerId=${encodeURIComponent(session.user.id)}`,
        type: 'friend_accepted',
        peerId: session.user.id,
      },
    });
  }

  async function handleDeclineFriendRequest(userId: string) {
    await declineFriendRequestInFirestore(session.user.id, userId);
  }

  async function handleRemoveFriend(userId: string) {
    await removeFriendInFirestore(session.user.id, userId);
  }

  async function handleBlockUser(targetUserId: string) {
    await blockUserInFirestore(session.user.id, targetUserId);
  }

  async function handleUnblockUser(targetUserId: string) {
    await unblockUserInFirestore(session.user.id, targetUserId);
  }

  function emitTyping(isTyping: boolean) {
    if (!activeTarget) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (activeTarget.kind === 'dm') {
      if (activeTarget.peer.id === session.user.id) return;
      wsRef.current.send(
        JSON.stringify({
          type: 'typing:state',
          toId: activeTarget.peer.id,
          isTyping,
        })
      );
    } else {
      wsRef.current.send(
        JSON.stringify({
          type: 'typing:state',
          groupId: activeTarget.group.id,
          memberIds: activeTarget.group.members.map((m) => m.id),
          isTyping,
        })
      );
    }
  }

  function handleComposerChange(val: string) {
    setComposerText(val);
    emitTyping(val.trim().length > 0);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      emitTyping(false);
    }, 2200);
  }

  async function handleSendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activeTarget || sending) return;
    const trimmed = composerText.trim();
    if (!trimmed) return;

    setSending(true);
    setSendError(null);
    emitTyping(false);

    try {
      const id = window.crypto.randomUUID();
      const timestamp = Date.now();

      if (activeTarget.kind === 'dm') {
        const peer = activeTarget.peer;
        const encrypted = await encryptAndSignMessage({
          id,
          fromId: session.user.id,
          toId: peer.id,
          plaintext: trimmed,
          timestamp,
          myEcdhPrivateKey: session.ecdhPrivateKey,
          myEcdsaPrivateKey: session.ecdsaPrivateKey,
          peerEcdhPublicJwk: peer.ecdhPublicJwk,
        });

        const optimistic: DecryptedMessage = {
          id,
          conversationId: encrypted.conversationId,
          fromId: session.user.id,
          toId: peer.id,
          text: trimmed,
          timestamp,
          expiresAt:
            ephemeralDuration > 0 ? Date.now() + ephemeralDuration * 1000 : null,
          readAt: peer.id === session.user.id ? timestamp : null,
          verified: true,
          rawCiphertext: encrypted.ciphertext,
          rawIv: encrypted.iv,
          rawSignature: encrypted.signature,
        };

        knownMsgIdsRef.current.add(id);
        animatedNewMsgIdsRef.current.add(id);
        setMessages((prev) =>
          prev.some((m) => m.id === id) ? prev : [...prev, optimistic]
        );
        setComposerText('');

        const savedEnv = await sendDirectMessageInFirestore({
          id,
          fromId: session.user.id,
          toId: peer.id,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          signature: encrypted.signature,
          timestamp,
          ttlSeconds: ephemeralDuration,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, expiresAt: savedEnv.expiresAt } : m
          )
        );

        if (peer.id !== session.user.id) {
          void dispatchPushNotification({
            targetUserIds: [peer.id],
            title: `Nouveau message de ${session.user.displayName}`,
            body: 'Message chiffré reçu • Appuyez pour déchiffrer',
            discreetTitle: 'DISCRET',
            discreetBody: 'Nouveau message chiffré reçu',
            tag: `dm-msg-${id}`,
            data: {
              url: `/?open=dm&peerId=${encodeURIComponent(session.user.id)}`,
              type: 'dm',
              peerId: session.user.id,
              messageId: id,
            },
          });
        }
      } else {
        const group = activeTarget.group;
        const groupKey = await getGroupAesKey(group);
        if (!groupKey) {
          throw new Error('Clé de chiffrement du groupe introuvable.');
        }

        const encrypted = await encryptAndSignGroupMessage({
          id,
          groupId: group.id,
          fromId: session.user.id,
          plaintext: trimmed,
          timestamp,
          groupAesKey: groupKey,
          myEcdsaPrivateKey: session.ecdsaPrivateKey,
        });

        const optimistic: DecryptedMessage = {
          id,
          conversationId: group.id,
          fromId: session.user.id,
          toId: group.id,
          groupId: group.id,
          sender: session.user,
          text: trimmed,
          timestamp,
          expiresAt:
            ephemeralDuration > 0 ? Date.now() + ephemeralDuration * 1000 : null,
          readAt: null,
          verified: true,
          rawCiphertext: encrypted.ciphertext,
          rawIv: encrypted.iv,
          rawSignature: encrypted.signature,
        };

        knownMsgIdsRef.current.add(id);
        animatedNewMsgIdsRef.current.add(id);
        setMessages((prev) =>
          prev.some((m) => m.id === id) ? prev : [...prev, optimistic]
        );
        setComposerText('');

        const savedGroupEnv = await sendGroupMessageInFirestore({
          id,
          groupId: group.id,
          fromId: session.user.id,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          signature: encrypted.signature,
          timestamp,
          ttlSeconds: ephemeralDuration,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, expiresAt: savedGroupEnv.expiresAt } : m
          )
        );

        const recipientIds = group.members
          .map((m) => m.id)
          .filter((mid) => mid !== session.user.id);
        if (recipientIds.length > 0) {
          void dispatchPushNotification({
            targetUserIds: recipientIds,
            title: `${group.name} • ${session.user.displayName}`,
            body: 'Nouveau message de groupe chiffré',
            discreetTitle: 'DISCRET',
            discreetBody: 'Nouvelle activité de groupe chiffrée',
            tag: `group-msg-${id}`,
            data: {
              url: `/?open=group&groupId=${encodeURIComponent(group.id)}`,
              type: 'group',
              groupId: group.id,
              messageId: id,
            },
          });
        }
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Erreur d'envoi.");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteMessage(msg: DecryptedMessage) {
    try {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      if (msg.groupId) {
        await deleteGroupMessageInFirestore(msg.groupId, msg.id);
      } else {
        await deleteDirectMessageInFirestore(msg.conversationId, msg.id);
      }
    } catch {
      // Snapshot listener restores authoritative state if deletion fails
    }
  }

  async function handleCopyOwnHandle() {
    try {
      await navigator.clipboard.writeText(session.user.handle);
      setCopiedHandle(true);
      setTimeout(() => setCopiedHandle(false), 1800);
    } catch {
      // Ignore
    }
  }

  async function handleSelectPeer(peer: PublicUser) {
    try {
      await openConversationInFirestore(session.user.id, peer.id);
    } catch {
      // Continue opening locally
    }
    setActiveTarget({ kind: 'dm', peer });
    setMobileShowChat(true);
    setConversations((prev) => {
      if (prev.some((c) => c.peer.id === peer.id)) {
        return prev.map((c) =>
          c.peer.id === peer.id ? { ...c, unreadCount: 0 } : c
        );
      }
      return [
        {
          peer,
          lastMessagePreview: null,
          lastTimestamp: null,
          unreadCount: 0,
        },
        ...prev,
      ];
    });
  }

  function handleSelectGroup(group: GroupInfo) {
    setActiveTarget({ kind: 'group', group });
    setMobileShowChat(true);
    setGroups((prev) => {
      if (prev.some((item) => item.group.id === group.id)) {
        return prev.map((item) =>
          item.group.id === group.id ? { ...item, group } : item
        );
      }
      return [
        {
          group,
          lastMessagePreview: null,
          lastTimestamp: group.createdAt,
        },
        ...prev,
      ];
    });
  }

  type UnifiedSidebarItem =
    | {
        kind: 'dm';
        id: string;
        sortTs: number;
        conv: SidebarConversation;
      }
    | {
        kind: 'group';
        id: string;
        sortTs: number;
        sg: SidebarGroup;
      };

  const visibleSidebarItems = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    const list: UnifiedSidebarItem[] = [];

    if (sidebarTab === 'all' || sidebarTab === 'direct') {
      for (const conv of conversations) {
        if (
          !q ||
          conv.peer.displayName.toLowerCase().includes(q) ||
          conv.peer.handle.toLowerCase().includes(q)
        ) {
          list.push({
            kind: 'dm',
            id: `dm:${conv.peer.id}`,
            sortTs: conv.lastTimestamp ?? (conv.peer.id === session.user.id ? 1 : 0),
            conv,
          });
        }
      }
    }

    if (sidebarTab === 'all' || sidebarTab === 'groups') {
      for (const sg of groups) {
        if (
          !q ||
          sg.group.name.toLowerCase().includes(q) ||
          (sg.group.description ?? '').toLowerCase().includes(q)
        ) {
          list.push({
            kind: 'group',
            id: `group:${sg.group.id}`,
            sortTs: sg.lastTimestamp ?? sg.group.createdAt,
            sg,
          });
        }
      }
    }

    return list.sort((a, b) => b.sortTs - a.sortTs);
  }, [conversations, groups, sidebarFilter, sidebarTab, session.user.id]);

  const activePeer = activeTarget?.kind === 'dm' ? activeTarget.peer : null;
  const activeGroup = activeTarget?.kind === 'group' ? activeTarget.group : null;
  const isSelfSelected = activePeer?.id === session.user.id;
  const isPeerTyping = Boolean(
    activePeer && activePeer.id !== session.user.id && typingPeers[activePeer.id]
  );
  const activeGroupTypingUser = activeGroup ? typingGroups[activeGroup.id] : null;

  const myTone =
    TONE_CLASSES[session.user.accentTone ?? 'platinum'] ?? TONE_CLASSES.platinum;

  const glassSurfaceClass =
    glassIntensity === 'subtle'
      ? 'bg-white/[0.015] backdrop-blur-md'
      : glassIntensity === 'deep'
        ? 'bg-white/[0.045] backdrop-blur-3xl'
        : 'bg-white/[0.025] backdrop-blur-2xl';

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#050507] text-[#F4F4F5] flex">
      {/* Subtle monochrome smoked glass depth */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[460px] w-[620px] rounded-full bg-white/[0.03] blur-[140px]" />
        <div className="absolute bottom-0 right-1/5 h-[380px] w-[480px] rounded-full bg-slate-300/[0.02] blur-[130px]" />
      </div>

      {/* Left Sidebar: Conversations, Groups & Identity */}
      <aside
        className={`relative z-10 flex h-full w-full md:w-[328px] lg:w-[356px] shrink-0 flex-col border-r border-white/[0.08] ${glassSurfaceClass} ${
          mobileShowChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Top App Wordmark + Actions */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          {onOpenPresentation ? (
            <button
              type="button"
              onClick={onOpenPresentation}
              title="Voir la page de présentation de DISCRET"
              className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wider text-white hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              DISCRET
            </button>
          ) : (
            <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wider text-white">
              DISCRET
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              title="Personnaliser le profil"
              aria-label="Personnaliser le profil"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsNotificationsModalOpen(true)}
              title="Notifications push en arrière-plan"
              aria-label="Notifications push"
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              {push.isSubscribed && push.permission === 'granted' ? (
                <BellRing className="h-4 w-4 text-emerald-400" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
              {push.isSubscribed && push.permission === 'granted' ? (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setIsFriendsModalOpen(true)}
              title="Liste d'amis et demandes"
              aria-label="Liste d'amis et demandes"
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              {friendsSnapshot.incoming.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 font-mono text-[10px] font-bold text-zinc-950 tabular-nums">
                  {friendsSnapshot.incoming.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsCreateGroupOpen(true)}
              title="Créer un groupe chiffré"
              aria-label="Créer un groupe chiffré"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <Users className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsContactModalOpen(true)}
              title="Nouvelle discussion directe"
              aria-label="Nouvelle discussion directe"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleLockSession}
              title="Verrouiller la session et effacer les clés de la mémoire"
              aria-label="Verrouiller la session"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
            >
              <Lock className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* User Profile Card with Banner */}
        <div className="relative overflow-hidden border-b border-white/[0.07]">
          <ProfileBanner
            user={session.user}
            className="h-14"
            scrimClassName="bg-gradient-to-b from-black/25 via-black/45 to-[#08080b]/95"
          />
          <div className="relative -mt-6 flex items-end justify-between gap-2.5 px-4 pb-3.5">
            <button
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              className="flex items-end gap-3 min-w-0 flex-1 text-left rounded-xl p-1 -m-1 hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <div className="rounded-full p-0.5 bg-[#09090C] border border-white/15 shrink-0">
                <UserAvatar user={session.user} size="sm" />
              </div>
              <div className="min-w-0 flex-1 pb-0.5">
                <span className="block font-[family-name:var(--font-display)] text-sm font-semibold text-white truncate">
                  {session.user.displayName}
                </span>
                <p className="text-[11px] text-zinc-400 truncate">
                  {session.user.bio || 'Appuyez pour personnaliser'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCopyOwnHandle}
              title="Copier votre identifiant public"
              className="shrink-0 min-h-[34px] flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-zinc-300 hover:bg-white/[0.09] hover:text-white transition-colors cursor-pointer"
            >
              <span className="max-w-[92px] truncate">{session.user.handle}</span>
              {copiedHandle ? (
                <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="h-3 w-3 shrink-0 opacity-60" />
              )}
            </button>
          </div>
        </div>

        {/* Filter & Segmented Tabs */}
        <div className="px-3.5 pt-3 pb-2 space-y-2.5">
          <div className="relative flex items-center glass-input rounded-xl">
            <Search className="ml-3 h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <input
              type="text"
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
              placeholder="Filtrer discussions et groupes..."
              className="w-full bg-transparent px-2.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.03] p-1 border border-white/[0.06]">
            {(
              [
                { key: 'all', label: 'Tout' },
                { key: 'direct', label: 'Directs' },
                { key: 'groups', label: `Groupes (${groups.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSidebarTab(t.key)}
                className={`rounded-lg py-1.5 px-2 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  sidebarTab === t.key
                    ? 'bg-white text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Unified Thread List */}
        <div className="flex-1 overflow-y-auto px-2.5 pb-4 space-y-1">
          {loadingConversations ? (
            <div className="space-y-2 px-2 pt-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-white/[0.03] animate-pulse"
                />
              ))}
            </div>
          ) : visibleSidebarItems.length === 0 ? (
            <div className="px-4 py-10 text-center space-y-3">
              <p className="text-xs text-zinc-500">
                {sidebarTab === 'groups'
                  ? 'Aucun groupe pour le moment.'
                  : 'Aucune conversation trouvée.'}
              </p>
              <button
                type="button"
                onClick={() =>
                  sidebarTab === 'groups'
                    ? setIsCreateGroupOpen(true)
                    : setIsContactModalOpen(true)
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs font-medium text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>
                  {sidebarTab === 'groups'
                    ? 'Créer un groupe'
                    : 'Ajouter un contact'}
                </span>
              </button>
            </div>
          ) : (
            visibleSidebarItems.map((item) => {
              if (item.kind === 'dm') {
                const { conv } = item;
                const isSelf = conv.peer.id === session.user.id;
                const isSelected = activeTargetId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectPeer(conv.peer)}
                    className={`w-full min-h-[60px] flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-white/[0.08] border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]'
                        : 'border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <UserAvatar
                      user={conv.peer}
                      isSelfVault={isSelf}
                      size="md"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-white truncate">
                          {isSelf ? 'Notes chiffrées' : conv.peer.displayName}
                        </span>
                        {conv.lastTimestamp && (
                          <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                            {formatTime(conv.lastTimestamp)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="text-xs text-zinc-400 truncate">
                          {conv.lastMessagePreview ??
                            (isSelf
                              ? 'Coffre-fort personnel'
                              : conv.peer.bio || conv.peer.handle)}
                        </p>
                        {conv.unreadCount > 0 && (
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-white bg-white/15 px-1.5 py-0.5 rounded-md tabular-nums">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              }

              const { sg } = item;
              const isSelected = activeTargetId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectGroup(sg.group)}
                  className={`w-full min-h-[60px] flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-white/[0.08] border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]'
                      : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <GroupAvatar group={sg.group} size="md" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-white truncate">
                        {sg.group.name}
                      </span>
                      {sg.lastTimestamp && (
                        <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                          {formatTime(sg.lastTimestamp)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="text-xs text-zinc-400 truncate">
                        {sg.lastMessagePreview ??
                          `${sg.group.members.length} membre${
                            sg.group.members.length > 1 ? 's' : ''
                          }${sg.group.description ? ` · ${sg.group.description}` : ''}`}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Bottom quick actions + Desktop/Phone App Installer */}
        <div className="border-t border-white/[0.07] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setIsContactModalOpen(true)}
              className="min-h-[42px] flex items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 px-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Contact</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFriendsModalOpen(true)}
              className="relative min-h-[42px] flex items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 px-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span>Amis</span>
              {friendsSnapshot.incoming.length > 0 && (
                <span className="font-mono text-[10px] font-semibold bg-white text-zinc-950 px-1.5 rounded-full tabular-nums">
                  {friendsSnapshot.incoming.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsCreateGroupOpen(true)}
              className="min-h-[42px] flex items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 px-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span>Groupe</span>
            </button>
          </div>
          <PWAInstallButton onOpenModal={() => setIsInstallModalOpen(true)} />
        </div>
      </aside>

      {/* Right Chat Viewport */}
      <main
        className={`relative z-10 flex-1 flex flex-col h-full min-w-0 ${
          !mobileShowChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        {activeTarget ? (
          <>
            {/* Conversation Header */}
            <header
              className={`flex items-center justify-between gap-3 border-b border-white/[0.08] ${glassSurfaceClass} px-3 sm:px-6 py-3`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileShowChat(false)}
                  aria-label="Retour aux conversations"
                  className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-300 hover:bg-white/[0.06] hover:text-white cursor-pointer"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                {activePeer ? (
                  <button
                    type="button"
                    onClick={() => setViewedProfileUser(activePeer)}
                    title="Voir le profil"
                    className="flex items-center gap-2.5 sm:gap-3 min-w-0 text-left rounded-xl p-1 -m-1 hover:bg-white/[0.04] transition-colors cursor-pointer"
                  >
                    <UserAvatar
                      user={activePeer}
                      isSelfVault={isSelfSelected}
                      size="sm"
                    />

                    <div className="min-w-0">
                      <h1 className="font-[family-name:var(--font-display)] text-sm sm:text-base font-semibold text-white truncate">
                        {isSelfSelected
                          ? 'Notes chiffrées (Coffre personnel)'
                          : activePeer.displayName}
                      </h1>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="font-mono truncate">{activePeer.handle}</span>
                        {isPeerTyping && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="whitespace-nowrap text-zinc-200">
                              Écrit...
                            </span>
                          </>
                        )}
                        {!isSelfSelected && !isPeerTyping && activePeer.bio && (
                          <>
                            <span className="hidden lg:inline" aria-hidden="true">
                              ·
                            </span>
                            <span className="hidden lg:inline truncate max-w-[240px]">
                              {activePeer.bio}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ) : activeGroup ? (
                  <button
                    type="button"
                    onClick={() => setIsGroupInfoOpen(true)}
                    className="flex items-center gap-2.5 sm:gap-3 min-w-0 text-left rounded-xl p-1 -m-1 hover:bg-white/[0.04] transition-colors cursor-pointer"
                  >
                    <GroupAvatar group={activeGroup} size="sm" />

                    <div className="min-w-0">
                      <h1 className="font-[family-name:var(--font-display)] text-sm sm:text-base font-semibold text-white truncate">
                        {activeGroup.name}
                      </h1>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="whitespace-nowrap">
                          {activeGroup.members.length} membre
                          {activeGroup.members.length > 1 ? 's' : ''}
                        </span>
                        {activeGroupTypingUser ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="whitespace-nowrap text-zinc-200">
                              {activeGroupTypingUser} écrit...
                            </span>
                          </>
                        ) : activeGroup.description ? (
                          <>
                            <span className="hidden lg:inline" aria-hidden="true">
                              ·
                            </span>
                            <span className="hidden lg:inline truncate max-w-[240px]">
                              {activeGroup.description}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ) : null}
              </div>

              {/* Right Controls: Ephemeral Timer & Verification / Group Members */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
                  <Clock className="ml-2 mr-1 h-3.5 w-3.5 text-zinc-400" />
                  {EPHEMERAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEphemeralDuration(opt.value)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        ephemeralDuration === opt.value
                          ? 'bg-white text-zinc-950'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {tts.supported && (
                  <button
                    type="button"
                    onClick={tts.toggleAutoRead}
                    title={
                      tts.autoRead
                        ? 'Désactiver la lecture vocale automatique (locale)'
                        : 'Activer la lecture vocale automatique des nouveaux messages (locale)'
                    }
                    aria-label={
                      tts.autoRead
                        ? 'Désactiver la lecture vocale automatique'
                        : 'Activer la lecture vocale automatique'
                    }
                    aria-pressed={tts.autoRead}
                    className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border px-2.5 py-2 transition-colors cursor-pointer ${
                      tts.autoRead
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.09] hover:text-white'
                    }`}
                  >
                    {tts.autoRead ? (
                      <Volume2 className="h-4 w-4" />
                    ) : (
                      <VolumeX className="h-4 w-4" />
                    )}
                  </button>
                )}

                {activePeer ? (
                  <div className="flex items-center gap-1.5">
                    {!isSelfSelected &&
                      getRelationship(activePeer.id) !== 'blocked_by_me' &&
                      getRelationship(activePeer.id) !== 'blocked_by_peer' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void call.startCall(activePeer, 'audio')}
                            disabled={call.phase !== 'idle'}
                            title="Appel audio en temps réel"
                            aria-label="Appel audio en temps réel"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-2.5 py-2 text-zinc-200 hover:bg-white/[0.1] hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                          >
                            <Phone className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void call.startCall(activePeer, 'video')}
                            disabled={call.phase !== 'idle'}
                            title="Appel vidéo en temps réel"
                            aria-label="Appel vidéo en temps réel"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-2.5 py-2 text-zinc-200 hover:bg-white/[0.1] hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                          >
                            <Video className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    <button
                      type="button"
                      onClick={() => setIsSecurityModalOpen(true)}
                      className="min-h-[40px] flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.09] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span className="hidden sm:inline">Vérifier E2EE</span>
                    </button>
                  </div>
                ) : activeGroup ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setInspectorMode((v) => !v)}
                      title="Inspecter les paquets chiffrés"
                      className={`min-h-[40px] flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        inspectorMode
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.09]'
                      }`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsGroupInfoOpen(true)}
                      className="min-h-[40px] flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.09] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Users className="h-4 w-4 text-zinc-200" />
                      <span className="hidden sm:inline">Membres</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            {/* Local Web Speech Playback & Speed Control Bar */}
            {tts.supported && (tts.speakingMessageId !== null || tts.autoRead) && (
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-emerald-500/[0.04] px-4 sm:px-6 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 text-emerald-300">
                  <Volume2
                    className={`h-3.5 w-3.5 shrink-0 ${
                      tts.speakingMessageId !== null ? 'animate-pulse' : ''
                    }`}
                  />
                  <span className="truncate font-medium">
                    {tts.speakingMessageId !== null
                      ? 'Synthèse vocale locale en cours'
                      : 'Lecture vocale auto activée'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={tts.cycleRate}
                    title="Changer la vitesse de lecture vocale"
                    aria-label={`Vitesse de lecture ${tts.rate}x`}
                    className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-200 hover:bg-white/[0.1] transition-colors tabular-nums cursor-pointer"
                  >
                    {tts.rate}×
                  </button>
                  {tts.speakingMessageId !== null && (
                    <button
                      type="button"
                      onClick={tts.stop}
                      title="Arrêter la lecture vocale"
                      aria-label="Arrêter la lecture vocale"
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      <span>Arrêter</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Mobile Ephemeral Selector Bar */}
            <div className="sm:hidden flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.015] px-4 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Clock className="h-3 w-3" />
                <span>Auto-destruction</span>
              </span>
              <div className="flex items-center gap-1">
                {EPHEMERAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEphemeralDuration(opt.value)}
                    className={`min-h-[30px] rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      ephemeralDuration === opt.value
                        ? 'bg-white text-zinc-950'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-3">
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-xs text-zinc-500">
                    Déchiffrement local des messages...
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="glass-surface max-w-md w-full overflow-hidden rounded-2xl text-center">
                    {activePeer ? (
                      <>
                        <ProfileBanner user={activePeer} className="h-24" />
                        <div className="px-6 pb-6">
                          <div className="-mt-7 mx-auto mb-3 inline-flex rounded-full p-1 bg-[#0a0a0e] border border-white/10">
                            <UserAvatar
                              user={activePeer}
                              isSelfVault={isSelfSelected}
                              size="md"
                            />
                          </div>
                          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-white">
                            {isSelfSelected
                              ? 'Votre coffre de notes chiffrées'
                              : `Canal chiffré avec ${activePeer.displayName}`}
                          </h2>
                          {!isSelfSelected && activePeer.biography && (
                            <p className="mt-2 text-xs text-zinc-300 leading-relaxed whitespace-pre-line line-clamp-3">
                              {activePeer.biography}
                            </p>
                          )}
                          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                            {isSelfSelected
                              ? 'Enregistrez ici vos notes privées. Elles sont chiffrées localement avec votre clé avant d’être stockées.'
                              : 'Chaque message est chiffré en AES-256-GCM via votre secret partagé ECDH P-256 et signé numériquement.'}
                          </p>
                        </div>
                      </>
                    ) : activeGroup ? (
                      <>
                        <ProfileBanner
                          user={{
                            displayName: activeGroup.name,
                            bannerPreset: activeGroup.bannerPreset,
                            bannerDataUrl: activeGroup.bannerDataUrl ?? null,
                          }}
                          className="h-24"
                        />
                        <div className="px-6 pb-6">
                          <div className="-mt-8 mx-auto mb-3 inline-flex rounded-2xl p-1 bg-[#0a0a0e] border border-white/15">
                            <GroupAvatar group={activeGroup} size="md" />
                          </div>
                          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-white">
                            {activeGroup.name}
                          </h2>
                          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                            Groupe chiffré de bout en bout ({activeGroup.members.length}{' '}
                            membre{activeGroup.members.length > 1 ? 's' : ''}). La clé AES-256-GCM du groupe est protégée par ECDH P-256 pour chaque membre.
                          </p>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.fromId === session.user.id;
                  const showGroupSender = Boolean(msg.groupId && !isMine && msg.sender);
                  const isNewEntry = animatedNewMsgIdsRef.current.has(msg.id);

                  return (
                    <div
                      key={msg.id}
                      className={`group flex flex-col ${
                        isNewEntry ? 'animate-msg-enter' : 'animate-msg-history'
                      } ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      {showGroupSender && msg.sender && (
                        <button
                          type="button"
                          onClick={() => setViewedProfileUser(msg.sender!)}
                          className="mb-1 ml-1 flex items-center gap-1.5 hover:opacity-90 cursor-pointer"
                        >
                          <UserAvatar user={msg.sender} size="sm" />
                          <span className="text-xs font-medium text-zinc-300 hover:text-white">
                            {msg.sender.displayName}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {msg.sender.handle}
                          </span>
                        </button>
                      )}

                      <div
                        className={`relative max-w-[85%] sm:max-w-[68%] rounded-2xl px-4 py-2.5 backdrop-blur-xl transition-colors ${
                          isMine
                            ? `${myTone.bubbleBg} border ${myTone.bubbleBorder} text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]`
                            : 'bg-white/[0.04] border border-white/[0.08] text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]'
                        }`}
                      >
                        <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                          {msg.text}
                        </p>

                        {inspectorMode && (
                          <div className="mt-2.5 pt-2 border-t border-white/[0.1] font-mono text-[10px] text-zinc-400 space-y-1 break-all">
                            <div>
                              <span className="text-zinc-500">AES-256-GCM: </span>
                              <span>{msg.rawCiphertext}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500">IV: </span>
                              <span>{msg.rawIv}</span>
                            </div>
                          </div>
                        )}

                        <div
                          className={`mt-1.5 flex items-center gap-2 text-[11px] ${
                            isMine ? 'text-zinc-300/80 justify-end' : 'text-zinc-500'
                          }`}
                        >
                          <span className="font-mono tabular-nums">
                            {formatTime(msg.timestamp)}
                          </span>

                          {msg.verified && (
                            <span
                              title="Signature ECDSA vérifiée"
                              className="inline-flex items-center gap-0.5 text-emerald-400/90"
                            >
                              <UserCheck className="h-3 w-3" />
                            </span>
                          )}

                          {msg.expiresAt !== null && (
                            <span className="inline-flex items-center gap-1 font-mono text-amber-300/90 tabular-nums">
                              <Clock className="h-3 w-3" />
                              {formatRemaining(msg.expiresAt, nowTick)}
                            </span>
                          )}

                          {isMine && activePeer && !isSelfSelected && (
                            <span
                              title={msg.readAt ? 'Lu' : 'Envoyé'}
                              className="inline-flex items-center"
                            >
                              {msg.readAt ? (
                                <CheckCheck className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Check className="h-3.5 w-3.5 text-zinc-400" />
                              )}
                            </span>
                          )}

                          {tts.supported && !msg.decryptionError && msg.text.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const speakerPrefix = isMine
                                  ? undefined
                                  : msg.groupId
                                    ? msg.sender?.displayName
                                    : activePeer?.displayName;
                                tts.speakMessage(msg.id, msg.text, speakerPrefix);
                              }}
                              title={
                                tts.speakingMessageId === msg.id
                                  ? 'Arrêter la lecture'
                                  : 'Écouter ce message (synthèse vocale locale)'
                              }
                              aria-label={
                                tts.speakingMessageId === msg.id
                                  ? 'Arrêter la lecture du message'
                                  : 'Écouter ce message'
                              }
                              className={`ml-1 inline-flex items-center justify-center rounded transition-opacity cursor-pointer ${
                                tts.speakingMessageId === msg.id
                                  ? 'opacity-100 text-emerald-400'
                                  : 'opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-zinc-400 hover:text-white'
                              }`}
                            >
                              {tts.speakingMessageId === msg.id ? (
                                <Square className="h-3 w-3 fill-current" />
                              ) : (
                                <Volume2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}

                          {(isMine ||
                            isSelfSelected ||
                            activeGroup?.creatorId === session.user.id) && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg)}
                              title="Supprimer pour tous"
                              aria-label="Supprimer le message"
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 ml-1 text-zinc-400 hover:text-red-400 transition-opacity cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {(isPeerTyping || activeGroupTypingUser) && (
                <div className="flex items-start">
                  <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-2.5 text-xs text-zinc-400">
                    {activePeer
                      ? `${activePeer.displayName} écrit...`
                      : `${activeGroupTypingUser} écrit...`}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <footer
              className={`border-t border-white/[0.08] ${glassSurfaceClass} px-3 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}
            >
              {activePeer &&
              !isSelfSelected &&
              (getRelationship(activePeer.id) === 'blocked_by_me' ||
                getRelationship(activePeer.id) === 'blocked_by_peer') ? (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-red-400 shrink-0" />
                    <span>
                      {getRelationship(activePeer.id) === 'blocked_by_me'
                        ? 'Vous avez bloqué cet utilisateur. Les messages sont désactivés.'
                        : 'Les échanges avec cet utilisateur sont actuellement restreints.'}
                    </span>
                  </div>
                  {getRelationship(activePeer.id) === 'blocked_by_me' && (
                    <button
                      type="button"
                      onClick={() => handleUnblockUser(activePeer.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/[0.14] bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.15] transition-colors shrink-0 cursor-pointer"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                      <span>Débloquer</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {sendError && (
                    <p className="mb-2 text-xs text-red-400">{sendError}</p>
                  )}
                  <form
                    onSubmit={handleSendMessage}
                    className="flex items-end gap-2.5 sm:gap-3"
                  >
                    <div className="flex-1 glass-input rounded-2xl px-4 py-2.5 flex items-center gap-2">
                      <textarea
                        rows={1}
                        value={composerText}
                        onChange={(e) => handleComposerChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder={
                          ephemeralDuration > 0
                            ? `Message éphémère chiffré (${
                                EPHEMERAL_OPTIONS.find(
                                  (o) => o.value === ephemeralDuration
                                )?.label
                              })...`
                            : activeGroup
                              ? `Écrire dans ${activeGroup.name}...`
                              : 'Écrire un message chiffré de bout en bout...'
                        }
                        className="w-full resize-none bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none max-h-32"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!composerText.trim() || sending}
                      aria-label="Envoyer le message"
                      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-white px-4 sm:px-5 text-sm font-medium text-zinc-950 transition-all hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">Envoyer</span>
                    </button>
                  </form>
                </>
              )}
            </footer>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="glass-surface max-w-sm rounded-2xl p-6 text-center space-y-4">
              <Lock className="mx-auto h-6 w-6 text-zinc-300" />
              <p className="text-sm text-zinc-300">
                Sélectionnez une discussion, ajoutez un contact ou créez un groupe chiffré.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Contact</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
                >
                  <Users className="h-4 w-4" />
                  <span>Groupe</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <NewContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        token={session.token}
        currentUser={session.user}
        onSelectPeer={handleSelectPeer}
        onViewProfile={(u) => setViewedProfileUser(u)}
      />

      <FriendsModal
        isOpen={isFriendsModalOpen}
        onClose={() => setIsFriendsModalOpen(false)}
        token={session.token}
        currentUser={session.user}
        snapshot={friendsSnapshot}
        getRelationship={getRelationship}
        onViewProfile={(u) => setViewedProfileUser(u)}
        onStartChat={handleSelectPeer}
        onSendRequest={handleSendFriendRequest}
        onAcceptRequest={handleAcceptFriendRequest}
        onDeclineRequest={handleDeclineFriendRequest}
        onRemoveFriend={handleRemoveFriend}
        onBlockUser={handleBlockUser}
        onUnblockUser={handleUnblockUser}
      />

      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        session={session}
        friends={friendsSnapshot.friends}
        onGroupCreated={(group) => handleSelectGroup(group)}
      />

      <GroupInfoModal
        isOpen={isGroupInfoOpen}
        onClose={() => setIsGroupInfoOpen(false)}
        group={activeGroup}
        session={session}
        onViewProfile={(u) => setViewedProfileUser(u)}
        onGroupUpdated={(updated) => {
          setGroups((prev) =>
            prev.map((item) =>
              item.group.id === updated.id ? { ...item, group: updated } : item
            )
          );
          if (activeTarget?.kind === 'group' && activeTarget.group.id === updated.id) {
            setActiveTarget({ kind: 'group', group: updated });
          }
        }}
        onGroupLeft={(groupId) => {
          groupKeysCacheRef.current.delete(groupId);
          setGroups((prev) => prev.filter((item) => item.group.id !== groupId));
          if (activeTarget?.kind === 'group' && activeTarget.group.id === groupId) {
            setActiveTarget(
              conversations.length > 0
                ? { kind: 'dm', peer: conversations[0].peer }
                : null
            );
            setMobileShowChat(false);
          }
        }}
        onGroupDeleted={(groupId) => {
          groupKeysCacheRef.current.delete(groupId);
          setGroups((prev) => prev.filter((item) => item.group.id !== groupId));
          if (activeTarget?.kind === 'group' && activeTarget.group.id === groupId) {
            setActiveTarget(
              conversations.length > 0
                ? { kind: 'dm', peer: conversations[0].peer }
                : null
            );
            setMobileShowChat(false);
          }
        }}
      />

      <SecurityModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
        currentUser={session.user}
        peer={activePeer}
        inspectorMode={inspectorMode}
        onToggleInspector={() => setInspectorMode((v) => !v)}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        token={session.token}
        user={session.user}
        glassIntensity={glassIntensity}
        onChangeGlassIntensity={handleChangeGlassIntensity}
        onProfileUpdated={(updated) => {
          onUpdateUser(updated);
          setConversations((prev) =>
            prev.map((c) =>
              c.peer.id === updated.id ? { ...c, peer: updated } : c
            )
          );
          if (activeTarget?.kind === 'dm' && activeTarget.peer.id === updated.id) {
            setActiveTarget({ kind: 'dm', peer: updated });
          }
        }}
      />

      <PeerProfileModal
        isOpen={viewedProfileUser !== null}
        onClose={() => setViewedProfileUser(null)}
        peer={viewedProfileUser}
        isSelf={viewedProfileUser?.id === session.user.id}
        relationship={
          viewedProfileUser ? getRelationship(viewedProfileUser.id) : 'none'
        }
        onOpenSecurity={
          activePeer && viewedProfileUser?.id === activePeer.id
            ? () => setIsSecurityModalOpen(true)
            : undefined
        }
        onStartChat={handleSelectPeer}
        onStartCall={(targetPeer, callType) => void call.startCall(targetPeer, callType)}
        onSendFriendRequest={handleSendFriendRequest}
        onAcceptFriendRequest={handleAcceptFriendRequest}
        onDeclineFriendRequest={handleDeclineFriendRequest}
        onRemoveFriend={handleRemoveFriend}
        onBlockUser={handleBlockUser}
        onUnblockUser={handleUnblockUser}
      />

      <AppInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />

      <NotificationsModal
        isOpen={isNotificationsModalOpen}
        onClose={() => setIsNotificationsModalOpen(false)}
        supported={push.supported}
        inIframe={push.inIframe}
        permission={push.permission}
        isSubscribed={push.isSubscribed}
        discreetMode={push.discreetMode}
        loading={push.loading}
        testing={push.testing}
        error={push.error}
        statusMessage={push.statusMessage}
        onEnable={push.enablePush}
        onDisable={push.disablePush}
        onToggleDiscreetMode={push.toggleDiscreetMode}
        onSendTest={push.sendTestPush}
      />

      <CallOverlay
        phase={call.phase}
        callType={call.callType}
        peer={call.peer}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        audioMuted={call.audioMuted}
        videoEnabled={call.videoEnabled}
        peerAudioMuted={call.peerAudioMuted}
        peerVideoEnabled={call.peerVideoEnabled}
        peerRinging={call.peerRinging}
        isMinimized={call.isMinimized}
        durationSec={call.durationSec}
        notice={call.notice}
        onDismissNotice={call.dismissNotice}
        onToggleMinimize={() => call.setIsMinimized((v) => !v)}
        onAccept={(withVideo) => void call.acceptIncomingCall(withVideo)}
        onDecline={call.declineIncomingCall}
        onHangup={call.hangupCall}
        onToggleMute={call.toggleMute}
        onToggleVideo={() => void call.toggleVideo()}
      />
    </div>
  );
};
