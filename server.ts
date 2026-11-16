import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import * as webpush from 'web-push';
import { WebSocket, WebSocketServer } from 'ws';

interface StoredUser {
  id: string;
  lookupId: string;
  handle: string;
  displayName: string;
  bio?: string;
  biography?: string;
  avatarDataUrl?: string | null;
  avatarIcon?: string;
  accentTone?: string;
  bannerPreset?: string;
  bannerDataUrl?: string | null;
  ecdhPublicJwk: Record<string, unknown>;
  ecdsaPublicJwk: Record<string, unknown>;
  fingerprint: string;
  encryptedVault: string;
  vaultSalt: string;
  vaultIv: string;
  createdAt: number;
  lastSeen: number;
}

interface StoredMessage {
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

interface StoredGroupKeyEnvelope {
  iv: string;
  wrappedKey: string;
  wrappedByUserId: string;
}

interface StoredGroup {
  id: string;
  name: string;
  description?: string;
  avatarDataUrl?: string | null;
  bannerPreset?: string;
  bannerDataUrl?: string | null;
  accentTone?: string;
  creatorId: string;
  memberIds: string[];
  keyEnvelopes: Record<string, StoredGroupKeyEnvelope>;
  createdAt: number;
}

interface StoredGroupMessage {
  id: string;
  groupId: string;
  fromId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  expiresAt: number | null;
}

interface StoredFriendRequest {
  id: string;
  fromId: string;
  toId: string;
  createdAt: number;
}

interface StoredPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  discreetMode?: boolean;
  userAgent?: string;
  createdAt: number;
  updatedAt: number;
}

interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

interface VaultDiskState {
  users: StoredUser[];
  messages: StoredMessage[];
  contacts: Record<string, string[]>;
  groups: StoredGroup[];
  groupMessages: StoredGroupMessage[];
  friendships: Record<string, string[]>;
  friendRequests: StoredFriendRequest[];
  blocks: Record<string, string[]>;
  pushSubscriptions: Record<string, StoredPushSubscription[]>;
  sessions: Record<string, SessionRecord>;
  vapidKeys?: VapidKeyPair;
}

interface PendingChallenge {
  challenge: string;
  userId: string;
  expiresAt: number;
}

interface SessionRecord {
  userId: string;
  createdAt: number;
}

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');

function loadVault(): VaultDiskState {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(VAULT_FILE)) {
      return {
        users: [],
        messages: [],
        contacts: {},
        groups: [],
        groupMessages: [],
        friendships: {},
        friendRequests: [],
        blocks: {},
        pushSubscriptions: {},
        sessions: {},
      };
    }
    const raw = fs.readFileSync(VAULT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultDiskState>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      contacts: parsed.contacts && typeof parsed.contacts === 'object' ? parsed.contacts : {},
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      groupMessages: Array.isArray(parsed.groupMessages) ? parsed.groupMessages : [],
      friendships:
        parsed.friendships && typeof parsed.friendships === 'object'
          ? parsed.friendships
          : {},
      friendRequests: Array.isArray(parsed.friendRequests)
        ? parsed.friendRequests
        : [],
      blocks:
        parsed.blocks && typeof parsed.blocks === 'object' ? parsed.blocks : {},
      pushSubscriptions:
        parsed.pushSubscriptions && typeof parsed.pushSubscriptions === 'object'
          ? parsed.pushSubscriptions
          : {},
      sessions:
        parsed.sessions && typeof parsed.sessions === 'object'
          ? parsed.sessions
          : {},
      vapidKeys:
        parsed.vapidKeys &&
        typeof parsed.vapidKeys.publicKey === 'string' &&
        typeof parsed.vapidKeys.privateKey === 'string'
          ? parsed.vapidKeys
          : undefined,
    };
  } catch (err) {
    console.error('Failed to load vault.json, initializing fresh store:', err);
    return {
      users: [],
      messages: [],
      contacts: {},
      groups: [],
      groupMessages: [],
      friendships: {},
      friendRequests: [],
      blocks: {},
      pushSubscriptions: {},
      sessions: {},
    };
  }
}

const state: VaultDiskState = loadVault();
const challenges = new Map<string, PendingChallenge>();
const sessions = new Map<string, SessionRecord>(Object.entries(state.sessions));
const activeSockets = new Map<string, Set<WebSocket>>();

function createPersistedSession(userId: string, now = Date.now()): string {
  const token = crypto.randomBytes(32).toString('hex');
  const record: SessionRecord = { userId, createdAt: now };
  sessions.set(token, record);
  state.sessions[token] = record;
  schedulePersist();
  return token;
}

function deletePersistedSession(token: string) {
  sessions.delete(token);
  if (state.sessions[token]) {
    delete state.sessions[token];
    schedulePersist();
  }
}

let writeTimer: NodeJS.Timeout | null = null;
function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${VAULT_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(state), 'utf8');
      fs.renameSync(tmpFile, VAULT_FILE);
    } catch (err) {
      console.error('Failed to persist vault state:', err);
    }
  }, 150);
}

function toPublicUser(u: StoredUser) {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    bio: u.bio ?? '',
    biography: u.biography ?? '',
    avatarDataUrl: u.avatarDataUrl ?? null,
    avatarIcon: u.avatarIcon ?? 'initials',
    accentTone: u.accentTone ?? 'platinum',
    bannerPreset: u.bannerPreset ?? 'obsidian',
    bannerDataUrl: u.bannerDataUrl ?? null,
    ecdhPublicJwk: u.ecdhPublicJwk,
    ecdsaPublicJwk: u.ecdsaPublicJwk,
    fingerprint: u.fingerprint,
    createdAt: u.createdAt,
  };
}

function sanitizeHandlePrefix(displayName: string): string {
  const cleaned = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 14);
  return cleaned || 'ombre';
}

