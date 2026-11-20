export type AvatarIconKey =
  | 'initials'
  | 'shield'
  | 'moon'
  | 'compass'
  | 'eye'
  | 'feather'
  | 'diamond';

export type AccentToneKey =
  | 'platinum'
  | 'emerald'
  | 'slate'
  | 'amber'
  | 'crimson';

export type AppThemeKey =
  | 'obsidian'
  | 'aurora'
  | 'abyssal'
  | 'amber'
  | 'velvet'
  | 'graphite';

export type GlassIntensity = 'subtle' | 'balanced' | 'deep';

export type BubbleShapeKey = 'rounded' | 'pill' | 'sharp' | 'editorial';

export type BubbleStyleKey = 'glass' | 'solid' | 'outline' | 'elevated';

export type MessageTextSize = 'compact' | 'normal' | 'large';

export interface ChatAttachment {
  kind: 'image';
  dataUrl: string;
  mimeType: string;
  name?: string;
}

export type BannerPresetKey =
  | 'none'
  | 'obsidian'
  | 'monolith'
  | 'eclipse'
  | 'emerald'
  | 'custom';

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  bio?: string;
  biography?: string;
  avatarDataUrl?: string | null;
  avatarIcon?: AvatarIconKey;
  accentTone?: AccentToneKey;
  bannerPreset?: BannerPresetKey;
  bannerDataUrl?: string | null;
  bubbleShape?: BubbleShapeKey;
  bubbleStyle?: BubbleStyleKey;
  ecdhPublicJwk: JsonWebKey;
  ecdsaPublicJwk: JsonWebKey;
  fingerprint: string;
  createdAt: number;
}

export interface FriendRequestRecord {
  id: string;
  fromUser: PublicUser;
  toUser: PublicUser;
  createdAt: number;
}

export interface FriendsSnapshot {
  friends: PublicUser[];
  incoming: FriendRequestRecord[];
  outgoing: FriendRequestRecord[];
  blocked: PublicUser[];
  blockedByIds: string[];
}

export type RelationshipState =
  | 'self'
  | 'none'
  | 'friend'
  | 'incoming_pending'
  | 'outgoing_pending'
  | 'blocked_by_me'
  | 'blocked_by_peer';

export interface EncryptedMessageEnvelope {
  id: string;
  conversationId: string;
  fromId: string;
  toId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  expiresAt: number | null;
  readAt: number | null;
}

export interface GroupKeyEnvelope {
  iv: string;
  wrappedKey: string;
  wrappedByUserId: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  description?: string;
  avatarDataUrl?: string | null;
  bannerPreset?: BannerPresetKey;
  bannerDataUrl?: string | null;
  accentTone?: AccentToneKey;
  creatorId: string;
  members: PublicUser[];
  keyEnvelopes: Record<string, GroupKeyEnvelope>;
  createdAt: number;
  lastMessage?: GroupMessageEnvelope | null;
}

export interface GroupMessageEnvelope {
  id: string;
  groupId: string;
  fromId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  expiresAt: number | null;
}

export interface ReplyReference {
  id: string;
  senderName: string;
  excerpt: string;
}

export interface DecryptedMessage {
  id: string;
  conversationId: string;
  fromId: string;
  toId: string;
  groupId?: string;
  sender?: PublicUser;
  text: string;
  replyTo?: ReplyReference;
  attachment?: ChatAttachment;
  timestamp: number;
  expiresAt: number | null;
  readAt: number | null;
  verified: boolean;
  decryptionError?: boolean;
  rawCiphertext: string;
  rawIv: string;
  rawSignature: string;
}

export interface ConversationSummary {
  peer: PublicUser;
  lastMessage: EncryptedMessageEnvelope | null;
  unreadCount: number;
}

export interface UnlockedSession {
  token: string;
  user: PublicUser;
  ecdhPrivateKey: CryptoKey;
  ecdsaPrivateKey: CryptoKey;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}

export type EphemeralDuration = 0 | 30 | 300 | 86400;
