import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  Bell,
  BellRing,
  Calculator,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Hourglass,
  ImagePlus,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Palette,
  Phone,
  Plus,
  Reply,
  Search,
  Send,
  Shield,
  ShieldCheck,
  ShieldOff,
  Square,
  SquarePen,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatAudioDuration, prepareVoiceAttachment } from '../lib/audioUtils';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { type CallSignalPayload, useWebRTCCall } from '../hooks/useWebRTCCall';
import { getAppThemeDefinition, useAppTheme } from '../lib/appTheme';
import { getBubbleClassNames, getMessageTextSizeClass } from '../lib/bubbleTheme';
import { getFreshFirebaseIdToken } from '../lib/firebase';
import { prepareChatMediaDataUrl } from '../lib/imageUtils';
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
  getContactDisplayName,
  hideThreadInFirestore,
  markConversationReadInFirestore,
  openConversationInFirestore,
  removeFriendInFirestore,
  sendDirectMessageInFirestore,
  sendFriendRequestInFirestore,
  sendGroupMessageInFirestore,
  setFriendAliasInFirestore,
  subscribeConversations,
  subscribeDirectMessages,
  subscribeFriendAliases,
  subscribeFriendsSnapshot,
  subscribeGroupMessages,
  subscribeGroups,
  subscribeHiddenThreads,
  unblockUserInFirestore,
  unhideThreadInFirestore,
} from '../lib/firestoreStore';
import type {
  ChatAttachment,
  DecryptedMessage,
  EncryptedMessageEnvelope,
  EphemeralDuration,
  FriendsSnapshot,
  GlassIntensity,
  GroupInfo,
  GroupMessageEnvelope,
  MessageTextSize,
  PublicUser,
  RelationshipState,
  ReplyReference,
  UnlockedSession,
} from '../types';
import { AppInstallModal } from './AppInstallModal';
import { CallOverlay } from './CallOverlay';
import { CamouflageScreen, normalizeCamouflageCode } from './CamouflageScreen';
import { CreateGroupModal } from './CreateGroupModal';
import { FriendsPanel } from './FriendsModal';
import { GroupAvatar } from './GroupAvatar';
import { GroupInfoModal } from './GroupInfoModal';
import { NewContactModal } from './NewContactModal';
import { NotificationsModal } from './NotificationsModal';
import { PeerProfileModal } from './PeerProfileModal';
import { ProfileBanner } from './ProfileBanner';
import { ProfileModal } from './ProfileModal';
import { SecurityModal } from './SecurityModal';
import { ThemeBackdrop } from './ThemeBackdrop';
import { ThemeGrid } from './ThemePicker';
import { UserAvatar } from './UserAvatar';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

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
const MSG_TEXT_SIZE_PREF_KEY = 'discret_msg_text_size_v1';
const CAMOUFLAGE_CODE_PREF_KEY = 'hoi_camouflage_code_v1';