function generateUniqueHandle(displayName: string): string {
  const base = sanitizeHandlePrefix(displayName);
  for (let i = 0; i < 10; i++) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const candidate = `@${base}#${suffix}`;
    if (!state.users.some((u) => u.handle.toLowerCase() === candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `@${base}#${crypto.randomBytes(3).toString('hex')}`;
}

function ensureContactLink(userId: string, peerId: string) {
  if (!state.contacts[userId]) {
    state.contacts[userId] = [];
  }
  if (!state.contacts[userId].includes(peerId)) {
    state.contacts[userId].push(peerId);
  }
}

function sendToUser(userId: string, payload: unknown) {
  const sockets = activeSockets.get(userId);
  if (!sockets) return;
  const serialized = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function resolveVapidKeys(): VapidKeyPair {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }
  if (state.vapidKeys?.publicKey && state.vapidKeys?.privateKey) {
    return state.vapidKeys;
  }
  const generated = webpush.generateVAPIDKeys();
  state.vapidKeys = generated;
  schedulePersist();
  return generated;
}

const vapidKeys = resolveVapidKeys();
const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:security@discret.app';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

interface PushNotificationBuildContext {
  title: string;
  body: string;
  discreetTitle?: string;
  discreetBody?: string;
  tag: string;
  forceShow?: boolean;
  data: Record<string, unknown>;
}

async function sendPushToUser(
  userId: string,
  payload: PushNotificationBuildContext
): Promise<{ sent: number; failed: number; removed: number }> {
  const subs = state.pushSubscriptions[userId];
  if (!Array.isArray(subs) || subs.length === 0) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const invalidEndpoints = new Set<string>();

  await Promise.all(
    subs.map(async (sub) => {
      const useDiscreet = Boolean(sub.discreetMode);
      const bodyPayload = JSON.stringify({
        title: useDiscreet ? payload.discreetTitle || 'DISCRET' : payload.title,
        body: useDiscreet
          ? payload.discreetBody || 'Nouvelle activité chiffrée reçue.'
          : payload.body,
        tag: useDiscreet ? 'discret-activity' : payload.tag,
        forceShow: Boolean(payload.forceShow),
        data: payload.data,
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime,
            keys: sub.keys,
          },
          bodyPayload,
          { TTL: 86400, urgency: 'high' }
        );
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          invalidEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (invalidEndpoints.size > 0) {
    state.pushSubscriptions[userId] = subs.filter(
      (s) => !invalidEndpoints.has(s.endpoint)
    );
    schedulePersist();
  }

  return { sent, failed, removed: invalidEndpoints.size };
}

function isBlockedBy(blockerId: string, targetId: string): boolean {
  const list = state.blocks[blockerId];
  return Array.isArray(list) && list.includes(targetId);
}

function isBlockedBetween(userA: string, userB: string): boolean {
  return isBlockedBy(userA, userB) || isBlockedBy(userB, userA);
}

function areFriends(userA: string, userB: string): boolean {
  const list = state.friendships[userA];
  return Array.isArray(list) && list.includes(userB);
}

function addFriendship(userA: string, userB: string) {
  if (!state.friendships[userA]) state.friendships[userA] = [];
  if (!state.friendships[userB]) state.friendships[userB] = [];
  if (!state.friendships[userA].includes(userB)) state.friendships[userA].push(userB);
  if (!state.friendships[userB].includes(userA)) state.friendships[userB].push(userA);
}

function removeFriendship(userA: string, userB: string) {
  if (state.friendships[userA]) {
    state.friendships[userA] = state.friendships[userA].filter((id) => id !== userB);
  }
  if (state.friendships[userB]) {
    state.friendships[userB] = state.friendships[userB].filter((id) => id !== userA);
  }
}

function removeRequestsBetween(userA: string, userB: string) {
  state.friendRequests = state.friendRequests.filter(
    (r) =>
      !(
        (r.fromId === userA && r.toId === userB) ||
        (r.fromId === userB && r.toId === userA)
      )
  );
}

function buildFriendsSnapshot(userId: string) {
  const friendIds = state.friendships[userId] ?? [];
  const friends = friendIds
    .map((id) => state.users.find((u) => u.id === id))
    .filter((u): u is StoredUser => Boolean(u))
    .map(toPublicUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

  const blockedIds = state.blocks[userId] ?? [];
  const blocked = blockedIds
    .map((id) => state.users.find((u) => u.id === id))
    .filter((u): u is StoredUser => Boolean(u))
    .map(toPublicUser);

  const blockedByIds = Object.entries(state.blocks)
    .filter(([, list]) => Array.isArray(list) && list.includes(userId))
    .map(([blockerId]) => blockerId);

  const incoming = state.friendRequests
    .filter((r) => r.toId === userId)
    .map((r) => {
      const fromUser = state.users.find((u) => u.id === r.fromId);
      const toUser = state.users.find((u) => u.id === r.toId);
      if (!fromUser || !toUser) return null;
      return {
        id: r.id,
        fromUser: toPublicUser(fromUser),
        toUser: toPublicUser(toUser),
        createdAt: r.createdAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  const outgoing = state.friendRequests
    .filter((r) => r.fromId === userId)
    .map((r) => {
      const fromUser = state.users.find((u) => u.id === r.fromId);
      const toUser = state.users.find((u) => u.id === r.toId);
      if (!fromUser || !toUser) return null;
      return {
        id: r.id,
        fromUser: toPublicUser(fromUser),
        toUser: toPublicUser(toUser),
        createdAt: r.createdAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  return {
    friends,
    incoming,
    outgoing,
    blocked,
    blockedByIds,
  };
}

function toPublicGroup(g: StoredGroup) {
  const members = g.memberIds
    .map((id) => state.users.find((u) => u.id === id))
    .filter((u): u is StoredUser => Boolean(u))
    .map(toPublicUser);

  const msgs = state.groupMessages
    .filter((m) => m.groupId === g.id)
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    id: g.id,
    name: g.name,
    description: g.description ?? '',
    avatarDataUrl: g.avatarDataUrl ?? null,
    bannerPreset: g.bannerPreset ?? 'monolith',
    bannerDataUrl: g.bannerDataUrl ?? null,
    accentTone: g.accentTone ?? 'platinum',
    creatorId: g.creatorId,
    members,
    keyEnvelopes: g.keyEnvelopes,
    createdAt: g.createdAt,
    lastMessage: msgs.length > 0 ? msgs[msgs.length - 1] : null,
  };
}

function sendToGroup(group: StoredGroup, payload: unknown, excludeUserId?: string) {
  for (const memberId of group.memberIds) {
    if (excludeUserId && memberId === excludeUserId) continue;
    sendToUser(memberId, payload);
  }
}

function pruneExpiredMessages(): boolean {
  const now = Date.now();
  const before = state.messages.length;
  const beforeGroup = state.groupMessages.length;
  const expired: StoredMessage[] = [];
  state.messages = state.messages.filter((m) => {
    if (m.expiresAt !== null && m.expiresAt <= now) {
      expired.push(m);
      return false;
    }
    return true;
  });
  if (expired.length > 0) {
    for (const m of expired) {
      sendToUser(m.fromId, { type: 'message:delete', messageId: m.id, conversationId: m.conversationId });
      if (m.toId !== m.fromId) {
        sendToUser(m.toId, { type: 'message:delete', messageId: m.id, conversationId: m.conversationId });
      }
    }
    schedulePersist();
  }

  const expiredGroup: StoredGroupMessage[] = [];
  state.groupMessages = state.groupMessages.filter((m) => {
    if (m.expiresAt !== null && m.expiresAt <= now) {
      expiredGroup.push(m);
      return false;
    }
    return true;
  });
  if (expiredGroup.length > 0) {
    for (const m of expiredGroup) {
      const group = state.groups.find((g) => g.id === m.groupId);
      if (group) {
        sendToGroup(group, {
          type: 'group:message:delete',
          messageId: m.id,
          groupId: m.groupId,
        });
      }
    }
    schedulePersist();
  }

  return state.messages.length !== before || state.groupMessages.length !== beforeGroup;
}

setInterval(() => {
  pruneExpiredMessages();
  const now = Date.now();
  for (const [key, ch] of challenges.entries()) {
    if (ch.expiresAt <= now) challenges.delete(key);
  }
}, 5000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  function getAuthUser(req: express.Request): StoredUser | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    const session = sessions.get(token);
    if (!session) return null;
    return state.users.find((u) => u.id === session.userId) ?? null;
  }

  function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
      return;
    }
    (req as express.Request & { currentUser: StoredUser }).currentUser = user;
    next();
  }

  // Register a new zero-email account using client-generated keys
  app.post('/api/auth/register', (req, res) => {
    const {
      lookupId,
      displayName,
      ecdhPublicJwk,
      ecdsaPublicJwk,
      fingerprint,
      encryptedVault,
      vaultSalt,
      vaultIv,
    } = req.body ?? {};

    if (
      typeof lookupId !== 'string' ||
      lookupId.length < 32 ||
      !ecdhPublicJwk ||
      !ecdsaPublicJwk ||
      typeof fingerprint !== 'string' ||
      typeof encryptedVault !== 'string' ||
      typeof vaultSalt !== 'string' ||
      typeof vaultIv !== 'string'
    ) {
      res.status(400).json({ error: 'Données cryptographiques incomplètes.' });
      return;
    }

    if (state.users.some((u) => u.lookupId === lookupId)) {
      res.status(409).json({ error: 'Cette clé existe déjà.' });
      return;
    }

    const cleanName =
      typeof displayName === 'string' && displayName.trim().length > 0
        ? displayName.trim().slice(0, 32)
        : 'Anonyme';

    const now = Date.now();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      lookupId,
      handle: generateUniqueHandle(cleanName),
      displayName: cleanName,
      ecdhPublicJwk,
      ecdsaPublicJwk,
      fingerprint,
      encryptedVault,
      vaultSalt,
      vaultIv,
      createdAt: now,
      lastSeen: now,
    };

    state.users.push(user);
    ensureContactLink(user.id, user.id);
    schedulePersist();

    const token = createPersistedSession(user.id, now);

    res.status(201).json({ token, user: toPublicUser(user) });
  });

  // Step 1 of zero-knowledge login: request challenge + encrypted private vault
  app.post('/api/auth/challenge', (req, res) => {
    const { lookupId } = req.body ?? {};
    if (typeof lookupId !== 'string' || lookupId.length < 32) {
      res.status(400).json({ error: 'Identifiant de clé invalide.' });
      return;
    }

    const user = state.users.find((u) => u.lookupId === lookupId);
    if (!user) {
      res.status(404).json({ error: 'Aucun compte associé à cette clé unique.' });
      return;
    }

    const challenge = crypto.randomBytes(32).toString('base64');
    challenges.set(challenge, {
      challenge,
      userId: user.id,
      expiresAt: Date.now() + 90_000,
    });

    res.json({
      userId: user.id,
      handle: user.handle,
      displayName: user.displayName,
      challenge,
      vaultSalt: user.vaultSalt,
      vaultIv: user.vaultIv,
      encryptedVault: user.encryptedVault,
    });
  });

  // Step 2 of zero-knowledge login: verify ECDSA signature of challenge
  app.post('/api/auth/verify', (req, res) => {
    const { userId, challenge, signature } = req.body ?? {};
    if (
      typeof userId !== 'string' ||
      typeof challenge !== 'string' ||
      typeof signature !== 'string'
    ) {
      res.status(400).json({ error: 'Requête de vérification invalide.' });
      return;
    }

    const pending = challenges.get(challenge);
    if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Défi cryptographique expiré ou invalide.' });
      return;
    }
    challenges.delete(challenge);

    const user = state.users.find((u) => u.id === userId);
    if (!user) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }

    try {
      const publicKey = crypto.createPublicKey({
        key: user.ecdsaPublicJwk as crypto.JsonWebKey,
        format: 'jwk',
      });
      const sigBuffer = Buffer.from(signature, 'base64');
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(challenge, 'utf8'),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        sigBuffer
      );

      if (!isValid) {
        res.status(401).json({ error: 'Signature cryptographique invalide.' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Échec de la vérification cryptographique.' });
      return;
    }

    user.lastSeen = Date.now();
    schedulePersist();

    const token = createPersistedSession(user.id, Date.now());

    res.json({ token, user: toPublicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      deletePersistedSession(token);
    }
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    res.json({ user: toPublicUser(me) });
  });

  app.patch('/api/me', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const {
      displayName,
      bio,
      biography,
      avatarDataUrl,
      avatarIcon,
      accentTone,
      bannerPreset,
      bannerDataUrl,
    } = req.body ?? {};

    if (typeof displayName === 'string' && displayName.trim().length > 0) {
      me.displayName = displayName.trim().slice(0, 32);
    }
    if (typeof bio === 'string') {
      me.bio = bio.trim().slice(0, 80);
    }
    if (typeof biography === 'string') {
      me.biography = biography.trim().slice(0, 400);
    }
    if (avatarDataUrl === null) {
      me.avatarDataUrl = null;
    } else if (
      typeof avatarDataUrl === 'string' &&
      avatarDataUrl.startsWith('data:image/') &&
      avatarDataUrl.length <= 120_000
    ) {
      me.avatarDataUrl = avatarDataUrl;
    }
    const allowedIcons = ['initials', 'shield', 'moon', 'compass', 'eye', 'feather', 'diamond'];
    if (typeof avatarIcon === 'string' && allowedIcons.includes(avatarIcon)) {
      me.avatarIcon = avatarIcon;
    }
    const allowedTones = ['platinum', 'emerald', 'slate', 'amber', 'crimson'];
    if (typeof accentTone === 'string' && allowedTones.includes(accentTone)) {
      me.accentTone = accentTone;
    }
    const allowedBanners = ['none', 'obsidian', 'monolith', 'eclipse', 'emerald', 'custom'];
    if (typeof bannerPreset === 'string' && allowedBanners.includes(bannerPreset)) {
      me.bannerPreset = bannerPreset;
    }
    if (bannerDataUrl === null) {
      me.bannerDataUrl = null;
    } else if (
      typeof bannerDataUrl === 'string' &&
      bannerDataUrl.startsWith('data:image/') &&
      bannerDataUrl.length <= 220_000
    ) {
      me.bannerDataUrl = bannerDataUrl;
    }

    schedulePersist();
    const updatedUser = toPublicUser(me);

    const profilePayload = JSON.stringify({
      type: 'profile:update',
      user: updatedUser,
    });
    for (const sockets of activeSockets.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(profilePayload);
        }
      }
    }

    res.json({ user: updatedUser });
  });

  // Search users by handle or display name (public key directory)
  app.get('/api/users/search', requireAuth, (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) {
      res.json({ users: [] });
      return;
    }

    const matches = state.users
      .filter(
        (u) =>
          u.handle.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          u.fingerprint.toLowerCase().replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))
      )
      .slice(0, 12)
      .map(toPublicUser);

    res.json({ users: matches });
  });

  app.get('/api/users/:id', requireAuth, (req, res) => {
    const user = state.users.find((u) => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  app.post('/api/conversations/open', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { peerId, handle } = req.body ?? {};
    let peer: StoredUser | undefined;
    if (typeof peerId === 'string') {
      peer = state.users.find((u) => u.id === peerId);
    } else if (typeof handle === 'string') {
      const normalized = handle.trim().toLowerCase();
      peer = state.users.find((u) => u.handle.toLowerCase() === normalized);
    }
    if (!peer) {
      res.status(404).json({ error: 'Destinataire introuvable.' });
      return;
    }

    ensureContactLink(me.id, peer.id);
    schedulePersist();
    res.json({ peer: toPublicUser(peer) });
  });

  app.get('/api/conversations', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    pruneExpiredMessages();

    const contactIds = new Set<string>(state.contacts[me.id] ?? []);
    contactIds.add(me.id); // Always include self-vault

    for (const msg of state.messages) {
      if (msg.fromId === me.id) contactIds.add(msg.toId);
      if (msg.toId === me.id) contactIds.add(msg.fromId);
    }

    const summaries = Array.from(contactIds)
      .map((peerId) => {
        const peer = state.users.find((u) => u.id === peerId);
        if (!peer) return null;

        const convId = [me.id, peerId].sort().join('__');
        const convMsgs = state.messages.filter((m) => m.conversationId === convId);
        const lastMessage = convMsgs.length > 0 ? convMsgs[convMsgs.length - 1] : null;
        const unreadCount = convMsgs.filter(
          (m) => m.toId === me.id && m.fromId !== me.id && m.readAt === null
        ).length;

        return {
          peer: toPublicUser(peer),
          lastMessage,
          unreadCount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        const tsA = a.lastMessage?.timestamp ?? (a.peer.id === me.id ? 1 : 0);
        const tsB = b.lastMessage?.timestamp ?? (b.peer.id === me.id ? 1 : 0);
        return tsB - tsA;
      });

    res.json({ conversations: summaries });
  });

  app.get('/api/messages/:peerId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const peerId = req.params.peerId;
    pruneExpiredMessages();

    const convId = [me.id, peerId].sort().join('__');
    const messages = state.messages
      .filter((m) => m.conversationId === convId)
      .sort((a, b) => a.timestamp - b.timestamp);

    res.json({ messages });
  });

  app.post('/api/messages', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const {
      id,
      toId,
      ciphertext,
      iv,
      signature,
      timestamp,
      ttlSeconds,
    } = req.body ?? {};

    if (
      typeof id !== 'string' ||
      typeof toId !== 'string' ||
      typeof ciphertext !== 'string' ||
      typeof iv !== 'string' ||
      typeof signature !== 'string' ||
      typeof timestamp !== 'number'
    ) {
      res.status(400).json({ error: 'Enveloppe chiffrée invalide.' });
      return;
    }

    const recipient = state.users.find((u) => u.id === toId);
    if (!recipient) {
      res.status(404).json({ error: 'Destinataire introuvable.' });
      return;
    }

    if (toId !== me.id && isBlockedBetween(me.id, toId)) {
      res.status(403).json({
        error: 'Action impossible : un blocage est actif entre vous et cet utilisateur.',
      });
      return;
    }

    // Idempotency guard
    const existing = state.messages.find((m) => m.id === id);
    if (existing) {
      res.status(200).json({ message: existing });
      return;
    }

    const convId = [me.id, toId].sort().join('__');
    const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : 0;
    const envelope: StoredMessage = {
      id,
      conversationId: convId,
      fromId: me.id,
      toId,
      ciphertext,
      iv,
      signature,
      timestamp,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
      readAt: toId === me.id ? Date.now() : null,
    };

    state.messages.push(envelope);
    ensureContactLink(me.id, toId);
    ensureContactLink(toId, me.id);
    schedulePersist();

    sendToUser(toId, { type: 'message:new', message: envelope, sender: toPublicUser(me) });
    if (toId !== me.id) {
      sendToUser(me.id, { type: 'message:new', message: envelope, sender: toPublicUser(me) });
      void sendPushToUser(toId, {
        title: `Nouveau message de ${me.displayName}`,
        body: 'Message chiffré reçu • Appuyez pour déchiffrer',
        discreetTitle: 'DISCRET',
        discreetBody: 'Nouveau message chiffré reçu',
        tag: `dm-msg-${envelope.id}`,
        data: {
          url: `/?open=dm&peerId=${encodeURIComponent(me.id)}`,
          type: 'dm',
          peerId: me.id,
          messageId: envelope.id,
        },
      });
    }

    res.status(201).json({ message: envelope });
  });

  app.post('/api/messages/read', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { peerId } = req.body ?? {};
    if (typeof peerId !== 'string') {
      res.status(400).json({ error: 'peerId manquant.' });
      return;
    }

    const now = Date.now();
    const updatedIds: string[] = [];
    for (const msg of state.messages) {
      if (msg.fromId === peerId && msg.toId === me.id && msg.readAt === null) {
        msg.readAt = now;
        updatedIds.push(msg.id);
      }
    }

    if (updatedIds.length > 0) {
      schedulePersist();
      sendToUser(peerId, {
        type: 'message:read',
        readerId: me.id,
        messageIds: updatedIds,
        readAt: now,
      });
    }

    res.json({ updatedIds });
  });

  app.delete('/api/messages/:messageId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const msgIdx = state.messages.findIndex((m) => m.id === req.params.messageId);
    if (msgIdx === -1) {
      res.status(404).json({ error: 'Message introuvable.' });
      return;
    }

    const msg = state.messages[msgIdx];
    if (msg.fromId !== me.id && msg.toId !== me.id) {
      res.status(403).json({ error: 'Accès refusé.' });
      return;
    }

    state.messages.splice(msgIdx, 1);
    schedulePersist();

    sendToUser(msg.fromId, {
      type: 'message:delete',
      messageId: msg.id,
      conversationId: msg.conversationId,
    });
    if (msg.toId !== msg.fromId) {
      sendToUser(msg.toId, {
        type: 'message:delete',
        messageId: msg.id,
        conversationId: msg.conversationId,
      });
    }

    res.json({ ok: true });
  });

  // ============================================================================
  // E2EE Groups API
  // ============================================================================

  app.get('/api/groups', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    pruneExpiredMessages();

    const groups = state.groups
      .filter((g) => g.memberIds.includes(me.id))
      .map(toPublicGroup)
      .sort((a, b) => {
        const tsA = a.lastMessage?.timestamp ?? a.createdAt;
        const tsB = b.lastMessage?.timestamp ?? b.createdAt;
        return tsB - tsA;
      });

    res.json({ groups });
  });

  app.post('/api/groups', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const {
      name,
      description,
      avatarDataUrl,
      bannerPreset,
      bannerDataUrl,
      accentTone,
      memberIds,
      keyEnvelopes,
    } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Le nom du groupe est requis.' });
      return;
    }

    const uniqueMemberIds = Array.from(
      new Set<string>([
        me.id,
        ...(Array.isArray(memberIds)
          ? memberIds.filter((id): id is string => typeof id === 'string')
          : []),
      ])
    ).filter((id) => state.users.some((u) => u.id === id));

    if (!keyEnvelopes || typeof keyEnvelopes !== 'object') {
      res.status(400).json({ error: 'Enveloppes de clé de groupe manquantes.' });
      return;
    }

    for (const mId of uniqueMemberIds) {
      const env = (keyEnvelopes as Record<string, StoredGroupKeyEnvelope>)[mId];
      if (!env || typeof env.iv !== 'string' || typeof env.wrappedKey !== 'string') {
        res.status(400).json({ error: 'Clé de groupe manquante pour un membre.' });
        return;
      }
    }

    const allowedBanners = ['none', 'obsidian', 'monolith', 'eclipse', 'emerald', 'custom'];
    const allowedTones = ['platinum', 'emerald', 'slate', 'amber', 'crimson'];

    const safeAvatar =
      typeof avatarDataUrl === 'string' &&
      avatarDataUrl.startsWith('data:image/') &&
      avatarDataUrl.length <= 120_000
        ? avatarDataUrl
        : null;

    const safeBanner =
      typeof bannerDataUrl === 'string' &&
      bannerDataUrl.startsWith('data:image/') &&
      bannerDataUrl.length <= 220_000
        ? bannerDataUrl
        : null;

    const group: StoredGroup = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 40),
      description: typeof description === 'string' ? description.trim().slice(0, 100) : '',
      avatarDataUrl: safeAvatar,
      bannerPreset:
        typeof bannerPreset === 'string' && allowedBanners.includes(bannerPreset)
          ? bannerPreset
          : 'monolith',
      bannerDataUrl: safeBanner,
      accentTone:
        typeof accentTone === 'string' && allowedTones.includes(accentTone)
          ? accentTone
          : 'platinum',
      creatorId: me.id,
      memberIds: uniqueMemberIds,
      keyEnvelopes: keyEnvelopes as Record<string, StoredGroupKeyEnvelope>,
      createdAt: Date.now(),
    };

    state.groups.push(group);
    schedulePersist();

    const publicGroup = toPublicGroup(group);
    sendToGroup(group, { type: 'group:new', group: publicGroup });

    res.status(201).json({ group: publicGroup });
  });

  app.patch('/api/groups/:groupId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const group = state.groups.find((g) => g.id === req.params.groupId);
    if (!group || !group.memberIds.includes(me.id)) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }

    const {
      name,
      description,
      avatarDataUrl,
      bannerPreset,
      bannerDataUrl,
      accentTone,
    } = req.body ?? {};
    if (typeof name === 'string' && name.trim().length > 0) {
      group.name = name.trim().slice(0, 40);
    }
    if (typeof description === 'string') {
      group.description = description.trim().slice(0, 100);
    }
    if (avatarDataUrl === null) {
      group.avatarDataUrl = null;
    } else if (
      typeof avatarDataUrl === 'string' &&
      avatarDataUrl.startsWith('data:image/') &&
      avatarDataUrl.length <= 120_000
    ) {
      group.avatarDataUrl = avatarDataUrl;
    }
    const allowedBanners = ['none', 'obsidian', 'monolith', 'eclipse', 'emerald', 'custom'];
    if (typeof bannerPreset === 'string' && allowedBanners.includes(bannerPreset)) {
      group.bannerPreset = bannerPreset;
    }
    if (bannerDataUrl === null) {
      group.bannerDataUrl = null;
    } else if (
      typeof bannerDataUrl === 'string' &&
      bannerDataUrl.startsWith('data:image/') &&
      bannerDataUrl.length <= 220_000
    ) {
      group.bannerDataUrl = bannerDataUrl;
    }
    const allowedTones = ['platinum', 'emerald', 'slate', 'amber', 'crimson'];
    if (typeof accentTone === 'string' && allowedTones.includes(accentTone)) {
      group.accentTone = accentTone;
    }

    schedulePersist();
    const publicGroup = toPublicGroup(group);
    sendToGroup(group, { type: 'group:update', group: publicGroup });
    res.json({ group: publicGroup });
  });

  app.post('/api/groups/:groupId/members', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const group = state.groups.find((g) => g.id === req.params.groupId);
    if (!group || !group.memberIds.includes(me.id)) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }

    const { userId, keyEnvelope } = req.body ?? {};
    if (
      typeof userId !== 'string' ||
      !state.users.some((u) => u.id === userId) ||
      !keyEnvelope ||
      typeof keyEnvelope.iv !== 'string' ||
      typeof keyEnvelope.wrappedKey !== 'string' ||
      typeof keyEnvelope.wrappedByUserId !== 'string'
    ) {
      res.status(400).json({ error: 'Données de membre invalides.' });
      return;
    }

    if (isBlockedBetween(me.id, userId)) {
      res.status(403).json({
        error: 'Impossible d’inviter un utilisateur bloqué.',
      });
      return;
    }

    if (!group.memberIds.includes(userId)) {
      group.memberIds.push(userId);
    }
    group.keyEnvelopes[userId] = keyEnvelope as StoredGroupKeyEnvelope;
    schedulePersist();

    const publicGroup = toPublicGroup(group);
    sendToUser(userId, { type: 'group:new', group: publicGroup });
    sendToGroup(group, { type: 'group:update', group: publicGroup }, userId);
    res.json({ group: publicGroup });
  });

  app.post('/api/groups/:groupId/leave', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const groupIdx = state.groups.findIndex((g) => g.id === req.params.groupId);
    if (groupIdx === -1) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }
    const group = state.groups[groupIdx];
    if (!group.memberIds.includes(me.id)) {
      res.status(403).json({ error: 'Non membre.' });
      return;
    }

    group.memberIds = group.memberIds.filter((id) => id !== me.id);
    delete group.keyEnvelopes[me.id];

    if (group.memberIds.length === 0) {
      state.groups.splice(groupIdx, 1);
      state.groupMessages = state.groupMessages.filter((m) => m.groupId !== group.id);
    } else {
      const publicGroup = toPublicGroup(group);
      sendToGroup(group, { type: 'group:update', group: publicGroup });
    }

    schedulePersist();
    res.json({ ok: true });
  });

  app.delete('/api/groups/:groupId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const groupIdx = state.groups.findIndex((g) => g.id === req.params.groupId);
    if (groupIdx === -1) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }
    const group = state.groups[groupIdx];
    if (!group.memberIds.includes(me.id)) {
      res.status(403).json({ error: 'Accès refusé.' });
      return;
    }
    if (group.creatorId !== me.id) {
      res.status(403).json({
        error: 'Seul le fondateur peut supprimer définitivement ce groupe.',
      });
      return;
    }

    const memberIds = [...group.memberIds];
    state.groups.splice(groupIdx, 1);
    state.groupMessages = state.groupMessages.filter((m) => m.groupId !== group.id);
    schedulePersist();

    for (const memberId of memberIds) {
      sendToUser(memberId, { type: 'group:delete', groupId: group.id });
    }

    res.json({ ok: true, groupId: group.id });
  });

  app.get('/api/groups/:groupId/messages', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const group = state.groups.find((g) => g.id === req.params.groupId);
    if (!group || !group.memberIds.includes(me.id)) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }

    pruneExpiredMessages();
    const messages = state.groupMessages
      .filter((m) => m.groupId === group.id)
      .sort((a, b) => a.timestamp - b.timestamp);

    res.json({ messages });
  });

  app.post('/api/groups/:groupId/messages', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const group = state.groups.find((g) => g.id === req.params.groupId);
    if (!group || !group.memberIds.includes(me.id)) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }

    const { id, ciphertext, iv, signature, timestamp, ttlSeconds } = req.body ?? {};
    if (
      typeof id !== 'string' ||
      typeof ciphertext !== 'string' ||
      typeof iv !== 'string' ||
      typeof signature !== 'string' ||
      typeof timestamp !== 'number'
    ) {
      res.status(400).json({ error: 'Enveloppe chiffrée de groupe invalide.' });
      return;
    }

    const existing = state.groupMessages.find((m) => m.id === id);
    if (existing) {
      res.status(200).json({ message: existing });
      return;
    }

    const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : 0;
    const envelope: StoredGroupMessage = {
      id,
      groupId: group.id,
      fromId: me.id,
      ciphertext,
      iv,
      signature,
      timestamp,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    };

    state.groupMessages.push(envelope);
    schedulePersist();

    sendToGroup(group, {
      type: 'group:message:new',
      message: envelope,
      sender: toPublicUser(me),
    });

    for (const memberId of group.memberIds) {
      if (memberId === me.id) continue;
      void sendPushToUser(memberId, {
        title: `${group.name} • ${me.displayName}`,
        body: 'Nouveau message de groupe chiffré',
        discreetTitle: 'DISCRET',
        discreetBody: 'Nouvelle activité de groupe chiffrée',
        tag: `group-msg-${envelope.id}`,
        data: {
          url: `/?open=group&groupId=${encodeURIComponent(group.id)}`,
          type: 'group',
          groupId: group.id,
          messageId: envelope.id,
        },
      });
    }

    res.status(201).json({ message: envelope });
  });

  app.delete('/api/groups/:groupId/messages/:messageId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const group = state.groups.find((g) => g.id === req.params.groupId);
    if (!group || !group.memberIds.includes(me.id)) {
      res.status(404).json({ error: 'Groupe introuvable.' });
      return;
    }

    const idx = state.groupMessages.findIndex(
      (m) => m.id === req.params.messageId && m.groupId === group.id
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Message introuvable.' });
      return;
    }

    const msg = state.groupMessages[idx];
    if (msg.fromId !== me.id && group.creatorId !== me.id) {
      res.status(403).json({ error: 'Accès refusé.' });
      return;
    }

    state.groupMessages.splice(idx, 1);
    schedulePersist();

    sendToGroup(group, {
      type: 'group:message:delete',
      messageId: msg.id,
      groupId: group.id,
    });

    res.json({ ok: true });
  });

  // ============================================================================
  // Friends, Requests & Blocks API
  // ============================================================================

  app.get('/api/friends', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    res.json(buildFriendsSnapshot(me.id));
  });

  app.post('/api/friends/request', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { targetUserId } = req.body ?? {};
    if (typeof targetUserId !== 'string') {
      res.status(400).json({ error: 'Identifiant utilisateur manquant.' });
      return;
    }
    if (targetUserId === me.id) {
      res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même.' });
      return;
    }
    const target = state.users.find((u) => u.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    if (isBlockedBetween(me.id, target.id)) {
      res.status(403).json({ error: 'Impossible : un blocage est actif avec cet utilisateur.' });
      return;
    }
    if (areFriends(me.id, target.id)) {
      res.json({ status: 'already_friends', ...buildFriendsSnapshot(me.id) });
      return;
    }

    // If the target already sent us a request, automatically accept it!
    const reverseReq = state.friendRequests.find(
      (r) => r.fromId === target.id && r.toId === me.id
    );
    if (reverseReq) {
      addFriendship(me.id, target.id);
      removeRequestsBetween(me.id, target.id);
      schedulePersist();

      sendToUser(target.id, { type: 'friend:accepted', byUser: toPublicUser(me) });
      sendToUser(me.id, { type: 'friend:sync' });
      sendToUser(target.id, { type: 'friend:sync' });

      res.json({ status: 'accepted', ...buildFriendsSnapshot(me.id) });
      return;
    }

    const existingReq = state.friendRequests.find(
      (r) => r.fromId === me.id && r.toId === target.id
    );
    if (!existingReq) {
      const request: StoredFriendRequest = {
        id: crypto.randomUUID(),
        fromId: me.id,
        toId: target.id,
        createdAt: Date.now(),
      };
      state.friendRequests.push(request);
      schedulePersist();

      sendToUser(target.id, {
        type: 'friend:request',
        fromUser: toPublicUser(me),
        requestId: request.id,
      });
      sendToUser(me.id, { type: 'friend:sync' });
      sendToUser(target.id, { type: 'friend:sync' });

      void sendPushToUser(target.id, {
        title: `Demande d'ami • ${me.displayName}`,
        body: `${me.handle} souhaite rejoindre vos contacts DISCRET.`,
        discreetTitle: 'DISCRET',
        discreetBody: 'Nouvelle demande de contact reçue',
        tag: `friend-req-${request.id}`,
        data: {
          url: '/?open=friends',
          type: 'friend_request',
          fromUserId: me.id,
        },
      });
    }

    res.status(201).json({ status: 'requested', ...buildFriendsSnapshot(me.id) });
  });

  app.post('/api/friends/accept', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { requestId, fromUserId } = req.body ?? {};

    const pending = state.friendRequests.find(
      (r) =>
        r.toId === me.id &&
        ((typeof requestId === 'string' && r.id === requestId) ||
          (typeof fromUserId === 'string' && r.fromId === fromUserId))
    );

    if (!pending) {
      res.status(404).json({ error: 'Demande d’ami introuvable.' });
      return;
    }

    if (isBlockedBetween(me.id, pending.fromId)) {
      removeRequestsBetween(me.id, pending.fromId);
      schedulePersist();
      res.status(403).json({ error: 'Impossible : un blocage est actif.' });
      return;
    }

    addFriendship(me.id, pending.fromId);
    removeRequestsBetween(me.id, pending.fromId);
    schedulePersist();

    sendToUser(pending.fromId, { type: 'friend:accepted', byUser: toPublicUser(me) });
    sendToUser(me.id, { type: 'friend:sync' });
    sendToUser(pending.fromId, { type: 'friend:sync' });

    void sendPushToUser(pending.fromId, {
      title: `Demande acceptée • ${me.displayName}`,
      body: `${me.displayName} fait maintenant partie de votre liste d'amis.`,
      discreetTitle: 'DISCRET',
      discreetBody: 'Une demande de contact a été acceptée',
      tag: `friend-acc-${me.id}`,
      data: {
        url: `/?open=dm&peerId=${encodeURIComponent(me.id)}`,
        type: 'friend_accepted',
        peerId: me.id,
      },
    });

    res.json({ ok: true, ...buildFriendsSnapshot(me.id) });
  });

  app.post('/api/friends/decline', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { requestId, userId } = req.body ?? {};

    const targetReq = state.friendRequests.find(
      (r) =>
        (r.toId === me.id || r.fromId === me.id) &&
        ((typeof requestId === 'string' && r.id === requestId) ||
          (typeof userId === 'string' &&
            ((r.fromId === me.id && r.toId === userId) ||
              (r.toId === me.id && r.fromId === userId))))
    );

    if (!targetReq) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }

    const otherId = targetReq.fromId === me.id ? targetReq.toId : targetReq.fromId;
    state.friendRequests = state.friendRequests.filter((r) => r.id !== targetReq.id);
    schedulePersist();

    sendToUser(me.id, { type: 'friend:sync' });
    sendToUser(otherId, { type: 'friend:sync' });

    res.json({ ok: true, ...buildFriendsSnapshot(me.id) });
  });

  app.delete('/api/friends/:userId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const otherId = req.params.userId;
    removeFriendship(me.id, otherId);
    removeRequestsBetween(me.id, otherId);
    schedulePersist();

    sendToUser(me.id, { type: 'friend:sync' });
    sendToUser(otherId, { type: 'friend:sync' });

    res.json({ ok: true, ...buildFriendsSnapshot(me.id) });
  });

  app.post('/api/blocks', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { targetUserId } = req.body ?? {};
    if (typeof targetUserId !== 'string' || targetUserId === me.id) {
      res.status(400).json({ error: 'Utilisateur cible invalide.' });
      return;
    }
    const target = state.users.find((u) => u.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    if (!state.blocks[me.id]) state.blocks[me.id] = [];
    if (!state.blocks[me.id].includes(targetUserId)) {
      state.blocks[me.id].push(targetUserId);
    }

    removeFriendship(me.id, targetUserId);
    removeRequestsBetween(me.id, targetUserId);
    schedulePersist();

    sendToUser(me.id, { type: 'block:update' });
    sendToUser(targetUserId, { type: 'block:update' });
    sendToUser(me.id, { type: 'friend:sync' });
    sendToUser(targetUserId, { type: 'friend:sync' });

    res.json({ ok: true, ...buildFriendsSnapshot(me.id) });
  });

  app.delete('/api/blocks/:targetUserId', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const targetUserId = req.params.targetUserId;
    if (state.blocks[me.id]) {
      state.blocks[me.id] = state.blocks[me.id].filter((id) => id !== targetUserId);
    }
    schedulePersist();

    sendToUser(me.id, { type: 'block:update' });
    sendToUser(targetUserId, { type: 'block:update' });
    sendToUser(me.id, { type: 'friend:sync' });
    sendToUser(targetUserId, { type: 'friend:sync' });

    res.json({ ok: true, ...buildFriendsSnapshot(me.id) });
  });

  // ============================================================================
  // Web Push Notifications API (VAPID)
  // ============================================================================

  app.get('/api/push/vapid-public-key', requireAuth, (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.get('/api/push/status', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const subs = state.pushSubscriptions[me.id] ?? [];
    res.json({
      count: subs.length,
      subscriptions: subs.map((s) => ({
        endpoint: s.endpoint,
        discreetMode: Boolean(s.discreetMode),
        updatedAt: s.updatedAt,
      })),
    });
  });

  app.post('/api/push/subscribe', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { subscription, discreetMode } = req.body ?? {};
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;

    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      typeof p256dh !== 'string' ||
      typeof auth !== 'string'
    ) {
      res.status(400).json({ error: 'Abonnement Web Push invalide.' });
      return;
    }

    if (!state.pushSubscriptions[me.id]) {
      state.pushSubscriptions[me.id] = [];
    }

    const now = Date.now();
    const existingIdx = state.pushSubscriptions[me.id].findIndex(
      (s) => s.endpoint === endpoint
    );

    const record: StoredPushSubscription = {
      endpoint,
      expirationTime:
        typeof subscription.expirationTime === 'number'
          ? subscription.expirationTime
          : null,
      keys: { p256dh, auth },
      discreetMode:
        typeof discreetMode === 'boolean'
          ? discreetMode
          : existingIdx >= 0
            ? Boolean(state.pushSubscriptions[me.id][existingIdx].discreetMode)
            : false,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 180)
          : undefined,
      createdAt:
        existingIdx >= 0 ? state.pushSubscriptions[me.id][existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      state.pushSubscriptions[me.id][existingIdx] = record;
    } else {
      state.pushSubscriptions[me.id].push(record);
    }

    schedulePersist();
    res.json({
      ok: true,
      count: state.pushSubscriptions[me.id].length,
      discreetMode: Boolean(record.discreetMode),
    });
  });

  app.patch('/api/push/preferences', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { endpoint, discreetMode } = req.body ?? {};
    if (typeof discreetMode !== 'boolean') {
      res.status(400).json({ error: 'Préférence invalide.' });
      return;
    }

    const subs = state.pushSubscriptions[me.id] ?? [];
    for (const sub of subs) {
      if (!endpoint || sub.endpoint === endpoint) {
        sub.discreetMode = discreetMode;
        sub.updatedAt = Date.now();
      }
    }
    schedulePersist();
    res.json({ ok: true, discreetMode });
  });

  app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const { endpoint } = req.body ?? {};
    const subs = state.pushSubscriptions[me.id] ?? [];
    if (typeof endpoint === 'string' && endpoint.length > 0) {
      state.pushSubscriptions[me.id] = subs.filter((s) => s.endpoint !== endpoint);
    } else {
      state.pushSubscriptions[me.id] = [];
    }
    schedulePersist();
    res.json({ ok: true, count: state.pushSubscriptions[me.id].length });
  });

  app.post('/api/push/test', requireAuth, async (req, res) => {
    const me = (req as express.Request & { currentUser: StoredUser }).currentUser;
    const result = await sendPushToUser(me.id, {
      title: 'DISCRET • Test Push Service Worker',
      body: 'Les notifications push en arrière-plan sont actives sur cet appareil.',
      discreetTitle: 'DISCRET',
      discreetBody: 'Test de notification discrète réussi',
      tag: `discret-test-${Date.now()}`,
      forceShow: true,
      data: {
        url: '/',
        type: 'test',
      },
    });
    res.json(result);
  });

  const server = http.createServer(app);

  // Real-time WebSocket Server attached to the HTTP server on port 3000
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      return;
    }

    const token = url.searchParams.get('token');
    const session = token ? sessions.get(token) : undefined;
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, session.userId);
    });
  });

  wss.on('connection', (ws: WebSocket, userId: string) => {
    let userSockets = activeSockets.get(userId);
    if (!userSockets) {
      userSockets = new Set();
      activeSockets.set(userId, userSockets);
    }
    userSockets.add(ws);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(String(raw)) as {
          type?: string;
          toId?: string;
          groupId?: string;
          isTyping?: boolean;
          callId?: string;
          callType?: 'audio' | 'video';
          sdp?: unknown;
          candidate?: unknown;
          reason?: string;
          audioMuted?: boolean;
          videoEnabled?: boolean;
        };
        if (data.type === 'typing:state') {
          if (typeof data.groupId === 'string') {
            const group = state.groups.find((g) => g.id === data.groupId);
            if (group && group.memberIds.includes(userId)) {
              sendToGroup(
                group,
                {
                  type: 'typing:state',
                  fromId: userId,
                  groupId: group.id,
                  isTyping: Boolean(data.isTyping),
                },
                userId
              );
            }
          } else if (typeof data.toId === 'string') {
            sendToUser(data.toId, {
              type: 'typing:state',
              fromId: userId,
              isTyping: Boolean(data.isTyping),
            });
          }
        } else if (
          data.type === 'call:invite' &&
          typeof data.toId === 'string' &&
          typeof data.callId === 'string' &&
          data.sdp
        ) {
          if (data.toId === userId) return;
          if (isBlockedBetween(userId, data.toId)) {
            sendToUser(userId, {
              type: 'call:decline',
              callId: data.callId,
              fromId: data.toId,
              reason: 'blocked',
            });
            return;
          }
          const target = state.users.find((u) => u.id === data.toId);
          const caller = state.users.find((u) => u.id === userId);
          if (!target || !caller) {
            sendToUser(userId, {
              type: 'call:hangup',
              callId: data.callId,
              fromId: data.toId,
              reason: 'unavailable',
            });
            return;
          }

          const callType = data.callType === 'video' ? 'video' : 'audio';
          sendToUser(data.toId, {
            type: 'call:invite',
            callId: data.callId,
            fromId: userId,
            caller: toPublicUser(caller),
            callType,
            sdp: data.sdp,
          });

          void sendPushToUser(data.toId, {
            title:
              callType === 'video'
                ? `Appel vidéo entrant • ${caller.displayName}`
                : `Appel audio entrant • ${caller.displayName}`,
            body: 'Ouvrez DISCRET pour répondre en temps réel.',
            discreetTitle: 'DISCRET',
            discreetBody: 'Appel chiffré entrant',
            tag: `call-${data.callId}`,
            data: {
              url: `/?open=dm&peerId=${encodeURIComponent(caller.id)}`,
              type: 'dm',
              peerId: caller.id,
            },
          });
        } else if (
          (data.type === 'call:ringing' ||
            data.type === 'call:accept' ||
            data.type === 'call:decline' ||
            data.type === 'call:hangup' ||
            data.type === 'call:ice' ||
            data.type === 'call:renegotiate' ||
            data.type === 'call:media-state') &&
          typeof data.toId === 'string' &&
          typeof data.callId === 'string'
        ) {
          if (isBlockedBetween(userId, data.toId)) return;
          sendToUser(data.toId, {
            type: data.type,
            callId: data.callId,
            fromId: userId,
            callType: data.callType,
            sdp: data.sdp,
            candidate: data.candidate,
            reason: data.reason,
            audioMuted: data.audioMuted,
            videoEnabled: data.videoEnabled,
          });
        }
      } catch {
        // Ignore malformed WS payloads
      }
    });

    ws.on('close', () => {
      const set = activeSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          activeSockets.delete(userId);
        }
      }
    });
  });

  // Mount Vite in dev or serve built assets in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: hmrDisabled ? false : { server },
      },
      plugins: hmrDisabled
        ? [
            {
              name: 'disable-hmr-client-ws',
              transform(code, id) {
                if (id.endsWith('/vite/dist/client/client.mjs')) {
                  return code.replace(
                    /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                    'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });'
                  );
                }
              },
            },
          ]
        : [],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`DISCRET encrypted relay running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