function formatMessagePreviewText(
  text: string,
  attachment?: ChatAttachment,
  invisibleInk?: boolean,
  unlockAt?: number | null
): string {
  if (unlockAt && unlockAt > Date.now()) {
    return `Capsule temporelle · ${formatTime(unlockAt)}`;
  }
  if (invisibleInk) {
    return 'Message à encre invisible';
  }
  const clean = text.trim();
  if (attachment) {
    if (attachment.kind === 'audio') {
      const tag = attachment.voiceMasked
        ? 'Vocal anonymisé'
        : 'Message vocal';
      return clean ? `${tag} · ${clean}` : tag;
    }
    const tag = attachment.mimeType === 'image/gif' ? 'GIF animé' : 'Image';
    return clean ? `${tag} · ${clean}` : tag;
  }
  return text;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatUnlockCountdown(unlockAt: number, now: number): string {
  const diffSec = Math.max(0, Math.ceil((unlockAt - now) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${String(remMins).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}j ${remHours}h`;
}

function formatUnlockDateLabel(unlockAt: number): string {
  const d = new Date(unlockAt);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const timeStr = formatTime(unlockAt);
  if (sameDay) return `Aujourd’hui à ${timeStr}`;
  return `${d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })} à ${timeStr}`;
}

function toDatetimeLocalValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(ts: number): string {
  const target = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const diffDays = Math.round((todayStart - targetStart) / 86400000);
  if (diffDays === 0) return 'Aujourd’hui';
  if (diffDays === 1) return 'Hier';
  return target.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: target.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatRemaining(expiresAt: number, now: number): string {
  const diffSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.ceil(diffSec / 60)}m`;
  return `${Math.ceil(diffSec / 3600)}h`;
}

function getDmHiddenKey(peerId: string): string {
  return `dm_${peerId}`;
}

function getGroupHiddenKey(groupId: string): string {
  return `group_${groupId}`;
}

function isDmConversationHidden(
  conv: { peer: PublicUser; lastTimestamp: number | null },
  hiddenMap: Record<string, number>
): boolean {
  const hiddenAt = hiddenMap[getDmHiddenKey(conv.peer.id)];
  if (hiddenAt === undefined) return false;
  return conv.lastTimestamp === null || conv.lastTimestamp <= hiddenAt;
}

function isGroupConversationHidden(
  sg: { group: GroupInfo; lastTimestamp: number | null },
  hiddenMap: Record<string, number>
): boolean {
  const hiddenAt = hiddenMap[getGroupHiddenKey(sg.group.id)];
  if (hiddenAt === undefined) return false;
  return sg.lastTimestamp === null || sg.lastTimestamp <= hiddenAt;
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
  const [sidebarTab, setSidebarTab] = useState<'all' | 'direct' | 'groups' | 'friends'>('all');
  const [ephemeralDuration, setEphemeralDuration] = useState<EphemeralDuration>(0);
  const [ephemeralMenuOpen, setEphemeralMenuOpen] = useState(false);
  const [invisibleInk, setInvisibleInk] = useState(false);
  const [unlockAt, setUnlockAt] = useState<number | null>(null);
  const [customUnlockLocal, setCustomUnlockLocal] = useState('');
  const [revealedInkIds, setRevealedInkIds] = useState<Record<string, boolean>>({});
  const [shoulderShield, setShoulderShield] = useState(false);
  const [camouflageMode, setCamouflageMode] = useState(false);
  const [camouflageCode, setCamouflageCode] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(CAMOUFLAGE_CODE_PREF_KEY);
      const clean = saved ? normalizeCamouflageCode(saved) : '';
      if (clean.length >= 3) return clean;
    } catch {
      // Ignore storage errors
    }
    return '1337';
  });
  const [camouflageConfigOpen, setCamouflageConfigOpen] = useState(false);
  const [camouflageCodeDraft, setCamouflageCodeDraft] = useState('');
  const [camouflageCodeError, setCamouflageCodeError] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [voiceMaskEnabled, setVoiceMaskEnabled] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const [utilityThemeExpanded, setUtilityThemeExpanded] = useState(false);
  const [chatOptionsMenuOpen, setChatOptionsMenuOpen] = useState(false);
  const [inspectorMode, setInspectorMode] = useState(false);
  const [appTheme, setAppTheme] = useAppTheme();
  const currentAppTheme = getAppThemeDefinition(appTheme);

  const [hiddenThreads, setHiddenThreads] = useState<Record<string, number>>({});
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{
    threadKey: string;
    label: string;
    kind: 'dm' | 'group';
    targetId: string;
    lastTimestamp: number | null;
  } | null>(null);
  const [deletingThread, setDeletingThread] = useState(false);

  const [glassIntensity, setGlassIntensity] = useState<GlassIntensity>(() => {
    try {
      const saved = window.localStorage.getItem(GLASS_PREF_KEY);
      if (saved === 'subtle' || saved === 'balanced' || saved === 'deep') {
        return saved;
      }
    } catch {
      // Ignore storage access errors in restricted modes
    }
    return 'balanced';
  });

  const [messageTextSize, setMessageTextSize] = useState<MessageTextSize>(() => {
    try {
      const saved = window.localStorage.getItem(MSG_TEXT_SIZE_PREF_KEY);
      if (saved === 'compact' || saved === 'normal' || saved === 'large') {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    return 'normal';
  });

  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [viewedProfileUser, setViewedProfileUser] = useState<PublicUser | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);

  const pwaInstall = usePWAInstall();
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
  const [friendAliases, setFriendAliases] = useState<Record<string, string>>({});
  const friendAliasesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    friendAliasesRef.current = friendAliases;
  }, [friendAliases]);

  const [typingPeers, setTypingPeers] = useState<Record<string, boolean>>({});
  const [typingGroups, setTypingGroups] = useState<Record<string, string | null>>({});
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [lightboxMedia, setLightboxMedia] = useState<ChatAttachment | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatSearchQuery, setInChatSearchQuery] = useState('');
  const [activeSearchMatchIdx, setActiveSearchMatchIdx] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [unreadBelowCount, setUnreadBelowCount] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const activeTargetRef = useRef<ActiveTarget | null>(null);
  const groupsRef = useRef<SidebarGroup[]>([]);
  const conversationsRef = useRef<SidebarConversation[]>([]);
  const groupKeysCacheRef = useRef<Map<string, CryptoKey>>(new Map());
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const topDockRef = useRef<HTMLDivElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const [topDockHeight, setTopDockHeight] = useState(76);
  const [bottomDockHeight, setBottomDockHeight] = useState(84);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatMediaInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);
  const inChatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const chatOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const knownMsgIdsRef = useRef<Set<string>>(new Set());
  const animatedNewMsgIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialBatchRef = useRef<boolean>(false);
  const hiddenThreadsRef = useRef<Record<string, number>>({});
  const hiddenThreadsLoadedRef = useRef<boolean>(false);
  const didAutoSelectInitialRef = useRef<boolean>(false);
  const inkTimersRef = useRef<Record<string, number>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const voiceActionRef = useRef<'send' | 'cancel'>('cancel');
  const voiceMaskRef = useRef<boolean>(false);

  useEffect(() => {
    voiceMaskRef.current = voiceMaskEnabled;
  }, [voiceMaskEnabled]);

  useEffect(() => {
    if (!newMenuOpen && !chatOptionsMenuOpen && !utilityMenuOpen && !pendingDeleteThread) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (newMenuOpen && newMenuRef.current && !newMenuRef.current.contains(target)) {
        setNewMenuOpen(false);
      }
      if (
        chatOptionsMenuOpen &&
        chatOptionsMenuRef.current &&
        !chatOptionsMenuRef.current.contains(target)
      ) {
        setChatOptionsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNewMenuOpen(false);
        setChatOptionsMenuOpen(false);
        setUtilityMenuOpen(false);
        setPendingDeleteThread(null);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [newMenuOpen, chatOptionsMenuOpen, utilityMenuOpen, pendingDeleteThread]);

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

  useEffect(() => {
    document.documentElement.dataset.glassIntensity = glassIntensity;
  }, [glassIntensity]);

  function handleChangeGlassIntensity(val: GlassIntensity) {
    setGlassIntensity(val);
    try {
      window.localStorage.setItem(GLASS_PREF_KEY, val);
    } catch {
      // Ignore storage error
    }
  }

  function handleChangeMessageTextSize(val: MessageTextSize) {
    setMessageTextSize(val);
    try {
      window.localStorage.setItem(MSG_TEXT_SIZE_PREF_KEY, val);
    } catch {
      // Ignore storage error
    }
  }

  // Tick every second when ephemeral messages or locked time capsules exist
  useEffect(() => {
    const nowInit = Date.now();
    const hasTimed = messages.some(
      (m) => m.expiresAt !== null || (m.unlockAt != null && m.unlockAt > nowInit)
    );
    if (!hasTimed) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      setMessages((prev) =>
        prev.filter((m) => m.expiresAt === null || m.expiresAt > now)
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [messages]);

  const revealInkMessage = useCallback((msgId: string) => {
    if (inkTimersRef.current[msgId]) {
      window.clearTimeout(inkTimersRef.current[msgId]);
      delete inkTimersRef.current[msgId];
    }
    setRevealedInkIds((prev) => {
      if (prev[msgId]) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      inkTimersRef.current[msgId] = window.setTimeout(() => {
        delete inkTimersRef.current[msgId];
        setRevealedInkIds((curr) => {
          if (!curr[msgId]) return curr;
          const next = { ...curr };
          delete next[msgId];
          return next;
        });
      }, 8000);
      return { ...prev, [msgId]: true };
    });
  }, []);

  useEffect(() => {
    return () => {
      Object.values(inkTimersRef.current).forEach((t) => window.clearTimeout(t));
      inkTimersRef.current = {};
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

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
        replyTo: result.replyTo,
        attachment: result.attachment,
        invisibleInk: result.invisibleInk,
        unlockAt: result.unlockAt,
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
        replyTo: result.replyTo,
        attachment: result.attachment,
        invisibleInk: result.invisibleInk,
        unlockAt: result.unlockAt,
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

  // Real-time Firestore subscriptions for conversations, groups, friends & hidden threads
  useEffect(() => {
    hiddenThreadsLoadedRef.current = false;
    didAutoSelectInitialRef.current = false;

    const tryInitialAutoSelect = (items: SidebarConversation[]) => {
      if (
        didAutoSelectInitialRef.current ||
        activeTargetRef.current ||
        !hiddenThreadsLoadedRef.current ||
        items.length === 0
      ) {
        return;
      }
      didAutoSelectInitialRef.current = true;
      const firstVisible = items.find(
        (c) => !isDmConversationHidden(c, hiddenThreadsRef.current)
      );
      if (firstVisible) {
        setActiveTarget({ kind: 'dm', peer: firstVisible.peer });
      }
    };

    const unsubHidden = subscribeHiddenThreads(session.user.id, (hiddenMap) => {
      hiddenThreadsRef.current = hiddenMap;
      hiddenThreadsLoadedRef.current = true;
      setHiddenThreads(hiddenMap);
      tryInitialAutoSelect(conversationsRef.current);
    });

    const unsubConvs = subscribeConversations(session.user.id, (summaries) => {
      void Promise.all(
        summaries.map(async (conv) => {
          let preview: string | null = null;
          if (conv.lastMessage) {
            const dec = await decryptEnvelope(conv.lastMessage, conv.peer);
            preview = formatMessagePreviewText(
              dec.text,
              dec.attachment,
              dec.invisibleInk,
              dec.unlockAt
            );
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
        tryInitialAutoSelect(items);
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
                  ? `${getContactDisplayName(dec.sender, friendAliasesRef.current)} : `
                  : '';
            preview = `${prefix}${formatMessagePreviewText(
              dec.text,
              dec.attachment,
              dec.invisibleInk,
              dec.unlockAt
            )}`;
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

    const unsubAliases = subscribeFriendAliases(session.user.id, (aliases) => {
      setFriendAliases(aliases);
    });

    return () => {
      unsubHidden();
      unsubConvs();
      unsubGroups();
      unsubFriends();
      unsubAliases();
    };
  }, [session.user.id, decryptEnvelope, decryptGroupEnvelope]);

  const activeTargetId =
    activeTarget?.kind === 'dm'
      ? `dm:${activeTarget.peer.id}`
      : activeTarget?.kind === 'group'
        ? `group:${activeTarget.group.id}`
        : null;

  useEffect(() => {
    const topEl = topDockRef.current;
    const bottomEl = bottomDockRef.current;
    if (!topEl && !bottomEl) return;

    const update = () => {
      if (topEl) setTopDockHeight(Math.round(topEl.getBoundingClientRect().height));
      if (bottomEl) setBottomDockHeight(Math.round(bottomEl.getBoundingClientRect().height));
    };
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    if (topEl) ro.observe(topEl);
    if (bottomEl) ro.observe(bottomEl);
    return () => ro.disconnect();
  }, [
    activeTargetId,
    inChatSearchOpen,
    tts.autoRead,
    tts.speakingMessageId,
    replyingTo,
    pendingAttachment,
    invisibleInk,
    unlockAt,
    ephemeralDuration,
    isRecordingVoice,
    ephemeralMenuOpen,
  ]);

  // Real-time Firestore subscription for active thread messages
  useEffect(() => {
    knownMsgIdsRef.current = new Set();
    animatedNewMsgIdsRef.current = new Set();
    hasLoadedInitialBatchRef.current = false;
    isNearBottomRef.current = true;
    setSendError(null);
    setReplyingTo(null);
    setPendingAttachment(null);
    setLightboxMedia(null);
    setInChatSearchOpen(false);
    setInChatSearchQuery('');
    setActiveSearchMatchIdx(0);
    setShowScrollToBottom(false);
    setUnreadBelowCount(0);
    ttsStopRef.current();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      voiceActionRef.current = 'cancel';
      mediaRecorderRef.current.stop();
    }
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecordingVoice(false);
    setRecordingSec(0);

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

      if (newlyArrived.length > 0 && !isNearBottomRef.current) {
        setUnreadBelowCount((c) => c + newlyArrived.length);
      }

      if (
        newlyArrived.length > 0 &&
        ttsAutoReadRef.current &&
        callPhaseRef.current === 'idle'
      ) {
        const nowCheck = Date.now();
        const incomingSpeakable = newlyArrived.filter(
          (m) =>
            m.fromId !== session.user.id &&
            !m.decryptionError &&
            !m.invisibleInk &&
            (!m.unlockAt || m.unlockAt <= nowCheck) &&
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
            recordMessageBatch(decrypted, () =>
              getContactDisplayName(peer, friendAliasesRef.current)
            );
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
          recordMessageBatch(decrypted, (m) =>
            m.sender
              ? getContactDisplayName(m.sender, friendAliasesRef.current)
              : undefined
          );
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
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadBelowCount(0);
    }
  }, [messages.length, activeTargetId]);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messagesContainerRef.current?.querySelector(
      `[data-msg-id="${CSS.escape(messageId)}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(messageId);
    window.setTimeout(() => {
      setHighlightedMsgId((curr) => (curr === messageId ? null : curr));
    }, 1800);
  }, []);

  const searchMatches = useMemo(() => {
    const q = inChatSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter(
        (m) =>
          !m.decryptionError &&
          !(m.unlockAt && nowTick < m.unlockAt) &&
          !(m.invisibleInk && !revealedInkIds[m.id]) &&
          m.text.toLowerCase().includes(q)
      )
      .map((m) => m.id);
  }, [inChatSearchQuery, messages, nowTick, revealedInkIds]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchMatchIdx(0);
      return;
    }
    const clamped = Math.min(activeSearchMatchIdx, searchMatches.length - 1);
    if (clamped !== activeSearchMatchIdx) {
      setActiveSearchMatchIdx(clamped);
    }
  }, [searchMatches, activeSearchMatchIdx]);

  // Global keyboard shortcuts (Ctrl/Cmd+K, Ctrl/Cmd+F, Ctrl/Cmd+Shift+H camouflage, Alt+V shoulder shield, Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (camouflageMode) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        ttsStopRef.current();
        setUtilityMenuOpen(false);
        setCamouflageMode(true);
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setShoulderShield((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        sidebarSearchRef.current?.focus();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'f' &&
        activeTargetRef.current
      ) {
        e.preventDefault();
        setInChatSearchOpen(true);
        window.setTimeout(() => inChatSearchInputRef.current?.focus(), 20);
      } else if (e.key === 'Escape') {
        if (lightboxMedia) {
          setLightboxMedia(null);
        } else if (inChatSearchOpen) {
          setInChatSearchOpen(false);
          setInChatSearchQuery('');
        } else if (replyingTo) {
          setReplyingTo(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inChatSearchOpen, replyingTo, lightboxMedia, camouflageMode]);

  // Real-time WebSocket connection for WebRTC call signaling & live typing indicators
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let connecting = false;
    let attempt = 0;

    async function connect() {
      if (closedByUser || connecting) return;
      connecting = true;
      try {
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
          if (pingTimer) window.clearInterval(pingTimer);
          pingTimer = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ws:ping' }));
            }
          }, 20000);
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
              pushSent?: boolean;
            };

            if (payload.type === 'ws:pong') return;

            if (payload.type.startsWith('call:')) {
              void handleCallSignalRef.current(payload as CallSignalPayload);
              return;
            }

            if (payload.type === 'typing:state' && payload.fromId) {
              if (payload.groupId) {
                const grp = groupsRef.current.find(
                  (item) => item.group.id === payload.groupId
                )?.group;
                const member = grp?.members.find((m) => m.id === payload.fromId);
                const senderName = member
                  ? getContactDisplayName(member, friendAliasesRef.current)
                  : null;
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
          if (pingTimer) {
            window.clearInterval(pingTimer);
            pingTimer = null;
          }
          if (!closedByUser) {
            const delay = Math.min(1000 * Math.pow(1.6, attempt), 10000);
            attempt += 1;
            reconnectTimer = window.setTimeout(() => {
              void connect();
            }, delay);
          }
        };
      } finally {
        connecting = false;
      }
    }

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
      ) {
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        attempt = 0;
        void connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleVisibility);
    void connect();

    return () => {
      closedByUser = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleVisibility);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [session.token]);

  const openFromNotificationData = useCallback(
    async (data: { type?: string; peerId?: string; groupId?: string } | null | undefined) => {
      if (!data) return;
      if (data.type === 'friend_request') {
        setSidebarTab('friends');
        setMobileShowChat(false);
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
        body: `${session.user.handle} souhaite rejoindre vos contacts HOI.`,
        discreetTitle: 'HOI',
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
      discreetTitle: 'HOI',
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

  async function handleSaveFriendAlias(targetUserId: string, nickname: string) {
    await setFriendAliasInFirestore(session.user.id, targetUserId, nickname);
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

  async function handleAttachMediaFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setSendError('Sélectionnez une image ou un GIF animé.');
      return;
    }
    setSendError(null);
    setPreparingAttachment(true);
    try {
      const prepared = await prepareChatMediaDataUrl(file);
      setPendingAttachment(prepared);
      composerRef.current?.focus();
    } catch (err) {
      setSendError(
        err instanceof Error
          ? err.message
          : 'Impossible de préparer ce fichier média.'
      );
    } finally {
      setPreparingAttachment(false);
    }
  }

  function handleComposerFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void handleAttachMediaFile(file);
    }
  }

  function handleComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleAttachMediaFile(file);
          break;
        }
      }
    }
  }

  async function sendEncryptedMessagePayload(params: {
    trimmedText: string;
    attachment: ChatAttachment | null;
  }) {
    if (!activeTarget) return;
    const { trimmedText, attachment: currentAttachment } = params;
    if (!trimmedText && !currentAttachment) return;

    setSending(true);
    setSendError(null);
    emitTyping(false);

    const id = window.crypto.randomUUID();
    const timestamp = Date.now();
    const currentReply = replyingTo;
    const currentInvisibleInk = invisibleInk;
    const currentUnlockAt =
      unlockAt && unlockAt > timestamp + 5_000 ? unlockAt : null;

    const replyExcerpt = currentReply
      ? currentReply.text.replace(/\s+/g, ' ').trim().slice(0, 140) ||
        (currentReply.attachment?.kind === 'audio'
          ? 'Message vocal'
          : currentReply.attachment?.mimeType === 'image/gif'
            ? 'GIF animé'
            : currentReply.attachment
              ? 'Image'
              : '')
      : '';
    const replyRef: ReplyReference | undefined = currentReply
      ? {
          id: currentReply.id,
          senderName:
            currentReply.fromId === session.user.id
              ? 'Vous'
              : currentReply.sender
                ? getContactDisplayName(currentReply.sender, friendAliases)
                : activeTarget.kind === 'dm'
                  ? getContactDisplayName(activeTarget.peer, friendAliases)
                  : 'Membre',
          excerpt: replyExcerpt,
        }
      : undefined;

    isNearBottomRef.current = true;

    try {
      if (activeTarget.kind === 'dm') {
        const peer = activeTarget.peer;
        const encrypted = await encryptAndSignMessage({
          id,
          fromId: session.user.id,
          toId: peer.id,
          plaintext: trimmedText,
          replyTo: replyRef,
          attachment: currentAttachment ?? undefined,
          invisibleInk: currentInvisibleInk || undefined,
          unlockAt: currentUnlockAt,
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
          text: trimmedText,
          replyTo: replyRef,
          attachment: currentAttachment ?? undefined,
          invisibleInk: currentInvisibleInk || undefined,
          unlockAt: currentUnlockAt,
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
        if (currentAttachment?.kind !== 'audio') {
          setComposerText('');
          setPendingAttachment(null);
        }
        setReplyingTo(null);
        setInvisibleInk(false);
        setUnlockAt(null);
        setCustomUnlockLocal('');
        setEphemeralMenuOpen(false);

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
            discreetTitle: 'HOI',
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
          plaintext: trimmedText,
          replyTo: replyRef,
          attachment: currentAttachment ?? undefined,
          invisibleInk: currentInvisibleInk || undefined,
          unlockAt: currentUnlockAt,
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
          text: trimmedText,
          replyTo: replyRef,
          attachment: currentAttachment ?? undefined,
          invisibleInk: currentInvisibleInk || undefined,
          unlockAt: currentUnlockAt,
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
        if (currentAttachment?.kind !== 'audio') {
          setComposerText('');
          setPendingAttachment(null);
        }
        setReplyingTo(null);
        setInvisibleInk(false);
        setUnlockAt(null);
        setCustomUnlockLocal('');
        setEphemeralMenuOpen(false);

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
            discreetTitle: 'HOI',
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
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (currentAttachment?.kind !== 'audio') {
        if (trimmedText) setComposerText((prev) => (prev ? prev : trimmedText));
        if (currentAttachment) setPendingAttachment((prev) => prev ?? currentAttachment);
      }
      if (currentReply) {
        setReplyingTo((prev) => prev ?? currentReply);
      }
      setSendError(err instanceof Error ? err.message : "Erreur d'envoi.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activeTarget || sending || preparingAttachment || processingVoice) return;
    await sendEncryptedMessagePayload({
      trimmedText: composerText.trim(),
      attachment: pendingAttachment,
    });
  }

  function stopVoiceResources() {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }

  function cancelVoiceRecording() {
    voiceActionRef.current = 'cancel';
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopVoiceResources();
    }
    setIsRecordingVoice(false);
    setRecordingSec(0);
  }

  function finishAndSendVoiceRecording() {
    if (!isRecordingVoice) return;
    voiceActionRef.current = 'send';
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }

  async function startVoiceRecording() {
    if (!activeTarget || sending || processingVoice || isRecordingVoice) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSendError('Enregistrement audio non supporté par ce navigateur.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setSendError('Enregistrement audio indisponible sur cet appareil.');
      return;
    }

    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      voiceActionRef.current = 'cancel';

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = chosenType
        ? new MediaRecorder(stream, { mimeType: chosenType, audioBitsPerSecond: 32000 })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecordingSec(0);
      setIsRecordingVoice(true);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const action = voiceActionRef.current;
        const durationSec = Math.max(
          1,
          Math.round((Date.now() - recordStartRef.current) / 1000)
        );
        const rawMime = recorder.mimeType || 'audio/webm';
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        stopVoiceResources();
        setIsRecordingVoice(false);
        setRecordingSec(0);

        if (action !== 'send' || chunks.length === 0) {
          return;
        }

        setProcessingVoice(true);
        try {
          const blob = new Blob(chunks, { type: rawMime });
          const voiceAttachment = await prepareVoiceAttachment({
            blob,
            durationSec,
            maskVoice: voiceMaskRef.current,
          });
          await sendEncryptedMessagePayload({
            trimmedText: '',
            attachment: voiceAttachment,
          });
        } catch (err) {
          setSendError(
            err instanceof Error
              ? err.message
              : 'Impossible de chiffrer la note vocale.'
          );
        } finally {
          setProcessingVoice(false);
        }
      };

      recorder.start(250);
      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartRef.current) / 1000);
        setRecordingSec(elapsed);
        const maxDuration = voiceMaskRef.current ? 18 : 36;
        if (elapsed >= maxDuration && recorder.state !== 'inactive') {
          voiceActionRef.current = 'send';
          recorder.stop();
        }
      }, 250);
    } catch {
      stopVoiceResources();
      setIsRecordingVoice(false);
      setSendError('Autorisez l’accès au microphone pour envoyer une note vocale.');
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

  async function handleInstallTrigger() {
    if (pwaInstall.isInstallable) {
      const accepted = await pwaInstall.install();
      if (accepted) return;
    }
    setIsInstallModalOpen(true);
  }

  async function handleSelectPeer(peer: PublicUser) {
    const threadKey = getDmHiddenKey(peer.id);
    if (hiddenThreadsRef.current[threadKey] !== undefined) {
      const nextHidden = { ...hiddenThreadsRef.current };
      delete nextHidden[threadKey];
      hiddenThreadsRef.current = nextHidden;
      setHiddenThreads(nextHidden);
      void unhideThreadInFirestore(session.user.id, threadKey);
    }
    try {
      await openConversationInFirestore(session.user.id, peer.id);
    } catch {
      // Continue opening locally
    }
    setActiveTarget({ kind: 'dm', peer });
    setMobileShowChat(true);
    setEphemeralMenuOpen(false);
    setChatOptionsMenuOpen(false);
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
    const threadKey = getGroupHiddenKey(group.id);
    if (hiddenThreadsRef.current[threadKey] !== undefined) {
      const nextHidden = { ...hiddenThreadsRef.current };
      delete nextHidden[threadKey];
      hiddenThreadsRef.current = nextHidden;
      setHiddenThreads(nextHidden);
      void unhideThreadInFirestore(session.user.id, threadKey);
    }
    setActiveTarget({ kind: 'group', group });
    setMobileShowChat(true);
    setEphemeralMenuOpen(false);
    setChatOptionsMenuOpen(false);
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

  async function handleConfirmDeleteThread() {
    if (!pendingDeleteThread || deletingThread) return;
    setDeletingThread(true);
    const { threadKey, kind, targetId, lastTimestamp } = pendingDeleteThread;
    const hiddenAtMs = Math.max(Date.now(), lastTimestamp ?? 0);

    const nextHidden = { ...hiddenThreadsRef.current, [threadKey]: hiddenAtMs };
    hiddenThreadsRef.current = nextHidden;
    setHiddenThreads(nextHidden);

    if (
      (kind === 'dm' && activeTarget?.kind === 'dm' && activeTarget.peer.id === targetId) ||
      (kind === 'group' && activeTarget?.kind === 'group' && activeTarget.group.id === targetId)
    ) {
      setActiveTarget(null);
      setMobileShowChat(false);
      setChatOptionsMenuOpen(false);
    }

    try {
      await hideThreadInFirestore(session.user.id, threadKey, hiddenAtMs);
    } catch {
      // Snapshot listener restores authoritative state if write fails
    } finally {
      setDeletingThread(false);
      setPendingDeleteThread(null);
    }
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
        if (isDmConversationHidden(conv, hiddenThreads)) continue;
        const alias = friendAliases[conv.peer.id]?.toLowerCase() ?? '';
        if (
          !q ||
          alias.includes(q) ||
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
        if (isGroupConversationHidden(sg, hiddenThreads)) continue;
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
  }, [conversations, groups, hiddenThreads, sidebarFilter, sidebarTab, session.user.id, friendAliases]);

  const totalUnreadCount = useMemo(
    () =>
      conversations.reduce(
        (sum, c) => (isDmConversationHidden(c, hiddenThreads) ? sum : sum + c.unreadCount),
        0
      ),
    [conversations, hiddenThreads]
  );

  const activePeer = activeTarget?.kind === 'dm' ? activeTarget.peer : null;
  const activeGroup = activeTarget?.kind === 'group' ? activeTarget.group : null;
  const isSelfSelected = activePeer?.id === session.user.id;
  const isPeerTyping = Boolean(
    activePeer && activePeer.id !== session.user.id && typingPeers[activePeer.id]
  );
  const activeGroupTypingUser = activeGroup ? typingGroups[activeGroup.id] : null;

  const messageTextSizeClass = getMessageTextSizeClass(messageTextSize);

  const drawerSectionTitle =
    sidebarTab === 'all'
      ? 'Discussions'
      : sidebarTab === 'direct'
        ? 'Messages directs'
        : sidebarTab === 'groups'
          ? 'Groupes'
          : 'Amis';

  return (
    <div
      data-glass-intensity={glassIntensity}
      className="app-canvas relative h-dvh w-full overflow-hidden flex flex-col"
    >
      {/* Multi-layered themed liquid ambient field for genuine glass refraction */}
      <ThemeBackdrop showTopSheen />

      {/* Desktop Top Floating Command Header */}
      <header className="relative z-30 hidden md:flex items-center justify-between gap-4 mx-2.5 mt-2.5 px-4 h-14 rounded-[22px] glass-liquid shrink-0 overflow-visible">
        <div className="flex items-center gap-4 min-w-0">
          {onOpenPresentation ? (
            <button
              type="button"
              onClick={onOpenPresentation}
              title="HOI — Page de présentation"
              className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <img
                src="/hoi-icon.svg"
                alt="HOI"
                className="h-7 w-7 rounded-xl object-cover"
              />
              <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wider text-white">
                HOI
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2.5 shrink-0">
              <img
                src="/hoi-icon.svg"
                alt="HOI"
                className="h-7 w-7 rounded-xl object-cover"
              />
              <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wider text-white">
                HOI
              </span>
            </div>
          )}

          <div className="h-5 w-px bg-white/[0.1] shrink-0" aria-hidden="true" />

          <nav aria-label="Navigation principale" className="flex items-center gap-1">
            {(
              [
                { key: 'all', label: 'Tout', count: totalUnreadCount },
                { key: 'direct', label: 'Messages', count: 0 },
                { key: 'groups', label: 'Groupes', count: 0 },
              ] as const
            ).map((tab) => {
              const active = sidebarTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSidebarTab(tab.key)}
                  aria-pressed={active}
                  className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                    active
                      ? 'glass-control-active text-white'
                      : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-emerald-400 text-zinc-950 font-mono text-[10px] font-bold tabular-nums">
                      {tab.count > 99 ? '99+' : tab.count}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setSidebarTab('friends')}
              aria-pressed={sidebarTab === 'friends'}
              className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                sidebarTab === 'friends'
                  ? 'glass-control-active text-white'
                  : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <span>Amis</span>
              {friendsSnapshot.incoming.length > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-emerald-400 text-zinc-950 font-mono text-[10px] font-bold tabular-nums">
                  {friendsSnapshot.incoming.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Primary "+ Nouveau" Action Menu */}
          <div ref={newMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setNewMenuOpen((v) => !v)}
              aria-expanded={newMenuOpen}
              aria-haspopup="true"
              className="btn-specular min-h-[36px] inline-flex items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <SquarePen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>Nouveau</span>
            </button>

            {newMenuOpen && (
              <div className="glass-liquid animate-panel-enter absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl p-1.5 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setIsContactModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <span className="glass-control h-8 w-8 flex items-center justify-center rounded-lg text-white shrink-0">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-white">
                      Nouveau contact
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      Ajouter par @identifiant
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setIsCreateGroupOpen(true);
                  }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <span className="glass-control h-8 w-8 flex items-center justify-center rounded-lg text-white shrink-0">
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-white">
                      Nouveau groupe
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      Salon privé chiffré
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>

          <div className="h-5 w-px bg-white/[0.1] mx-0.5" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setIsProfileModalOpen(true)}
            title="Mon profil et apparence"
            className="glass-control h-9 inline-flex items-center gap-2 rounded-xl px-2 py-1 hover:border-white/25 transition-all cursor-pointer"
          >
            <UserAvatar user={session.user} size="sm" />
            <span className="hidden lg:inline text-xs font-medium text-white max-w-[110px] truncate pr-0.5">
              {session.user.displayName}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUtilityThemeExpanded(false);
              setUtilityMenuOpen((v) => !v);
            }}
            aria-expanded={utilityMenuOpen}
            aria-haspopup="dialog"
            title="Menu, thème et options"
            aria-label="Menu, thème et options"
            className={`h-9 w-9 flex items-center justify-center rounded-xl transition-all cursor-pointer ${
              utilityMenuOpen
                ? 'glass-control-active text-white'
                : 'glass-control text-zinc-300 hover:text-white'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </header>

      {/* Main 2-Pane Split Workspace */}
      <div className="relative z-10 flex-1 min-h-0 flex md:gap-2.5 md:p-2.5 md:pt-2 overflow-hidden">
      {/* Left Conversations Pane */}
      <aside
        className={`relative z-20 flex h-full w-full md:w-[320px] lg:w-[348px] shrink-0 flex-col glass-liquid md:rounded-[24px] border-r md:border overflow-hidden ${
          mobileShowChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Mobile Compact Top Identity & Utility Bar */}
        <div className="md:hidden flex items-center justify-between gap-2 px-3.5 pt-[max(0.65rem,env(safe-area-inset-top))] pb-2.5 border-b border-white/[0.07]">
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(true)}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-xl p-1 -m-1 hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <UserAvatar user={session.user} size="sm" />
            <div className="min-w-0">
              <span className="block font-[family-name:var(--font-display)] text-sm font-semibold text-white truncate">
                {session.user.displayName}
              </span>
              <span className="block font-mono text-[11px] text-zinc-400 truncate">
                {session.user.handle}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setUtilityThemeExpanded(false);
              setUtilityMenuOpen((v) => !v);
            }}
            aria-expanded={utilityMenuOpen}
            aria-haspopup="dialog"
            aria-label="Menu, thème et options"
            className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all shrink-0 cursor-pointer ${
              utilityMenuOpen
                ? 'glass-control-active text-white'
                : 'glass-control text-zinc-200 hover:text-white'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>

        {/* Pane Header & Search */}
        <div className="px-3.5 pt-3.5 pb-2.5 space-y-2.5">
          {/* Desktop: Section Title + Copyable Handle */}
          <div className="hidden md:flex items-center justify-between gap-2 px-0.5">
            <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-white truncate">
              {drawerSectionTitle}
            </h2>
            <button
              type="button"
              onClick={handleCopyOwnHandle}
              title="Copier votre identifiant public"
              className="glass-control inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[120px]">{session.user.handle}</span>
              {copiedHandle ? (
                <Check className="h-3 w-3 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="h-3 w-3 shrink-0 opacity-65" />
              )}
            </button>
          </div>

          {/* Mobile: Quick Create Actions */}
          <div className="md:hidden grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsContactModalOpen(true)}
              className="btn-specular min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>Contact</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCreateGroupOpen(true)}
              className="glass-control min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white cursor-pointer whitespace-nowrap"
            >
              <Users className="h-4 w-4 shrink-0" strokeWidth={1.85} />
              <span>Groupe</span>
            </button>
          </div>

          <div className="relative flex items-center glass-input rounded-xl">
            <Search className="ml-3 h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <input
              ref={sidebarSearchRef}
              type="text"
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
              placeholder="Rechercher... (⌘K)"
              className="w-full bg-transparent px-2.5 py-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
            />
            {sidebarFilter && (
              <button
                type="button"
                onClick={() => setSidebarFilter('')}
                aria-label="Effacer le filtre"
                className="mr-2 p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Unified Thread List or Inline Friends View */}
        {sidebarTab === 'friends' ? (
          <FriendsPanel
            token={session.token}
            currentUser={session.user}
            snapshot={friendsSnapshot}
            friendAliases={friendAliases}
            onSaveFriendAlias={handleSaveFriendAlias}
            getRelationship={getRelationship}
            onViewProfile={(u) => setViewedProfileUser(u)}
            onStartChat={handleSelectPeer}
            onSendRequest={handleSendFriendRequest}
            onAcceptRequest={handleAcceptFriendRequest}
            onDeclineRequest={handleDeclineFriendRequest}
            onRemoveFriend={handleRemoveFriend}
            onBlockUser={handleBlockUser}
            onUnblockUser={handleUnblockUser}
            filterQuery={sidebarFilter}
          />
        ) : (
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1">
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
              <p className="text-xs text-zinc-400">
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
                className="glass-control inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-white cursor-pointer"
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
                const contactLabel = isSelf
                  ? 'Notes chiffrées'
                  : getContactDisplayName(conv.peer, friendAliases);
                return (
                  <div
                    key={item.id}
                    className={`group flex items-center rounded-2xl border transition-all ${
                      isSelected
                        ? 'glass-control-active'
                        : 'border-transparent hover:bg-white/[0.045] hover:border-white/[0.07]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectPeer(conv.peer)}
                      className="min-w-0 flex-1 min-h-[60px] flex items-center gap-3 pl-3 pr-1 py-2.5 text-left cursor-pointer rounded-l-2xl"
                    >
                      <UserAvatar
                        user={conv.peer}
                        isSelfVault={isSelf}
                        size="md"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {contactLabel}
                          </span>
                          {conv.lastTimestamp && (
                            <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                              {formatTime(conv.lastTimestamp)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          {!isSelf && typingPeers[conv.peer.id] ? (
                            <p className="text-xs font-medium text-emerald-300 truncate">
                              Écrit...
                            </p>
                          ) : (
                            <p
                              className={`text-xs text-zinc-400 truncate ${
                                shoulderShield ? 'shoulder-shield-blur' : ''
                              }`}
                            >
                              {conv.lastMessagePreview ??
                                (isSelf
                                  ? 'Coffre-fort personnel'
                                  : friendAliases[conv.peer.id]?.trim()
                                    ? `${conv.peer.displayName} · ${conv.peer.handle}`
                                    : conv.peer.bio || conv.peer.handle)}
                            </p>
                          )}
                          {conv.unreadCount > 0 && (
                            <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 rounded-md tabular-nums">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPendingDeleteThread({
                          threadKey: getDmHiddenKey(conv.peer.id),
                          label: contactLabel,
                          kind: 'dm',
                          targetId: conv.peer.id,
                          lastTimestamp: conv.lastTimestamp,
                        })
                      }
                      title="Supprimer de l’accueil"
                      aria-label={`Supprimer la conversation ${contactLabel}`}
                      className="mr-1.5 h-9 w-9 shrink-0 flex items-center justify-center rounded-xl text-zinc-500 opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:text-rose-300 hover:bg-rose-500/15 transition-all cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                );
              }

              const { sg } = item;
              const isSelected = activeTargetId === item.id;
              const groupTypingName = typingGroups[sg.group.id];

              return (
                <div
                  key={item.id}
                  className={`group flex items-center rounded-2xl border transition-all ${
                    isSelected
                      ? 'glass-control-active'
                      : 'border-transparent hover:bg-white/[0.045] hover:border-white/[0.07]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectGroup(sg.group)}
                    className="min-w-0 flex-1 min-h-[60px] flex items-center gap-3 pl-3 pr-1 py-2.5 text-left cursor-pointer rounded-l-2xl"
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
                        {groupTypingName ? (
                          <p className="text-xs font-medium text-emerald-300 truncate">
                            {groupTypingName} écrit...
                          </p>
                        ) : (
                          <p
                            className={`text-xs text-zinc-400 truncate ${
                              shoulderShield ? 'shoulder-shield-blur' : ''
                            }`}
                          >
                            {sg.lastMessagePreview ??
                              `${sg.group.members.length} membre${
                                sg.group.members.length > 1 ? 's' : ''
                              }${sg.group.description ? ` · ${sg.group.description}` : ''}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPendingDeleteThread({
                        threadKey: getGroupHiddenKey(sg.group.id),
                        label: sg.group.name,
                        kind: 'group',
                        targetId: sg.group.id,
                        lastTimestamp: sg.lastTimestamp,
                      })
                    }
                    title="Supprimer de l’accueil"
                    aria-label={`Supprimer le groupe ${sg.group.name} de l’accueil`}
                    className="mr-1.5 h-9 w-9 shrink-0 flex items-center justify-center rounded-xl text-zinc-500 opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:text-rose-300 hover:bg-rose-500/15 transition-all cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* Mobile Bottom Thumb-Zone Navigation Bar */}
        <nav
          aria-label="Navigation mobile"
          className="md:hidden grid grid-cols-4 gap-1 border-t border-white/[0.07] bg-black/20 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            onClick={() => setSidebarTab('all')}
            aria-pressed={sidebarTab === 'all'}
            className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition-all cursor-pointer ${
              sidebarTab === 'all'
                ? 'glass-control-active text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={1.85} />
            <span className="whitespace-nowrap">Tout</span>
            {totalUnreadCount > 0 && (
              <span className="absolute top-1 right-2.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-emerald-400 text-zinc-950 font-mono text-[9px] font-bold tabular-nums">
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSidebarTab('direct')}
            aria-pressed={sidebarTab === 'direct'}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition-all cursor-pointer ${
              sidebarTab === 'direct'
                ? 'glass-control-active text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <User className="h-4 w-4 shrink-0" strokeWidth={1.85} />
            <span className="whitespace-nowrap">Directs</span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarTab('groups')}
            aria-pressed={sidebarTab === 'groups'}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition-all cursor-pointer ${
              sidebarTab === 'groups'
                ? 'glass-control-active text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="h-4 w-4 shrink-0" strokeWidth={1.85} />
            <span className="whitespace-nowrap">Groupes</span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarTab('friends')}
            aria-pressed={sidebarTab === 'friends'}
            className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition-all cursor-pointer ${
              sidebarTab === 'friends'
                ? 'glass-control-active text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <UserPlus className="h-4 w-4 shrink-0" strokeWidth={1.85} />
            <span className="whitespace-nowrap">Amis</span>
            {friendsSnapshot.incoming.length > 0 && (
              <span className="absolute top-1 right-2.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-emerald-400 text-zinc-950 font-mono text-[9px] font-bold tabular-nums">
                {friendsSnapshot.incoming.length}
              </span>
            )}
          </button>
        </nav>
      </aside>

      {/* Right Chat Viewport */}
      <main
        className={`relative z-10 flex-1 flex flex-col h-full min-w-0 overflow-hidden md:rounded-[24px] ${
          !mobileShowChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Whisper-soft blurred banner atmosphere behind active thread for optical glass refraction */}
        {(activePeer || activeGroup) && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.08]"
          >
            <ProfileBanner
              user={
                activePeer ?? {
                  displayName: activeGroup!.name,
                  bannerPreset: activeGroup!.bannerPreset,
                  bannerDataUrl: activeGroup!.bannerDataUrl ?? null,
                }
              }
              className="h-full w-full scale-110 blur-3xl saturate-150"
              scrimClassName="bg-gradient-to-b from-black/20 via-black/55 to-transparent"
            />
          </div>
        )}

        {activeTarget ? (
          <div
            key={activeTargetId ?? 'active-thread'}
            className="animate-thread-enter relative flex-1 min-h-0 flex flex-col"
          >
            {/* Floating Liquid Glass Top Dock (Header + Optional Search / TTS / Mobile Ephemeral Bar) */}
            <div
              ref={topDockRef}
              className="pointer-events-none absolute top-0 left-0 right-0 z-20 px-2 pt-2 sm:px-4 sm:pt-2.5"
            >
              <div className="max-w-4xl mx-auto space-y-1.5">
              <header className="pointer-events-auto glass-liquid rounded-2xl flex items-center justify-between gap-2 sm:gap-3 px-2.5 sm:px-5 py-2 sm:py-2.5">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileShowChat(false)}
                  aria-label="Retour aux conversations"
                  className="md:hidden glass-control h-10 w-10 flex items-center justify-center rounded-xl text-zinc-200 hover:text-white cursor-pointer shrink-0"
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
                          : getContactDisplayName(activePeer, friendAliases)}
                      </h1>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="font-mono truncate">
                          {!isSelfSelected && friendAliases[activePeer.id]?.trim()
                            ? `${activePeer.handle} · ${activePeer.displayName}`
                            : activePeer.handle}
                        </span>
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

              {/* Right Controls: Streamlined Action Cluster + Options Menu */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setInChatSearchOpen((prev) => {
                      const next = !prev;
                      if (next) {
                        window.setTimeout(() => inChatSearchInputRef.current?.focus(), 20);
                      } else {
                        setInChatSearchQuery('');
                      }
                      return next;
                    });
                  }}
                  title="Rechercher dans la conversation"
                  aria-label="Rechercher dans la conversation"
                  className={`h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl cursor-pointer ${
                    inChatSearchOpen
                      ? 'glass-control-active text-white'
                      : 'glass-control text-zinc-300 hover:text-white'
                  }`}
                >
                  <Search className="h-4 w-4" strokeWidth={1.75} />
                </button>

                {activePeer &&
                  !isSelfSelected &&
                  getRelationship(activePeer.id) !== 'blocked_by_me' &&
                  getRelationship(activePeer.id) !== 'blocked_by_peer' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void call.startCall(activePeer, 'audio')}
                        disabled={call.phase !== 'idle'}
                        title="Appel audio"
                        aria-label="Appel audio"
                        className="glass-control h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-zinc-200 hover:text-white disabled:opacity-40 cursor-pointer"
                      >
                        <Phone className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void call.startCall(activePeer, 'video')}
                        disabled={call.phase !== 'idle'}
                        title="Appel vidéo"
                        aria-label="Appel vidéo"
                        className="glass-control h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-zinc-200 hover:text-white disabled:opacity-40 cursor-pointer"
                      >
                        <Video className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </>
                  )}

                {activePeer ? (
                  <button
                    type="button"
                    onClick={() => setIsSecurityModalOpen(true)}
                    title="Sécurité & clés E2EE"
                    aria-label="Sécurité et clés E2EE"
                    className="glass-control h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : activeGroup ? (
                  <button
                    type="button"
                    onClick={() => setIsGroupInfoOpen(true)}
                    title="Membres et paramètres du groupe"
                    aria-label="Membres du groupe"
                    className="glass-control h-9 w-9 sm:h-10 sm:w-auto flex items-center justify-center gap-1.5 rounded-xl sm:px-3 text-xs font-medium text-zinc-200 hover:text-white whitespace-nowrap cursor-pointer"
                  >
                    <Users className="h-4 w-4" strokeWidth={1.75} />
                    <span className="hidden sm:inline">Membres</span>
                  </button>
                ) : null}

                {(tts.supported || activeGroup || activePeer) && (
                  <div ref={chatOptionsMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setChatOptionsMenuOpen((v) => !v)}
                      aria-expanded={chatOptionsMenuOpen}
                      aria-haspopup="true"
                      title="Plus d'options"
                      aria-label="Plus d'options"
                      className={`h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl cursor-pointer ${
                        chatOptionsMenuOpen
                          ? 'glass-control-active text-white'
                          : 'glass-control text-zinc-300 hover:text-white'
                      }`}
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                    </button>

                    {chatOptionsMenuOpen && (
                      <div className="glass-liquid animate-panel-enter absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl p-1.5 shadow-2xl space-y-0.5">
                        {tts.supported && (
                          <button
                            type="button"
                            onClick={() => {
                              tts.toggleAutoRead();
                              setChatOptionsMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2.5 text-xs font-medium text-white">
                              {tts.autoRead ? (
                                <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
                              ) : (
                                <VolumeX className="h-4 w-4 text-zinc-400 shrink-0" />
                              )}
                              <span>Lecture vocale auto</span>
                            </span>
                            <span
                              className={`text-[11px] font-medium ${
                                tts.autoRead ? 'text-emerald-300' : 'text-zinc-500'
                              }`}
                            >
                              {tts.autoRead ? 'Active' : 'Off'}
                            </span>
                          </button>
                        )}

                        {activeGroup && (
                          <button
                            type="button"
                            onClick={() => {
                              setInspectorMode((v) => !v);
                              setChatOptionsMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2.5 text-xs font-medium text-white">
                              <Eye
                                className={`h-4 w-4 shrink-0 ${
                                  inspectorMode ? 'text-emerald-400' : 'text-zinc-400'
                                }`}
                              />
                              <span>Inspecteur chiffré</span>
                            </span>
                            <span
                              className={`text-[11px] font-medium ${
                                inspectorMode ? 'text-emerald-300' : 'text-zinc-500'
                              }`}
                            >
                              {inspectorMode ? 'Actif' : 'Off'}
                            </span>
                          </button>
                        )}

                        {activePeer && (
                          <button
                            type="button"
                            onClick={() => {
                              setChatOptionsMenuOpen(false);
                              setViewedProfileUser(activePeer);
                            }}
                            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                          >
                            <User className="h-4 w-4 text-zinc-400 shrink-0" />
                            <span>Voir le profil</span>
                          </button>
                        )}

                        <div className="my-1 h-px bg-white/[0.08]" aria-hidden="true" />

                        <button
                          type="button"
                          onClick={() => {
                            setChatOptionsMenuOpen(false);
                            if (activePeer) {
                              const currentConv = conversations.find(
                                (c) => c.peer.id === activePeer.id
                              );
                              setPendingDeleteThread({
                                threadKey: getDmHiddenKey(activePeer.id),
                                label: isSelfSelected
                                  ? 'Notes chiffrées'
                                  : getContactDisplayName(activePeer, friendAliases),
                                kind: 'dm',
                                targetId: activePeer.id,
                                lastTimestamp: currentConv?.lastTimestamp ?? null,
                              });
                            } else if (activeGroup) {
                              const currentGroup = groups.find(
                                (g) => g.group.id === activeGroup.id
                              );
                              setPendingDeleteThread({
                                threadKey: getGroupHiddenKey(activeGroup.id),
                                label: activeGroup.name,
                                kind: 'group',
                                targetId: activeGroup.id,
                                lastTimestamp:
                                  currentGroup?.lastTimestamp ?? activeGroup.createdAt,
                              });
                            }
                          }}
                          className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                          <span>Supprimer de l’accueil</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>

            {/* Local Web Speech Playback & Speed Control Bar */}
            {tts.supported && (tts.speakingMessageId !== null || tts.autoRead) && (
              <div className="pointer-events-auto glass-liquid rounded-xl flex items-center justify-between gap-3 px-3.5 sm:px-5 py-2 text-xs">
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
                    className="glass-control rounded-lg px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-200 hover:text-white tabular-nums cursor-pointer"
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

            {/* In-Thread Encrypted Message Search Bar */}
            {inChatSearchOpen && (
              <div className="pointer-events-auto glass-liquid rounded-xl flex items-center gap-2 px-3.5 sm:px-5 py-2">
                <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <input
                  ref={inChatSearchInputRef}
                  type="text"
                  value={inChatSearchQuery}
                  onChange={(e) => {
                    setInChatSearchQuery(e.target.value);
                    setActiveSearchMatchIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMatches.length > 0) {
                      e.preventDefault();
                      const nextIdx = e.shiftKey
                        ? (activeSearchMatchIdx - 1 + searchMatches.length) %
                          searchMatches.length
                        : (activeSearchMatchIdx + 1) % searchMatches.length;
                      setActiveSearchMatchIdx(nextIdx);
                      scrollToMessage(searchMatches[nextIdx]);
                    }
                  }}
                  placeholder="Rechercher dans les messages déchiffrés..."
                  className="flex-1 bg-transparent text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                />
                {inChatSearchQuery.trim() && (
                  <span className="font-mono text-[11px] text-zinc-400 tabular-nums whitespace-nowrap">
                    {searchMatches.length === 0
                      ? '0 résultat'
                      : `${activeSearchMatchIdx + 1}/${searchMatches.length}`}
                  </span>
                )}
                {searchMatches.length > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const prevIdx =
                          (activeSearchMatchIdx - 1 + searchMatches.length) %
                          searchMatches.length;
                        setActiveSearchMatchIdx(prevIdx);
                        scrollToMessage(searchMatches[prevIdx]);
                      }}
                      aria-label="Résultat précédent"
                      className="glass-control h-7 w-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white cursor-pointer"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextIdx =
                          (activeSearchMatchIdx + 1) % searchMatches.length;
                        setActiveSearchMatchIdx(nextIdx);
                        scrollToMessage(searchMatches[nextIdx]);
                      }}
                      aria-label="Résultat suivant"
                      className="glass-control h-7 w-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white cursor-pointer"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setInChatSearchOpen(false);
                    setInChatSearchQuery('');
                  }}
                  aria-label="Fermer la recherche"
                  className="glass-control h-7 w-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
              </div>
            </div>

            {/* Messages Stream (glides smoothly behind the floating Liquid Glass header & composer docks) */}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={messagesContainerRef}
                onScroll={() => {
                  const el = messagesContainerRef.current;
                  if (!el) return;
                  const distFromBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight;
                  const nearBottom = distFromBottom < 140;
                  isNearBottomRef.current = nearBottom;
                  setShowScrollToBottom(!nearBottom);
                  if (nearBottom) {
                    setUnreadBelowCount(0);
                  }
                }}
                style={{
                  paddingTop: topDockHeight + 14,
                  paddingBottom: bottomDockHeight + 16,
                }}
                className="flex-1 overflow-y-auto px-3 sm:px-4"
              >
                <div className="max-w-4xl mx-auto w-full min-h-full flex flex-col">
                {loadingMessages ? (
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-xs text-zinc-500">
                      Déchiffrement local des messages...
                    </p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="glass-liquid animate-panel-enter max-w-md w-full overflow-hidden rounded-3xl text-center">
                      {activePeer ? (
                        <>
                          <ProfileBanner user={activePeer} className="h-24" />
                          <div className="px-6 pb-6">
                            <div className="-mt-7 mx-auto mb-3 inline-flex rounded-full p-1 bg-black/65 backdrop-blur-md border border-white/15 shadow-lg">
                              <UserAvatar
                                user={activePeer}
                                isSelfVault={isSelfSelected}
                                size="md"
                              />
                            </div>
                            <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-white">
                              {isSelfSelected
                                ? 'Votre coffre de notes chiffrées'
                                : `Canal chiffré avec ${getContactDisplayName(activePeer, friendAliases)}`}
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
                            <div className="-mt-8 mx-auto mb-3 inline-flex rounded-2xl p-1 bg-black/65 backdrop-blur-md border border-white/15 shadow-lg">
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
                  messages.map((msg, idx) => {
                    const isMine = msg.fromId === session.user.id;
                    const isNewEntry = animatedNewMsgIdsRef.current.has(msg.id);
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showDaySeparator =
                      !prevMsg || getDayKey(prevMsg.timestamp) !== getDayKey(msg.timestamp);
                    const isClusteredWithPrev = Boolean(
                      prevMsg &&
                        !showDaySeparator &&
                        prevMsg.fromId === msg.fromId &&
                        msg.timestamp - prevMsg.timestamp < 120_000
                    );
                    const showGroupSender = Boolean(
                      msg.groupId && !isMine && msg.sender && !isClusteredWithPrev
                    );
                    const isSearchMatch =
                      inChatSearchQuery.trim().length > 0 &&
                      searchMatches.includes(msg.id);
                    const isActiveSearchMatch =
                      isSearchMatch &&
                      searchMatches[activeSearchMatchIdx] === msg.id;
                    const isHighlighted = highlightedMsgId === msg.id;
                    const isTimeLocked = Boolean(
                      msg.unlockAt && nowTick < msg.unlockAt && !msg.decryptionError
                    );
                    const isInkVeiled = Boolean(
                      !isTimeLocked &&
                        msg.invisibleInk &&
                        !revealedInkIds[msg.id] &&
                        !msg.decryptionError
                    );

                    return (
                      <React.Fragment key={msg.id}>
                        {showDaySeparator && (
                          <div
                            className={`flex items-center gap-3 py-2 ${
                              idx > 0 ? 'mt-3' : ''
                            }`}
                            aria-label={formatDayLabel(msg.timestamp)}
                          >
                            <div className="glass-hairline flex-1" />
                            <span className="text-[11px] font-medium text-zinc-400 whitespace-nowrap">
                              {formatDayLabel(msg.timestamp)}
                            </span>
                            <div className="glass-hairline flex-1" />
                          </div>
                        )}

                        <div
                          data-msg-id={msg.id}
                          className={`group flex flex-col ${
                            isClusteredWithPrev ? 'mt-1' : 'mt-3'
                          } ${
                            isNewEntry
                              ? isMine
                                ? 'animate-msg-sent'
                                : 'animate-msg-received'
                              : 'animate-msg-history'
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
                                {getContactDisplayName(msg.sender, friendAliases)}
                              </span>
                              <span className="font-mono text-[10px] text-zinc-500">
                                {msg.sender.handle}
                              </span>
                            </button>
                          )}

                          <div
                            className={`relative max-w-[85%] sm:max-w-[68%] px-4 py-2.5 transition-colors ${getBubbleClassNames({
                              isMine,
                              accentTone: session.user.accentTone,
                              bubbleShape: session.user.bubbleShape,
                              bubbleStyle: session.user.bubbleStyle,
                            })} ${
                              isActiveSearchMatch || isHighlighted
                                ? 'ring-2 ring-emerald-400/70'
                                : isSearchMatch
                                  ? 'ring-1 ring-white/30'
                                  : ''
                            }`}
                          >
                            {isTimeLocked ? (
                              <div className="flex items-center gap-3 py-1">
                                <span className="h-9 w-9 rounded-xl border border-amber-400/30 bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
                                  <Hourglass className="h-4 w-4 animate-pulse" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white">
                                    Capsule temporelle verrouillée
                                  </p>
                                  <p className="mt-0.5 font-mono text-[11px] text-amber-300 tabular-nums">
                                    Déverrouillage dans{' '}
                                    {formatUnlockCountdown(msg.unlockAt!, nowTick)}
                                  </p>
                                  <p className="text-[11px] text-zinc-400">
                                    {formatUnlockDateLabel(msg.unlockAt!)}
                                  </p>
                                </div>
                              </div>
                            ) : isInkVeiled ? (
                              <button
                                type="button"
                                onClick={() => revealInkMessage(msg.id)}
                                className="invisible-ink-shimmer flex w-full items-center gap-2.5 rounded-xl border border-white/15 px-3.5 py-2.5 text-left transition-transform active:scale-[0.99] cursor-pointer"
                              >
                                <EyeOff className="h-4 w-4 text-zinc-200 shrink-0" />
                                <div className="min-w-0">
                                  <span className="block text-xs font-medium text-white">
                                    Encre invisible
                                  </span>
                                  <span className="block text-[11px] text-zinc-300">
                                    Toucher pour révéler 8 s
                                  </span>
                                </div>
                              </button>
                            ) : (
                              <div
                                className={
                                  shoulderShield ? 'shoulder-shield-blur' : undefined
                                }
                              >
                                {msg.replyTo && (
                                  <button
                                    type="button"
                                    onClick={() => scrollToMessage(msg.replyTo!.id)}
                                    className="mb-2 block w-full text-left rounded-xl bg-black/25 backdrop-blur-md border border-white/[0.11] px-3 py-1.5 hover:bg-black/40 transition-colors cursor-pointer"
                                  >
                                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 truncate">
                                      <Reply className="h-3 w-3 shrink-0 opacity-80" />
                                      <span className="truncate">
                                        {msg.replyTo.senderName}
                                      </span>
                                    </span>
                                    <span className="block text-xs text-zinc-300 truncate mt-0.5">
                                      {msg.replyTo.excerpt}
                                    </span>
                                  </button>
                                )}

                                {msg.attachment?.kind === 'audio' ? (
                                  <div className={msg.text.trim() ? 'mb-2' : ''}>
                                    <VoiceMessagePlayer
                                      attachment={msg.attachment}
                                      isMine={isMine}
                                    />
                                  </div>
                                ) : (
                                  msg.attachment && (
                                    <button
                                      type="button"
                                      onClick={() => setLightboxMedia(msg.attachment!)}
                                      title="Agrandir l’image"
                                      className={`group/media relative block overflow-hidden rounded-xl border border-white/[0.1] bg-black/35 cursor-zoom-in ${
                                        msg.text.trim() ? 'mb-2' : ''
                                      }`}
                                    >
                                      <img
                                        src={msg.attachment.dataUrl}
                                        alt={msg.attachment.name || 'Média chiffré'}
                                        className="max-h-72 w-auto max-w-full object-contain block"
                                      />
                                      {msg.attachment.mimeType === 'image/gif' && (
                                        <span className="absolute top-2 left-2 rounded-md bg-black/70 backdrop-blur-sm border border-white/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                                          GIF
                                        </span>
                                      )}
                                    </button>
                                  )
                                )}

                                {msg.text && (
                                  <p
                                    className={`${messageTextSizeClass} whitespace-pre-wrap break-words`}
                                  >
                                    {msg.text}
                                  </p>
                                )}
                              </div>
                            )}

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

                              {msg.unlockAt && !isTimeLocked && !msg.decryptionError && (
                                <span
                                  title={`Capsule temporelle ouverte (${formatUnlockDateLabel(
                                    msg.unlockAt
                                  )})`}
                                  className="inline-flex items-center text-amber-300/80"
                                >
                                  <Hourglass className="h-3 w-3" />
                                </span>
                              )}

                              {msg.invisibleInk && !isTimeLocked && !msg.decryptionError && (
                                <button
                                  type="button"
                                  onClick={() => revealInkMessage(msg.id)}
                                  title={
                                    isInkVeiled
                                      ? 'Révéler le message à encre invisible'
                                      : 'Re-voiler immédiatement'
                                  }
                                  aria-label={
                                    isInkVeiled
                                      ? 'Révéler le message à encre invisible'
                                      : 'Re-voiler le message'
                                  }
                                  className="inline-flex items-center text-zinc-300 hover:text-white cursor-pointer"
                                >
                                  {isInkVeiled ? (
                                    <Eye className="h-3 w-3" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-emerald-300" />
                                  )}
                                </button>
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

                              {!msg.decryptionError &&
                                !isTimeLocked &&
                                !isInkVeiled &&
                                (msg.text.trim().length > 0 || Boolean(msg.attachment)) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplyingTo(msg);
                                    composerRef.current?.focus();
                                  }}
                                  title="Répondre à ce message"
                                  aria-label="Répondre à ce message"
                                  className="ml-0.5 inline-flex items-center justify-center rounded opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-zinc-400 hover:text-white transition-opacity cursor-pointer"
                                >
                                  <Reply className="h-3 w-3" />
                                </button>
                              )}

                              {!msg.decryptionError &&
                                !isTimeLocked &&
                                !isInkVeiled &&
                                msg.text.trim().length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(msg.text).then(() => {
                                      setCopiedMsgId(msg.id);
                                      window.setTimeout(() => {
                                        setCopiedMsgId((curr) =>
                                          curr === msg.id ? null : curr
                                        );
                                      }, 1600);
                                    }).catch(() => {});
                                  }}
                                  title="Copier le message"
                                  aria-label="Copier le message"
                                  className={`ml-0.5 inline-flex items-center justify-center rounded transition-opacity cursor-pointer ${
                                    copiedMsgId === msg.id
                                      ? 'opacity-100 text-emerald-400'
                                      : 'opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {copiedMsgId === msg.id ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              )}

                              {tts.supported &&
                                !msg.decryptionError &&
                                !isTimeLocked &&
                                !isInkVeiled &&
                                msg.text.trim().length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const speakerPrefix = isMine
                                      ? undefined
                                      : msg.groupId
                                        ? msg.sender
                                          ? getContactDisplayName(msg.sender, friendAliases)
                                          : undefined
                                        : activePeer
                                          ? getContactDisplayName(activePeer, friendAliases)
                                          : undefined;
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
                                  className={`ml-0.5 inline-flex items-center justify-center rounded transition-opacity cursor-pointer ${
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
                                  className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 ml-0.5 text-zinc-400 hover:text-red-400 transition-opacity cursor-pointer"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}

                {(isPeerTyping || activeGroupTypingUser) && (
                  <div className="mt-3 flex items-start">
                    <div className="glass-surface inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs text-zinc-300">
                      <span>
                        {activePeer
                          ? `${getContactDisplayName(activePeer, friendAliases)} écrit`
                          : `${activeGroupTypingUser} écrit`}
                      </span>
                      <span className="inline-flex items-center gap-1" aria-hidden="true">
                        <span className="h-1 w-1 rounded-full bg-zinc-400 typing-dot-1" />
                        <span className="h-1 w-1 rounded-full bg-zinc-400 typing-dot-2" />
                        <span className="h-1 w-1 rounded-full bg-zinc-400 typing-dot-3" />
                      </span>
                    </div>
                  </div>
                )}

                <div
                  ref={messagesEndRef}
                  style={{ scrollMarginBottom: bottomDockHeight + 16 }}
                />
                </div>
              </div>

              {showScrollToBottom && (
                <button
                  type="button"
                  onClick={() => {
                    isNearBottomRef.current = true;
                    setUnreadBelowCount(0);
                    setShowScrollToBottom(false);
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  style={{ bottom: bottomDockHeight + 12 }}
                  aria-label="Descendre aux derniers messages"
                  className="absolute right-4 sm:right-6 z-20 glass-liquid flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-white hover:bg-white/[0.14] transition-all cursor-pointer active:scale-95"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {unreadBelowCount > 0 && (
                    <span className="font-mono text-[11px] font-semibold text-emerald-300 tabular-nums">
                      {unreadBelowCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Floating Liquid Glass Composer Dock */}
            <div
              ref={bottomDockRef}
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-3"
            >
              <footer className="pointer-events-auto glass-liquid max-w-4xl mx-auto rounded-[22px] sm:rounded-[24px] px-2.5 sm:px-4 py-2.5">
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
                      className="glass-control flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white shrink-0 cursor-pointer"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                      <span>Débloquer</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {replyingTo && (
                    <div className="glass-surface mb-2 flex items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-emerald-300 truncate">
                          Réponse à{' '}
                          {replyingTo.fromId === session.user.id
                            ? 'vous-même'
                            : replyingTo.sender
                              ? getContactDisplayName(replyingTo.sender, friendAliases)
                              : activePeer
                                ? getContactDisplayName(activePeer, friendAliases)
                                : 'Contact'}
                        </p>
                        <p className="text-zinc-400 truncate">
                          {replyingTo.text ||
                            (replyingTo.attachment?.kind === 'audio'
                              ? 'Message vocal'
                              : replyingTo.attachment?.mimeType === 'image/gif'
                                ? 'GIF animé'
                                : 'Image')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        aria-label="Annuler la réponse"
                        className="glass-control h-7 w-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white cursor-pointer shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {pendingAttachment && (
                    <div className="glass-surface mb-2 flex items-center justify-between gap-3 rounded-2xl px-3 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={pendingAttachment.dataUrl}
                          alt={pendingAttachment.name || 'Aperçu du média'}
                          className="h-12 w-12 rounded-xl object-cover border border-white/[0.12] shrink-0 bg-black/40"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">
                            {pendingAttachment.mimeType === 'image/gif'
                              ? 'GIF animé prêt à chiffrer'
                              : 'Image prête à chiffrer'}
                          </p>
                          {pendingAttachment.name && (
                            <p className="text-[11px] text-zinc-400 truncate">
                              {pendingAttachment.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(null)}
                        aria-label="Retirer le média"
                        className="glass-control h-8 w-8 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white cursor-pointer shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {ephemeralMenuOpen && (
                    <div className="animate-tab-enter glass-surface mb-2 rounded-2xl p-3 space-y-3">
                      {/* 1. Suppression automatique */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300 whitespace-nowrap">
                          <Clock className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                          <span>Suppression auto</span>
                        </span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {EPHEMERAL_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setEphemeralDuration(opt.value)}
                              className={`min-h-[30px] rounded-lg px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                                ephemeralDuration === opt.value
                                  ? 'glass-control-active text-white'
                                  : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="glass-hairline" />

                      {/* 2. Encre invisible */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                            <EyeOff className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                            <span>Encre invisible</span>
                          </span>
                          <span className="block text-[10px] text-zinc-400">
                            Voile opaque jusqu’au toucher (8 s)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInvisibleInk((v) => !v)}
                          aria-pressed={invisibleInk}
                          className={`min-h-[30px] rounded-lg px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                            invisibleInk
                              ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                              : 'glass-control text-zinc-300 hover:text-white'
                          }`}
                        >
                          {invisibleInk ? 'Activée' : 'Désactivée'}
                        </button>
                      </div>

                      <div className="glass-hairline" />

                      {/* 3. Capsule temporelle */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                            <Hourglass className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                            <span>Capsule temporelle</span>
                          </span>
                          <div className="flex items-center gap-1 flex-wrap">
                            {[
                              { label: 'Immédiat', ts: null },
                              { label: '+1 min', ts: () => Date.now() + 60_000 },
                              { label: '+15 min', ts: () => Date.now() + 900_000 },
                              { label: '+1 h', ts: () => Date.now() + 3_600_000 },
                              {
                                label: 'Demain 09h',
                                ts: () => {
                                  const d = new Date();
                                  d.setDate(d.getDate() + 1);
                                  d.setHours(9, 0, 0, 0);
                                  return d.getTime();
                                },
                              },
                            ].map((preset) => {
                              const active = preset.ts === null && unlockAt === null;
                              return (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => {
                                    if (preset.ts === null) {
                                      setUnlockAt(null);
                                      setCustomUnlockLocal('');
                                    } else {
                                      const nextTs = preset.ts();
                                      setUnlockAt(nextTs);
                                      setCustomUnlockLocal(toDatetimeLocalValue(nextTs));
                                    }
                                  }}
                                  className={`min-h-[30px] rounded-lg px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                                    active
                                      ? 'glass-control-active text-white'
                                      : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="custom-unlock-datetime"
                            className="text-[10px] text-zinc-400 shrink-0"
                          >
                            Date précise :
                          </label>
                          <input
                            id="custom-unlock-datetime"
                            type="datetime-local"
                            min={toDatetimeLocalValue(Date.now() + 60_000)}
                            value={customUnlockLocal}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCustomUnlockLocal(val);
                              if (!val) {
                                setUnlockAt(null);
                                return;
                              }
                              const parsed = new Date(val).getTime();
                              if (!Number.isNaN(parsed) && parsed > Date.now() + 10_000) {
                                setUnlockAt(parsed);
                              }
                            }}
                            className="glass-input rounded-lg px-2 py-1 text-[11px] font-mono text-white [color-scheme:dark] focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {(ephemeralDuration > 0 ||
                    invisibleInk ||
                    (unlockAt && unlockAt > nowTick)) && (
                    <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                      {ephemeralDuration > 0 && (
                        <button
                          type="button"
                          onClick={() => setEphemeralDuration(0)}
                          title="Désactiver la suppression automatique"
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25 cursor-pointer"
                        >
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>
                            {
                              EPHEMERAL_OPTIONS.find(
                                (o) => o.value === ephemeralDuration
                              )?.label
                            }
                          </span>
                          <X className="h-3 w-3 opacity-80" />
                        </button>
                      )}
                      {invisibleInk && (
                        <button
                          type="button"
                          onClick={() => setInvisibleInk(false)}
                          title="Désactiver l’encre invisible"
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          <EyeOff className="h-3 w-3 shrink-0" />
                          <span>Encre invisible</span>
                          <X className="h-3 w-3 opacity-80" />
                        </button>
                      )}
                      {unlockAt && unlockAt > nowTick && (
                        <button
                          type="button"
                          onClick={() => {
                            setUnlockAt(null);
                            setCustomUnlockLocal('');
                          }}
                          title="Retirer la capsule temporelle"
                          className="inline-flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/25 cursor-pointer"
                        >
                          <Hourglass className="h-3 w-3 shrink-0" />
                          <span>Capsule · {formatUnlockDateLabel(unlockAt)}</span>
                          <X className="h-3 w-3 opacity-80" />
                        </button>
                      )}
                    </div>
                  )}

                  {sendError && (
                    <p className="mb-2 text-xs text-red-400">{sendError}</p>
                  )}
                  <input
                    ref={chatMediaInputRef}
                    type="file"
                    accept="image/*,.gif"
                    onChange={handleComposerFileChange}
                    className="hidden"
                  />

                  {isRecordingVoice || processingVoice ? (
                    <div className="flex items-center gap-2 sm:gap-2.5">
                      <div className="flex-1 glass-input rounded-2xl px-3 py-2 flex items-center justify-between gap-2 min-h-[44px]">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {processingVoice ? (
                            <Loader2 className="h-4 w-4 animate-spin text-emerald-300 shrink-0" />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-full bg-rose-400 animate-pulse shrink-0"
                            />
                          )}
                          <span className="font-mono text-xs font-semibold text-white tabular-nums">
                            {processingVoice
                              ? voiceMaskEnabled
                                ? 'Anonymisation...'
                                : 'Chiffrement...'
                              : formatAudioDuration(recordingSec)}
                          </span>
                        </div>

                        {!processingVoice && (
                          <button
                            type="button"
                            onClick={() => setVoiceMaskEnabled((v) => !v)}
                            aria-pressed={voiceMaskEnabled}
                            title="Modifie le timbre de votre voix avant chiffrement"
                            className={`min-h-[30px] inline-flex items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium transition-all cursor-pointer shrink-0 ${
                              voiceMaskEnabled
                                ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                                : 'glass-control text-zinc-300 hover:text-white'
                            }`}
                          >
                            <Shield className="h-3 w-3 shrink-0" />
                            <span className="hidden sm:inline">Voix anonyme</span>
                            <span className="sm:hidden">Anonyme</span>
                          </button>
                        )}
                      </div>

                      {!processingVoice && (
                        <>
                          <button
                            type="button"
                            onClick={cancelVoiceRecording}
                            aria-label="Annuler la note vocale"
                            title="Annuler"
                            className="glass-control h-[44px] w-[44px] flex items-center justify-center rounded-2xl text-zinc-300 hover:text-rose-300 shrink-0 cursor-pointer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={finishAndSendVoiceRecording}
                            aria-label="Chiffrer et envoyer la note vocale"
                            className="btn-specular flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-2xl px-4 sm:px-5 text-sm font-medium transition-all active:scale-[0.97] cursor-pointer"
                          >
                            <Send className="h-4 w-4" />
                            <span className="hidden sm:inline">Envoyer</span>
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <form
                      onSubmit={handleSendMessage}
                      className="flex items-end gap-2 sm:gap-2.5"
                    >
                      <div className="flex-1 glass-input rounded-2xl px-1.5 sm:px-2.5 py-1.5 flex items-end gap-1">
                        <button
                          type="button"
                          disabled={preparingAttachment || sending}
                          onClick={() => chatMediaInputRef.current?.click()}
                          title="Joindre une image ou un GIF animé"
                          aria-label="Joindre une image ou un GIF animé"
                          className="h-9 w-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {preparingAttachment ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={preparingAttachment || sending}
                          onClick={() => void startVoiceRecording()}
                          title="Enregistrer une note vocale chiffrée"
                          aria-label="Enregistrer une note vocale chiffrée"
                          className="h-9 w-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          <Mic className="h-4 w-4" strokeWidth={1.75} />
                        </button>

                        <button
                          type="button"
                          onClick={() => setEphemeralMenuOpen((v) => !v)}
                          aria-expanded={ephemeralMenuOpen}
                          title="Confidentialité du message (éphémère, encre invisible, capsule)"
                          aria-label="Options de confidentialité du message"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl transition-all cursor-pointer shrink-0 ${
                            ephemeralDuration > 0 ||
                            invisibleInk ||
                            (unlockAt !== null && unlockAt > nowTick)
                              ? 'border border-amber-400/35 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                              : ephemeralMenuOpen
                                ? 'bg-white/[0.1] text-white'
                                : 'text-zinc-400 hover:bg-white/[0.08] hover:text-white'
                          }`}
                        >
                          <Clock className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                        </button>

                        <textarea
                          ref={composerRef}
                          rows={1}
                          value={composerText}
                          onPaste={handleComposerPaste}
                          onChange={(e) => {
                            handleComposerChange(e.target.value);
                            const el = composerRef.current;
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                              if (composerRef.current) {
                                composerRef.current.style.height = 'auto';
                              }
                            }
                          }}
                          placeholder={
                            invisibleInk
                              ? 'Message à encre invisible...'
                              : unlockAt && unlockAt > nowTick
                                ? 'Capsule temporelle...'
                                : ephemeralDuration > 0
                                  ? `Message éphémère (${
                                      EPHEMERAL_OPTIONS.find(
                                        (o) => o.value === ephemeralDuration
                                      )?.label
                                    })...`
                                  : activeGroup
                                    ? `Écrire dans ${activeGroup.name}...`
                                    : 'Message, image ou vocal...'
                          }
                          className="w-full py-1.5 pl-1 resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-zinc-500 focus:outline-none max-h-32"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={
                          (!composerText.trim() && !pendingAttachment) ||
                          sending ||
                          preparingAttachment
                        }
                        onClick={() => {
                          if (composerRef.current) {
                            composerRef.current.style.height = 'auto';
                          }
                        }}
                        aria-label="Envoyer le message"
                        className="btn-specular flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-2xl px-4 sm:px-5 text-sm font-medium transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      >
                        <Send className="h-4 w-4" />
                        <span className="hidden sm:inline">Envoyer</span>
                      </button>
                    </form>
                  )}
                </>
              )}
              </footer>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="glass-liquid animate-panel-enter max-w-lg w-full rounded-3xl p-7 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <UserAvatar user={session.user} size="md" />
                  <div className="min-w-0">
                    <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-white truncate">
                      Bonjour, {session.user.displayName}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Choisissez une discussion ou démarrez un nouvel échange.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyOwnHandle}
                  title="Copier votre identifiant"
                  className="glass-control min-h-[36px] inline-flex items-center gap-2 self-start sm:self-auto rounded-xl px-3 py-1.5 font-mono text-xs text-zinc-200 hover:text-white cursor-pointer shrink-0"
                >
                  <span>{session.user.handle}</span>
                  {copiedHandle ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 opacity-65" />
                  )}
                </button>
              </div>

              <div className="grid sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(true)}
                  className="glass-surface glass-interactive rounded-2xl p-4 text-left space-y-2 cursor-pointer"
                >
                  <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-semibold text-white">
                      Nouveau contact
                    </span>
                    <span className="block mt-0.5 text-[11px] text-zinc-400">
                      Ajouter par @identifiant
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(true)}
                  className="glass-surface glass-interactive rounded-2xl p-4 text-left space-y-2 cursor-pointer"
                >
                  <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-semibold text-white">
                      Créer un groupe
                    </span>
                    <span className="block mt-0.5 text-[11px] text-zinc-400">
                      Salon privé chiffré
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSidebarTab('friends');
                    setMobileShowChat(false);
                  }}
                  className="glass-surface glass-interactive rounded-2xl p-4 text-left space-y-2 cursor-pointer"
                >
                  <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white">
                    <UserPlus className="h-4 w-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-semibold text-white">
                      Amis{friendsSnapshot.incoming.length > 0 ? ` (${friendsSnapshot.incoming.length})` : ''}
                    </span>
                    <span className="block mt-0.5 text-[11px] text-zinc-400">
                      Contacts & demandes
                    </span>
                  </div>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/[0.08] text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(true)}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Personnaliser le profil et les bulles
                </button>
                {onOpenPresentation && (
                  <button
                    type="button"
                    onClick={onOpenPresentation}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    Découvrir HOI
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      </div>

      <NewContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        token={session.token}
        currentUser={session.user}
        friendAliases={friendAliases}
        onSelectPeer={handleSelectPeer}
        onViewProfile={(u) => setViewedProfileUser(u)}
      />

      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        session={session}
        friends={friendsSnapshot.friends}
        friendAliases={friendAliases}
        onGroupCreated={(group) => handleSelectGroup(group)}
      />

      <GroupInfoModal
        isOpen={isGroupInfoOpen}
        onClose={() => setIsGroupInfoOpen(false)}
        group={activeGroup}
        session={session}
        friendAliases={friendAliases}
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
        messageTextSize={messageTextSize}
        onChangeMessageTextSize={handleChangeMessageTextSize}
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
        friendAlias={
          viewedProfileUser ? friendAliases[viewedProfileUser.id] : undefined
        }
        onSaveFriendAlias={handleSaveFriendAlias}
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
        currentUserFingerprint={session.user.fingerprint}
        peer={
          call.peer
            ? {
                ...call.peer,
                displayName: getContactDisplayName(call.peer, friendAliases),
              }
            : null
        }
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        audioMuted={call.audioMuted}
        videoEnabled={call.videoEnabled}
        screenSharing={call.screenSharing}
        facingMode={call.facingMode}
        hasMultipleCameras={call.hasMultipleCameras}
        audioInputs={call.audioInputs}
        audioOutputs={call.audioOutputs}
        selectedAudioInputId={call.selectedAudioInputId}
        selectedAudioOutputId={call.selectedAudioOutputId}
        peerAudioMuted={call.peerAudioMuted}
        peerVideoEnabled={call.peerVideoEnabled}
        peerRinging={call.peerRinging}
        peerQueued={call.peerQueued}
        peerPushSent={call.peerPushSent}
        isMinimized={call.isMinimized}
        durationSec={call.durationSec}
        notice={call.notice}
        endedPrompt={
          call.endedPrompt
            ? {
                ...call.endedPrompt,
                peer: {
                  ...call.endedPrompt.peer,
                  displayName: getContactDisplayName(
                    call.endedPrompt.peer,
                    friendAliases
                  ),
                },
              }
            : null
        }
        localAudioLevel={call.localAudioLevel}
        remoteAudioLevel={call.remoteAudioLevel}
        stats={call.stats}
        onDismissNotice={call.dismissNotice}
        onRedial={(targetPeer, targetType) => void call.startCall(targetPeer, targetType)}
        onToggleMinimize={() => call.setIsMinimized((v) => !v)}
        onAccept={(withVideo) => void call.acceptIncomingCall(withVideo)}
        onDecline={call.declineIncomingCall}
        onHangup={call.hangupCall}
        onToggleMute={call.toggleMute}
        onToggleVideo={() => void call.toggleVideo()}
        onToggleScreenShare={() => void call.toggleScreenShare()}
        onSwitchCamera={() => void call.switchCamera()}
        onSelectAudioInput={(id) => void call.selectAudioInput(id)}
        onSelectAudioOutput={call.selectAudioOutput}
      />

      {lightboxMedia && (
        <div
          className="animate-backdrop-enter fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-xl p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu du média"
          onClick={() => setLightboxMedia(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxMedia(null)}
            aria-label="Fermer l’aperçu"
            className="glass-control backdrop-blur-md absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-liquid animate-lightbox-enter rounded-3xl p-2 sm:p-3 max-w-[92vw] flex flex-col items-center gap-2"
          >
            <img
              src={lightboxMedia.dataUrl}
              alt={lightboxMedia.name || 'Média chiffré'}
              className="max-h-[82dvh] max-w-full rounded-2xl object-contain block"
            />
            {(lightboxMedia.name || lightboxMedia.mimeType === 'image/gif') && (
              <div className="w-full flex items-center justify-between gap-3 px-2 py-1 text-xs text-zinc-300">
                <span className="truncate">
                  {lightboxMedia.name || 'Média chiffré'}
                </span>
                {lightboxMedia.mimeType === 'image/gif' && (
                  <span className="font-mono text-[11px] text-emerald-300 shrink-0">
                    GIF animé
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right-Side Liquid Glass Utility & Theme Drawer */}
      {utilityMenuOpen && (
        <div
          className="fixed inset-0 z-[70] flex justify-end p-2.5 sm:p-3.5"
          role="dialog"
          aria-modal="true"
          aria-label="Menu et options"
        >
          <div
            aria-hidden="true"
            onClick={() => setUtilityMenuOpen(false)}
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px] animate-backdrop-enter"
          />

          <div className="glass-liquid animate-panel-enter relative z-10 w-[min(350px,calc(100vw-1.25rem))] max-h-full flex flex-col self-start rounded-3xl shadow-2xl overflow-hidden">
            {/* Drawer Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar user={session.user} size="sm" />
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white truncate">
                    {session.user.displayName}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-400 truncate">
                    {session.user.handle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUtilityMenuOpen(false)}
                aria-label="Fermer le menu"
                className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white shrink-0 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Menu Actions */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {/* Theme Selector (Inline Expandable) */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUtilityThemeExpanded((v) => !v)}
                  aria-expanded={utilityThemeExpanded}
                  className="w-full min-h-[48px] flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white shrink-0">
                      <Palette className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-white">
                        Thème de l’interface
                      </span>
                      <span className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-400 truncate">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 rounded-full shrink-0 ${currentAppTheme.accentSwatch}`}
                        />
                        <span className="truncate">
                          {currentAppTheme.animated
                            ? `Animé · ${currentAppTheme.label}`
                            : currentAppTheme.label}
                        </span>
                      </span>
                    </div>
                  </div>
                  {utilityThemeExpanded ? (
                    <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
                  )}
                </button>

                {utilityThemeExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-white/[0.07]">
                    <ThemeGrid
                      compact
                      value={appTheme}
                      onChange={(next) => {
                        setAppTheme(next);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Shoulder Shield (Anti-Épaule) */}
              <button
                type="button"
                onClick={() => setShoulderShield((v) => !v)}
                aria-pressed={shoulderShield}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`glass-control h-9 w-9 flex items-center justify-center rounded-xl shrink-0 ${
                      shoulderShield
                        ? 'text-emerald-400 border-emerald-400/30'
                        : 'text-white'
                    }`}
                  >
                    <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-white">
                      Bouclier anti-épaule
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      Floute les aperçus &amp; bulles (Alt+V)
                    </span>
                  </div>
                </div>
                <span
                  className={`text-[11px] font-medium shrink-0 ${
                    shoulderShield ? 'text-emerald-300' : 'text-zinc-500'
                  }`}
                >
                  {shoulderShield ? 'Actif' : 'Off'}
                </span>
              </button>

              {/* Camouflage Mode (Instant Calculator Screen with Secret Combination) */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => {
                      ttsStopRef.current();
                      setUtilityMenuOpen(false);
                      setCamouflageMode(true);
                    }}
                    className="flex-1 min-w-0 min-h-[48px] flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white shrink-0">
                      <Calculator className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-white">
                        Mode camouflage
                      </span>
                      <span className="block text-[11px] text-zinc-400 truncate">
                        Retour : <span className="font-mono text-zinc-200">{camouflageCode}=</span>
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCamouflageConfigOpen((prev) => {
                        const next = !prev;
                        if (next) {
                          setCamouflageCodeDraft(camouflageCode);
                          setCamouflageCodeError(null);
                        }
                        return next;
                      });
                    }}
                    aria-expanded={camouflageConfigOpen}
                    title="Personnaliser la combinaison secrète de retour"
                    className="glass-control h-8 px-2.5 rounded-xl text-[11px] font-medium text-zinc-300 hover:text-white shrink-0 cursor-pointer"
                  >
                    {camouflageConfigOpen ? 'Fermer' : 'Code'}
                  </button>
                </div>

                {camouflageConfigOpen && (
                  <div className="px-3 pb-3 pt-2 border-t border-white/[0.07] space-y-2">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      Tapez cette combinaison suivie de <span className="font-mono text-white">=</span> sur la calculatrice pour revenir dans HOI :
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const clean = normalizeCamouflageCode(camouflageCodeDraft);
                        if (clean.length < 3) {
                          setCamouflageCodeError('Minimum 3 touches (ex. 1337 ou 42×2).');
                          return;
                        }
                        setCamouflageCode(clean);
                        setCamouflageCodeError(null);
                        setCamouflageConfigOpen(false);
                        try {
                          window.localStorage.setItem(CAMOUFLAGE_CODE_PREF_KEY, clean);
                        } catch {
                          // Ignore storage error
                        }
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        value={camouflageCodeDraft}
                        onChange={(e) => {
                          setCamouflageCodeDraft(normalizeCamouflageCode(e.target.value));
                          setCamouflageCodeError(null);
                        }}
                        placeholder="Ex: 1337"
                        maxLength={12}
                        aria-label="Combinaison secrète de la calculatrice"
                        className="glass-input min-w-0 flex-1 rounded-xl px-2.5 py-1.5 font-mono text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="btn-specular h-8 px-3 rounded-xl text-[11px] font-semibold shrink-0 cursor-pointer"
                      >
                        Valider
                      </button>
                    </form>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-zinc-500 mr-1">Symboles :</span>
                      {(['+', '-', '×', '÷'] as const).map((sym) => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() =>
                            setCamouflageCodeDraft((prev) =>
                              normalizeCamouflageCode(`${prev}${sym}`)
                            )
                          }
                          className="glass-control h-7 w-7 rounded-lg font-mono text-xs text-zinc-200 hover:text-white cursor-pointer"
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                    {camouflageCodeError && (
                      <p className="text-[11px] text-rose-300">{camouflageCodeError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Notifications */}
              <button
                type="button"
                onClick={() => {
                  setUtilityMenuOpen(false);
                  setIsNotificationsModalOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`glass-control h-9 w-9 flex items-center justify-center rounded-xl shrink-0 ${
                      push.isSubscribed && push.permission === 'granted'
                        ? 'text-emerald-400 border-emerald-400/30'
                        : 'text-white'
                    }`}
                  >
                    {push.isSubscribed && push.permission === 'granted' ? (
                      <BellRing className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <Bell className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-white">
                      Notifications push
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      Alertes discrètes en temps réel
                    </span>
                  </div>
                </div>
                <span
                  className={`text-[11px] font-medium shrink-0 ${
                    push.isSubscribed && push.permission === 'granted'
                      ? 'text-emerald-300'
                      : 'text-zinc-500'
                  }`}
                >
                  {push.isSubscribed && push.permission === 'granted' ? 'Actives' : 'Off'}
                </span>
              </button>

              {/* Install App */}
              {!pwaInstall.isInstalled && (
                <button
                  type="button"
                  onClick={() => {
                    setUtilityMenuOpen(false);
                    void handleInstallTrigger();
                  }}
                  className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white shrink-0">
                      <Download className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-white">
                        Installer l’application
                      </span>
                      <span className="block text-[11px] text-zinc-400 truncate">
                        Huawei, Android, iOS &amp; PC
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                </button>
              )}

              {/* Profile & Bubble Appearance */}
              <button
                type="button"
                onClick={() => {
                  setUtilityMenuOpen(false);
                  setIsProfileModalOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white shrink-0">
                    <User className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-white">
                      Mon profil &amp; apparence
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      Avatar, bannière, style des bulles
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
              </button>

              {/* Presentation */}
              {onOpenPresentation && (
                <button
                  type="button"
                  onClick={() => {
                    setUtilityMenuOpen(false);
                    onOpenPresentation();
                  }}
                  className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="glass-control h-9 w-9 flex items-center justify-center rounded-xl text-white shrink-0">
                      <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-white">
                        Découvrir HOI
                      </span>
                      <span className="block text-[11px] text-zinc-400 truncate">
                        Présentation &amp; chiffrement
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                </button>
              )}
            </div>

            {/* Footer: Lock / Sign out */}
            <div className="p-3 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  setUtilityMenuOpen(false);
                  handleLockSession();
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 hover:border-rose-400/40 transition-all cursor-pointer"
              >
                <Lock className="h-4 w-4 shrink-0" strokeWidth={1.85} />
                <span>Se déconnecter / Verrouiller</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Conversation from Home Confirmation Dialog */}
      {pendingDeleteThread && (
        <div
          className="animate-backdrop-enter fixed inset-0 z-[75] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-thread-title"
          onClick={() => !deletingThread && setPendingDeleteThread(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-liquid animate-panel-enter max-w-sm w-full rounded-3xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="h-10 w-10 rounded-2xl border border-rose-400/30 bg-rose-500/15 text-rose-300 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4" strokeWidth={1.85} />
              </span>
              <div className="min-w-0">
                <h3
                  id="delete-thread-title"
                  className="font-[family-name:var(--font-display)] text-base font-semibold text-white"
                >
                  Supprimer de l’accueil
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  La conversation avec{' '}
                  <span className="font-semibold text-white">
                    {pendingDeleteThread.label}
                  </span>{' '}
                  ne s’affichera plus dans votre accueil. Elle réapparaîtra si un nouveau message arrive ou si vous la rouvrez.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={deletingThread}
                onClick={() => setPendingDeleteThread(null)}
                className="glass-control min-h-[42px] rounded-xl px-4 text-xs font-medium text-zinc-200 hover:text-white disabled:opacity-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={deletingThread}
                onClick={() => void handleConfirmDeleteThread()}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/80 px-4 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {deletingThread && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Supprimer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {camouflageMode && (
        <CamouflageScreen
          secretCode={camouflageCode}
          onExit={() => setCamouflageMode(false)}
        />
      )}
    </div>
  );
};
