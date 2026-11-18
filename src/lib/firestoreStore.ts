import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, getFreshFirebaseIdToken, handleFirestoreError, OperationType } from './firebase';
import type {
  AccentToneKey,
  BannerPresetKey,
  AvatarIconKey,
  ConversationSummary,
  EncryptedMessageEnvelope,
  FriendRequestRecord,
  FriendsSnapshot,
  GroupInfo,
  GroupKeyEnvelope,
  GroupMessageEnvelope,
  PublicUser,
} from '../types';
import type { GeneratedIdentityPayload } from './crypto';

export interface PrivateUserDoc {
  ownerUid: string;
  handle: string;
  displayName: string;
  lookupId: string;
  encryptedVault: string;
  vaultSalt: string;
  vaultIv: string;
  fingerprint: string;
  ecdhPublicJwk: JsonWebKey;
  ecdsaPublicJwk: JsonWebKey;
  lastSeen: number;
}

const ALLOWED_ICONS: AvatarIconKey[] = [
  'initials',
  'shield',
  'moon',
  'compass',
  'eye',
  'feather',
  'diamond',
];
const ALLOWED_TONES: AccentToneKey[] = [
  'platinum',
  'emerald',
  'slate',
  'amber',
  'crimson',
];
const ALLOWED_BANNERS: BannerPresetKey[] = [
  'none',
  'obsidian',
  'monolith',
  'eclipse',
  'emerald',
  'custom',
];

const profileCache = new Map<string, PublicUser>();

function sanitizeJwk(jwk: JsonWebKey): JsonWebKey {
  return {
    kty: String(jwk.kty || 'EC'),
    crv: String(jwk.crv || 'P-256'),
    x: String(jwk.x || ''),
    y: String(jwk.y || ''),
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

export class PseudonymError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PseudonymError';
  }
}

export function getContactDisplayName(
  user: { id: string; displayName: string },
  friendAliases?: Record<string, string>
): string {
  const custom = friendAliases?.[user.id]?.trim();
  return custom || user.displayName;
}

export function normalizePseudoKey(displayName: string): string {
  return displayName
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export async function isPseudonymAvailable(
  displayName: string,
  excludeUid?: string
): Promise<{ available: boolean; pseudoKey: string; reason?: string }> {
  const cleanName = displayName.trim();
  if (cleanName.length < 2) {
    return {
      available: false,
      pseudoKey: '',
      reason: 'Le pseudonyme doit contenir au moins 2 caractères.',
    };
  }
  if (cleanName.length > 32) {
    return {
      available: false,
      pseudoKey: '',
      reason: 'Le pseudonyme ne doit pas dépasser 32 caractères.',
    };
  }
  const pseudoKey = normalizePseudoKey(cleanName);
  if (pseudoKey.length < 2 || !/^[a-z0-9_]{2,32}$/.test(pseudoKey)) {
    return {
      available: false,
      pseudoKey,
      reason: 'Utilisez au moins 2 lettres ou chiffres.',
    };
  }

  try {
    const snap = await getDoc(doc(db, 'pseudonyms', pseudoKey));
    if (!snap.exists()) {
      return { available: true, pseudoKey };
    }
    if (excludeUid && snap.data().userId === excludeUid) {
      return { available: true, pseudoKey };
    }
    return {
      available: false,
      pseudoKey,
      reason: 'Ce pseudonyme est déjà utilisé par une autre personne.',
    };
  } catch {
    return {
      available: true,
      pseudoKey,
    };
  }
}

export function normalizeHandleKey(handle: string): string {
  return handle
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32);
}

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function generateUniqueHandle(displayName: string): Promise<string> {
  const base = sanitizeHandlePrefix(displayName);
  for (let i = 0; i < 6; i++) {
    const suffix = randomHex(2);
    const candidate = `@${base}#${suffix}`;
    const key = normalizeHandleKey(candidate);
    try {
      const snap = await getDoc(doc(db, 'handleIndex', key));
      if (!snap.exists()) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return `@${base}#${randomHex(3)}`;
}

function buildSearchPrefixes(displayName: string, handle: string): string[] {
  const prefixes = new Set<string>();
  const cleanName = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');

  for (let len = 2; len <= Math.min(cleanName.length, 6); len++) {
    prefixes.add(cleanName.slice(0, len));
  }

  const handleWithoutAt = handle.replace(/^@/, '').toLowerCase();
  const [namePart, tagPart] = handleWithoutAt.split('#');
  if (namePart) {
    for (let len = 2; len <= Math.min(namePart.length, 6); len++) {
      prefixes.add(namePart.slice(0, len));
    }
  }
  if (tagPart && tagPart.length >= 2) {
    prefixes.add(tagPart.replace(/[^a-z0-9_]/g, '').slice(0, 8));
  }

  return Array.from(prefixes).filter((p) => /^[a-z0-9_]{2,24}$/.test(p)).slice(0, 6);
}

async function syncUserSearchBuckets(
  uid: string,
  displayName: string,
  handle: string
): Promise<void> {
  const prefixes = buildSearchPrefixes(displayName, handle);
  await Promise.all(
    prefixes.map(async (prefix) => {
      const ref = doc(db, 'searchBuckets', prefix);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            prefix,
            userIds: [uid],
            updatedAt: serverTimestamp(),
          });
        } else {
          const existing = Array.isArray(snap.data().userIds)
            ? (snap.data().userIds as string[])
            : [];
          if (!existing.includes(uid) && existing.length < 12) {
            await updateDoc(ref, {
              userIds: [...existing, uid],
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch {
        // Non-critical bucket contention ignored; handleIndex remains authoritative
      }
    })
  );
}

function docToPublicUser(id: string, data: Record<string, unknown>): PublicUser {
  const icon = ALLOWED_ICONS.includes(data.avatarIcon as AvatarIconKey)
    ? (data.avatarIcon as AvatarIconKey)
    : 'initials';
  const tone = ALLOWED_TONES.includes(data.accentTone as AccentToneKey)
    ? (data.accentTone as AccentToneKey)
    : 'platinum';
  const banner = ALLOWED_BANNERS.includes(data.bannerPreset as BannerPresetKey)
    ? (data.bannerPreset as BannerPresetKey)
    : 'obsidian';

  const user: PublicUser = {
    id,
    handle: String(data.handle || '@anonyme#0000'),
    displayName: String(data.displayName || 'Anonyme'),
    bio: typeof data.bio === 'string' ? data.bio : '',
    biography: typeof data.biography === 'string' ? data.biography : '',
    avatarDataUrl: typeof data.avatarDataUrl === 'string' ? data.avatarDataUrl : null,
    avatarIcon: icon,
    accentTone: tone,
    bannerPreset: banner,
    bannerDataUrl: typeof data.bannerDataUrl === 'string' ? data.bannerDataUrl : null,
    ecdhPublicJwk: (data.ecdhPublicJwk as JsonWebKey) ?? {},
    ecdsaPublicJwk: (data.ecdsaPublicJwk as JsonWebKey) ?? {},
    fingerprint: String(data.fingerprint || ''),
    createdAt: typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now(),
  };
  profileCache.set(id, user);
  return user;
}

export async function getPrivateUserDoc(uid: string): Promise<PrivateUserDoc | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data() as PrivateUserDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchPublicProfile(uid: string): Promise<PublicUser | null> {
  const cached = profileCache.get(uid);
  if (cached) return cached;
  const path = `publicProfiles/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', uid));
    if (!snap.exists()) return null;
    return docToPublicUser(snap.id, snap.data() as Record<string, unknown>);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function refreshPublicProfile(uid: string): Promise<PublicUser | null> {
  const path = `publicProfiles/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', uid));
    if (!snap.exists()) return null;
    return docToPublicUser(snap.id, snap.data() as Record<string, unknown>);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchPublicProfiles(uids: string[]): Promise<Map<string, PublicUser>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const result = new Map<string, PublicUser>();
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const user = await fetchPublicProfile(uid);
        if (user) result.set(uid, user);
      } catch {
        // Skip unreadable/non-existent profile
      }
    })
  );
  return result;
}

export async function createDiscretAccountInFirestore(params: {
  uid: string;
  displayName: string;
  identity: GeneratedIdentityPayload;
}): Promise<PublicUser> {
  const cleanName = params.displayName.trim().slice(0, 32);
  const pseudoKey = normalizePseudoKey(cleanName);
  if (cleanName.length < 2 || pseudoKey.length < 2 || !/^[a-z0-9_]{2,32}$/.test(pseudoKey)) {
    throw new PseudonymError(
      'Veuillez choisir un pseudonyme unique d’au moins 2 lettres ou chiffres.'
    );
  }

  const pseudoRef = doc(db, 'pseudonyms', pseudoKey);
  try {
    const existingPseudo = await getDoc(pseudoRef);
    if (existingPseudo.exists() && existingPseudo.data().userId !== params.uid) {
      throw new PseudonymError(
        'Ce pseudonyme est déjà utilisé par une autre personne. Choisissez-en un autre.'
      );
    }
  } catch (err) {
    if (err instanceof PseudonymError) throw err;
  }

  const handle = await generateUniqueHandle(cleanName);
  const handleKey = normalizeHandleKey(handle);
  const nowMs = Date.now();
  const ecdhPublicJwk = sanitizeJwk(params.identity.ecdhPublicJwk);
  const ecdsaPublicJwk = sanitizeJwk(params.identity.ecdsaPublicJwk);

  const convId = `${params.uid}__${params.uid}`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'users', params.uid), {
      ownerUid: params.uid,
      handle,
      displayName: cleanName,
      lookupId: params.identity.lookupId,
      encryptedVault: params.identity.encryptedVault,
      vaultSalt: params.identity.vaultSalt,
      vaultIv: params.identity.vaultIv,
      fingerprint: params.identity.fingerprint,
      ecdhPublicJwk,
      ecdsaPublicJwk,
      lastSeen: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'publicProfiles', params.uid), {
      id: params.uid,
      ownerUid: params.uid,
      handle,
      displayName: cleanName,
      bio: '',
      biography: '',
      avatarDataUrl: null,
      avatarIcon: 'initials',
      accentTone: 'platinum',
      bannerPreset: 'obsidian',
      bannerDataUrl: null,
      ecdhPublicJwk,
      ecdsaPublicJwk,
      fingerprint: params.identity.fingerprint,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'handleIndex', handleKey), {
      userId: params.uid,
      handle,
      createdAt: serverTimestamp(),
    });

    batch.set(pseudoRef, {
      userId: params.uid,
      displayName: cleanName,
      pseudoKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'conversations', convId), {
      id: convId,
      userA: params.uid,
      userB: params.uid,
      participantIds: [params.uid],
      lastMessageId: null,
      lastMessageCiphertext: null,
      lastMessageIv: null,
      lastMessageSignature: null,
      lastMessageFromId: null,
      lastMessageToId: null,
      lastMessageTimestamp: null,
      lastMessageExpiresAt: null,
      lastMessageReadAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    if (err instanceof PseudonymError) throw err;
    try {
      const check = await getDoc(pseudoRef);
      if (check.exists() && check.data().userId !== params.uid) {
        throw new PseudonymError(
          'Ce pseudonyme est déjà utilisé par une autre personne. Choisissez-en un autre.'
        );
      }
    } catch (inner) {
      if (inner instanceof PseudonymError) throw inner;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${params.uid}`);
  }

  void syncUserSearchBuckets(params.uid, cleanName, handle);

  const created: PublicUser = {
    id: params.uid,
    handle,
    displayName: cleanName,
    bio: '',
    biography: '',
    avatarDataUrl: null,
    avatarIcon: 'initials',
    accentTone: 'platinum',
    bannerPreset: 'obsidian',
    bannerDataUrl: null,
    ecdhPublicJwk,
    ecdsaPublicJwk,
    fingerprint: params.identity.fingerprint,
    createdAt: nowMs,
  };
  profileCache.set(params.uid, created);
  return created;
}

export async function updateMyProfileInFirestore(
  uid: string,
  updates: {
    displayName?: string;
    bio?: string;
    biography?: string;
    avatarDataUrl?: string | null;
    avatarIcon?: AvatarIconKey;
    accentTone?: AccentToneKey;
    bannerPreset?: BannerPresetKey;
    bannerDataUrl?: string | null;
  }
): Promise<PublicUser> {
  const pubPath = `publicProfiles/${uid}`;
  try {
    const pubRef = doc(db, 'publicProfiles', uid);
    const snap = await getDoc(pubRef);
    if (!snap.exists()) {
      throw new Error('Profil introuvable.');
    }
    const existing = docToPublicUser(uid, snap.data() as Record<string, unknown>);

    const nextDisplayName =
      typeof updates.displayName === 'string' && updates.displayName.trim().length > 0
        ? updates.displayName.trim().slice(0, 32)
        : existing.displayName;
    const oldPseudoKey = normalizePseudoKey(existing.displayName);
    const nextPseudoKey = normalizePseudoKey(nextDisplayName);

    if (
      nextDisplayName.length < 2 ||
      nextPseudoKey.length < 2 ||
      !/^[a-z0-9_]{2,32}$/.test(nextPseudoKey)
    ) {
      throw new PseudonymError(
        'Le pseudonyme doit contenir au moins 2 lettres ou chiffres.'
      );
    }

    const nextPseudoRef = doc(db, 'pseudonyms', nextPseudoKey);
    const nextPseudoSnap = await getDoc(nextPseudoRef);
    if (nextPseudoSnap.exists() && nextPseudoSnap.data().userId !== uid) {
      throw new PseudonymError(
        'Ce pseudonyme est déjà utilisé par une autre personne.'
      );
    }

    const nextBio =
      typeof updates.bio === 'string' ? updates.bio.trim().slice(0, 80) : existing.bio || '';
    const nextBiography =
      typeof updates.biography === 'string'
        ? updates.biography.trim().slice(0, 400)
        : existing.biography || '';
    const nextAvatarDataUrl =
      updates.avatarDataUrl === null
        ? null
        : typeof updates.avatarDataUrl === 'string' &&
            updates.avatarDataUrl.startsWith('data:image/') &&
            updates.avatarDataUrl.length <= 160_000
          ? updates.avatarDataUrl
          : existing.avatarDataUrl ?? null;
    const nextAvatarIcon =
      updates.avatarIcon && ALLOWED_ICONS.includes(updates.avatarIcon)
        ? updates.avatarIcon
        : existing.avatarIcon || 'initials';
    const nextAccentTone =
      updates.accentTone && ALLOWED_TONES.includes(updates.accentTone)
        ? updates.accentTone
        : existing.accentTone || 'platinum';
    const nextBannerPreset =
      updates.bannerPreset && ALLOWED_BANNERS.includes(updates.bannerPreset)
        ? updates.bannerPreset
        : existing.bannerPreset || 'obsidian';
    const nextBannerDataUrl =
      updates.bannerDataUrl === null
        ? null
        : typeof updates.bannerDataUrl === 'string' &&
            updates.bannerDataUrl.startsWith('data:image/') &&
            updates.bannerDataUrl.length <= 260_000
          ? updates.bannerDataUrl
          : existing.bannerDataUrl ?? null;

    const batch = writeBatch(db);
    batch.update(pubRef, {
      displayName: nextDisplayName,
      bio: nextBio,
      biography: nextBiography,
      avatarDataUrl: nextAvatarDataUrl,
      avatarIcon: nextAvatarIcon,
      accentTone: nextAccentTone,
      bannerPreset: nextBannerPreset,
      bannerDataUrl: nextBannerDataUrl,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid), {
      displayName: nextDisplayName,
      lastSeen: Date.now(),
      updatedAt: serverTimestamp(),
    });

    if (oldPseudoKey && oldPseudoKey !== nextPseudoKey && /^[a-z0-9_]{2,32}$/.test(oldPseudoKey)) {
      const oldPseudoRef = doc(db, 'pseudonyms', oldPseudoKey);
      const oldPseudoSnap = await getDoc(oldPseudoRef);
      if (oldPseudoSnap.exists() && oldPseudoSnap.data().userId === uid) {
        batch.delete(oldPseudoRef);
      }
    }

    if (!nextPseudoSnap.exists()) {
      batch.set(nextPseudoRef, {
        userId: uid,
        displayName: nextDisplayName,
        pseudoKey: nextPseudoKey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (nextPseudoSnap.data().displayName !== nextDisplayName) {
      batch.update(nextPseudoRef, {
        displayName: nextDisplayName,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    void syncUserSearchBuckets(uid, nextDisplayName, existing.handle);

    const updated: PublicUser = {
      ...existing,
      displayName: nextDisplayName,
      bio: nextBio,
      biography: nextBiography,
      avatarDataUrl: nextAvatarDataUrl,
      avatarIcon: nextAvatarIcon,
      accentTone: nextAccentTone,
      bannerPreset: nextBannerPreset,
      bannerDataUrl: nextBannerDataUrl,
    };
    profileCache.set(uid, updated);
    return updated;
  } catch (err) {
    if (err instanceof PseudonymError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, pubPath);
  }
}

export async function searchPublicUsers(
  rawQuery: string,
  _myUid?: string
): Promise<PublicUser[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const candidateIds = new Set<string>();
  const handleKey = normalizeHandleKey(q);
  if (handleKey.length >= 3 && /^[a-z0-9_]+$/.test(handleKey)) {
    try {
      const idxSnap = await getDoc(doc(db, 'handleIndex', handleKey));
      if (idxSnap.exists()) {
        const uid = idxSnap.data().userId;
        if (typeof uid === 'string') candidateIds.add(uid);
      }
    } catch {
      // Ignore miss
    }
  }

  const normalizedToken = q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^@/, '')
    .split('#')[0]
    .replace(/[^a-z0-9_]/g, '');

  const prefixes = new Set<string>();
  if (normalizedToken.length >= 2) {
    prefixes.add(normalizedToken.slice(0, Math.min(normalizedToken.length, 6)));
    if (normalizedToken.length >= 3) prefixes.add(normalizedToken.slice(0, 3));
    if (normalizedToken.length >= 2) prefixes.add(normalizedToken.slice(0, 2));
  }
  if (q.includes('#')) {
    const tag = q.split('#')[1]?.toLowerCase().replace(/[^a-z0-9_]/g, '') ?? '';
    if (tag.length >= 2) prefixes.add(tag.slice(0, 8));
  }

  await Promise.all(
    Array.from(prefixes).map(async (prefix) => {
      if (!/^[a-z0-9_]{2,24}$/.test(prefix)) return;
      try {
        const bucketSnap = await getDoc(doc(db, 'searchBuckets', prefix));
        if (bucketSnap.exists()) {
          const ids = bucketSnap.data().userIds;
          if (Array.isArray(ids)) {
            for (const id of ids) {
              if (typeof id === 'string') candidateIds.add(id);
            }
          }
        }
      } catch {
        // Ignore miss
      }
    })
  );

  const profiles = await fetchPublicProfiles(Array.from(candidateIds));
  const needle = q.toLowerCase();
  const matches: PublicUser[] = [];

  for (const user of profiles.values()) {
    if (
      user.handle.toLowerCase().includes(needle) ||
      user.displayName.toLowerCase().includes(needle) ||
      user.fingerprint.toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
    ) {
      matches.push(user);
    }
  }

  return matches.slice(0, 12);
}

// ============================================================================
// Direct Conversations & Messages
// ============================================================================

export async function isBlockedBetweenInFirestore(
  userA: string,
  userB: string
): Promise<boolean> {
  if (userA === userB) return false;
  try {
    const [b1, b2] = await Promise.all([
      getDoc(doc(db, 'blocks', `${userA}__${userB}`)),
      getDoc(doc(db, 'blocks', `${userB}__${userA}`)),
    ]);
    return b1.exists() || b2.exists();
  } catch {
    return false;
  }
}

export async function openConversationInFirestore(
  myUid: string,
  peerUid: string
): Promise<PublicUser | null> {
  const peer = await refreshPublicProfile(peerUid);
  if (!peer) return null;

  if (myUid !== peerUid && (await isBlockedBetweenInFirestore(myUid, peerUid))) {
    return peer;
  }

  const sorted = [myUid, peerUid].sort();
  const convId = `${sorted[0]}__${sorted[1]}`;
  const path = `conversations/${convId}`;
  try {
    const ref = doc(db, 'conversations', convId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: convId,
        userA: sorted[0],
        userB: sorted[1],
        participantIds: sorted[0] === sorted[1] ? [sorted[0]] : sorted,
        lastMessageId: null,
        lastMessageCiphertext: null,
        lastMessageIv: null,
        lastMessageSignature: null,
        lastMessageFromId: null,
        lastMessageToId: null,
        lastMessageTimestamp: null,
        lastMessageExpiresAt: null,
        lastMessageReadAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  return peer;
}

export function subscribeConversations(
  myUid: string,
  onChange: (conversations: ConversationSummary[]) => void
): Unsubscribe {
  const path = 'conversations';
  const q = query(
    collection(db, 'conversations'),
    where('participantIds', 'array-contains', myUid)
  );

  return onSnapshot(
    q,
    async (snap) => {
      const now = Date.now();
      const rawDocs = snap.docs.map((d) => d.data() as Record<string, unknown>);

      // Guarantee self-vault appears even if not yet loaded
      const peerIds = new Set<string>([myUid]);
      for (const d of rawDocs) {
        if (typeof d.userA === 'string') peerIds.add(d.userA);
        if (typeof d.userB === 'string') peerIds.add(d.userB);
      }

      const profiles = await fetchPublicProfiles(Array.from(peerIds));
      const summaries: ConversationSummary[] = [];
      const seenPeers = new Set<string>();

      for (const d of rawDocs) {
        const userA = String(d.userA || '');
        const userB = String(d.userB || '');
        const peerId = userA === myUid ? userB : userA;
        if (!peerId || seenPeers.has(peerId)) continue;
        const peer = profiles.get(peerId);
        if (!peer) continue;
        seenPeers.add(peerId);

        const expiresAt =
          typeof d.lastMessageExpiresAt === 'number' ? d.lastMessageExpiresAt : null;
        const isExpired = expiresAt !== null && expiresAt <= now;

        let lastMessage: EncryptedMessageEnvelope | null = null;
        if (typeof d.lastMessageId === 'string' && !isExpired) {
          lastMessage = {
            id: d.lastMessageId,
            conversationId: String(d.id || ''),
            fromId: String(d.lastMessageFromId || ''),
            toId: String(d.lastMessageToId || ''),
            ciphertext: String(d.lastMessageCiphertext || ''),
            iv: String(d.lastMessageIv || ''),
            signature: String(d.lastMessageSignature || ''),
            timestamp: Number(d.lastMessageTimestamp || 0),
            expiresAt,
            readAt: typeof d.lastMessageReadAt === 'number' ? d.lastMessageReadAt : null,
          };
        }

        const unreadCount =
          lastMessage &&
          lastMessage.toId === myUid &&
          lastMessage.fromId !== myUid &&
          lastMessage.readAt === null
            ? 1
            : 0;

        summaries.push({ peer, lastMessage, unreadCount });
      }

      if (!seenPeers.has(myUid)) {
        const self = profiles.get(myUid);
        if (self) {
          summaries.push({ peer: self, lastMessage: null, unreadCount: 0 });
        }
      }

      summaries.sort((a, b) => {
        const tsA = a.lastMessage?.timestamp ?? (a.peer.id === myUid ? 1 : 0);
        const tsB = b.lastMessage?.timestamp ?? (b.peer.id === myUid ? 1 : 0);
        return tsB - tsA;
      });

      onChange(summaries);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeDirectMessages(
  myUid: string,
  peerUid: string,
  onChange: (messages: EncryptedMessageEnvelope[]) => void
): Unsubscribe {
  const sorted = [myUid, peerUid].sort();
  const convId = `${sorted[0]}__${sorted[1]}`;
  const path = `conversations/${convId}/messages`;
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('timestamp', 'asc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const list: EncryptedMessageEnvelope[] = [];
      for (const docSnap of snap.docs) {
        const d = docSnap.data() as Record<string, unknown>;
        const expiresAt = typeof d.expiresAt === 'number' ? d.expiresAt : null;
        if (expiresAt !== null && expiresAt <= now) {
          if (d.fromId === myUid || d.toId === myUid) {
            void deleteDoc(docSnap.ref).catch(() => {});
          }
          continue;
        }
        list.push({
          id: String(d.id || docSnap.id),
          conversationId: convId,
          fromId: String(d.fromId || ''),
          toId: String(d.toId || ''),
          ciphertext: String(d.ciphertext || ''),
          iv: String(d.iv || ''),
          signature: String(d.signature || ''),
          timestamp: Number(d.timestamp || 0),
          expiresAt,
          readAt: typeof d.readAt === 'number' ? d.readAt : null,
        });
      }
      onChange(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function sendDirectMessageInFirestore(params: {
  id: string;
  fromId: string;
  toId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  ttlSeconds: number;
}): Promise<EncryptedMessageEnvelope> {
  if (
    params.toId !== params.fromId &&
    (await isBlockedBetweenInFirestore(params.fromId, params.toId))
  ) {
    throw new Error(
      'Action impossible : un blocage est actif entre vous et cet utilisateur.'
    );
  }

  const sorted = [params.fromId, params.toId].sort();
  const convId = `${sorted[0]}__${sorted[1]}`;
  const expiresAt =
    params.ttlSeconds > 0 ? Date.now() + params.ttlSeconds * 1000 : null;
  const readAt = params.toId === params.fromId ? Date.now() : null;
  const path = `conversations/${convId}/messages/${params.id}`;

  try {
    const convRef = doc(db, 'conversations', convId);
    const convSnap = await getDoc(convRef);
    const batch = writeBatch(db);

    if (!convSnap.exists()) {
      batch.set(convRef, {
        id: convId,
        userA: sorted[0],
        userB: sorted[1],
        participantIds: sorted[0] === sorted[1] ? [sorted[0]] : sorted,
        lastMessageId: params.id,
        lastMessageCiphertext: params.ciphertext,
        lastMessageIv: params.iv,
        lastMessageSignature: params.signature,
        lastMessageFromId: params.fromId,
        lastMessageToId: params.toId,
        lastMessageTimestamp: params.timestamp,
        lastMessageExpiresAt: expiresAt,
        lastMessageReadAt: readAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(convRef, {
        lastMessageId: params.id,
        lastMessageCiphertext: params.ciphertext,
        lastMessageIv: params.iv,
        lastMessageSignature: params.signature,
        lastMessageFromId: params.fromId,
        lastMessageToId: params.toId,
        lastMessageTimestamp: params.timestamp,
        lastMessageExpiresAt: expiresAt,
        lastMessageReadAt: readAt,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'conversations', convId, 'messages', params.id), {
      id: params.id,
      conversationId: convId,
      fromId: params.fromId,
      toId: params.toId,
      ciphertext: params.ciphertext,
      iv: params.iv,
      signature: params.signature,
      timestamp: params.timestamp,
      expiresAt,
      readAt,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  return {
    id: params.id,
    conversationId: convId,
    fromId: params.fromId,
    toId: params.toId,
    ciphertext: params.ciphertext,
    iv: params.iv,
    signature: params.signature,
    timestamp: params.timestamp,
    expiresAt,
    readAt,
  };
}

export async function markConversationReadInFirestore(
  myUid: string,
  peerUid: string
): Promise<void> {
  if (myUid === peerUid) return;
  const sorted = [myUid, peerUid].sort();
  const convId = `${sorted[0]}__${sorted[1]}`;
  const path = `conversations/${convId}/messages`;

  try {
    const q = query(
      collection(db, 'conversations', convId, 'messages'),
      where('toId', '==', myUid),
      where('readAt', '==', null)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const now = Date.now();
    const batch = writeBatch(db);
    for (const d of snap.docs) {
      batch.update(d.ref, { readAt: now });
    }
    const convRef = doc(db, 'conversations', convId);
    const convSnap = await getDoc(convRef);
    if (convSnap.exists() && convSnap.data().lastMessageToId === myUid) {
      batch.update(convRef, {
        lastMessageReadAt: now,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteDirectMessageInFirestore(
  convId: string,
  messageId: string
): Promise<void> {
  const path = `conversations/${convId}/messages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'conversations', convId, 'messages', messageId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// E2EE Groups
// ============================================================================

export function subscribeGroups(
  myUid: string,
  onChange: (groups: GroupInfo[]) => void
): Unsubscribe {
  const path = 'groups';
  const q = query(
    collection(db, 'groups'),
    where('memberIds', 'array-contains', myUid)
  );

  return onSnapshot(
    q,
    async (snap) => {
      const now = Date.now();
      const rawDocs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      const allMemberIds = new Set<string>();

      for (const d of rawDocs) {
        if (Array.isArray(d.memberIds)) {
          for (const id of d.memberIds) {
            if (typeof id === 'string') allMemberIds.add(id);
          }
        }
      }

      const profiles = await fetchPublicProfiles(Array.from(allMemberIds));

      const groups: GroupInfo[] = await Promise.all(
        rawDocs.map(async (d) => {
          const groupId = String(d.id || '');
          const memberIds = Array.isArray(d.memberIds)
            ? (d.memberIds as string[])
            : [];
          const members = memberIds
            .map((id) => profiles.get(id))
            .filter((u): u is PublicUser => Boolean(u));

          const keyEnvelopes: Record<string, GroupKeyEnvelope> = {};
          try {
            const envSnap = await getDoc(
              doc(db, 'groups', groupId, 'members', myUid)
            );
            if (envSnap.exists()) {
              const ed = envSnap.data() as Record<string, unknown>;
              keyEnvelopes[myUid] = {
                iv: String(ed.iv || ''),
                wrappedKey: String(ed.wrappedKey || ''),
                wrappedByUserId: String(ed.wrappedByUserId || ''),
              };
            }
          } catch {
            // Envelope unreadable
          }

          const expiresAt =
            typeof d.lastMessageExpiresAt === 'number'
              ? d.lastMessageExpiresAt
              : null;
          const lastMessage: GroupMessageEnvelope | null =
            typeof d.lastMessageId === 'string' &&
            (expiresAt === null || expiresAt > now)
              ? {
                  id: d.lastMessageId,
                  groupId,
                  fromId: String(d.lastMessageFromId || ''),
                  ciphertext: String(d.lastMessageCiphertext || ''),
                  iv: String(d.lastMessageIv || ''),
                  signature: String(d.lastMessageSignature || ''),
                  timestamp: Number(d.lastMessageTimestamp || 0),
                  expiresAt,
                }
              : null;

          return {
            id: groupId,
            name: String(d.name || 'Groupe'),
            description: typeof d.description === 'string' ? d.description : '',
            avatarDataUrl:
              typeof d.avatarDataUrl === 'string' ? d.avatarDataUrl : null,
            bannerPreset: ALLOWED_BANNERS.includes(d.bannerPreset as BannerPresetKey)
              ? (d.bannerPreset as BannerPresetKey)
              : 'monolith',
            bannerDataUrl:
              typeof d.bannerDataUrl === 'string' ? d.bannerDataUrl : null,
            accentTone: ALLOWED_TONES.includes(d.accentTone as AccentToneKey)
              ? (d.accentTone as AccentToneKey)
              : 'platinum',
            creatorId: String(d.creatorId || ''),
            members,
            keyEnvelopes,
            createdAt: Number(d.createdAtMs || Date.now()),
            lastMessage,
          };
        })
      );

      groups.sort((a, b) => {
        const tsA = a.lastMessage?.timestamp ?? a.createdAt;
        const tsB = b.lastMessage?.timestamp ?? b.createdAt;
        return tsB - tsA;
      });

      onChange(groups);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeGroupMessages(
  groupId: string,
  onChange: (messages: GroupMessageEnvelope[]) => void
): Unsubscribe {
  const path = `groups/${groupId}/messages`;
  const q = query(
    collection(db, 'groups', groupId, 'messages'),
    orderBy('timestamp', 'asc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const list: GroupMessageEnvelope[] = [];
      for (const docSnap of snap.docs) {
        const d = docSnap.data() as Record<string, unknown>;
        const expiresAt = typeof d.expiresAt === 'number' ? d.expiresAt : null;
        if (expiresAt !== null && expiresAt <= now) {
          void deleteDoc(docSnap.ref).catch(() => {});
          continue;
        }
        list.push({
          id: String(d.id || docSnap.id),
          groupId,
          fromId: String(d.fromId || ''),
          ciphertext: String(d.ciphertext || ''),
          iv: String(d.iv || ''),
          signature: String(d.signature || ''),
          timestamp: Number(d.timestamp || 0),
          expiresAt,
        });
      }
      onChange(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function createGroupInFirestore(params: {
  creatorId: string;
  name: string;
  description: string;
  avatarDataUrl: string | null;
  bannerPreset: BannerPresetKey;
  bannerDataUrl: string | null;
  accentTone: AccentToneKey;
  memberIds: string[];
  keyEnvelopes: Record<string, GroupKeyEnvelope>;
}): Promise<GroupInfo> {
  const groupId = crypto.randomUUID();
  const cleanName = params.name.trim().slice(0, 40) || 'Groupe';
  const cleanDesc = params.description.trim().slice(0, 100);
  const uniqueMemberIds = Array.from(
    new Set([params.creatorId, ...params.memberIds])
  ).slice(0, 25);
  const createdAtMs = Date.now();

  const safeAvatar =
    typeof params.avatarDataUrl === 'string' &&
    params.avatarDataUrl.startsWith('data:image/') &&
    params.avatarDataUrl.length <= 160_000
      ? params.avatarDataUrl
      : null;

  const safeBanner =
    typeof params.bannerDataUrl === 'string' &&
    params.bannerDataUrl.startsWith('data:image/') &&
    params.bannerDataUrl.length <= 260_000
      ? params.bannerDataUrl
      : null;

  const path = `groups/${groupId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      id: groupId,
      name: cleanName,
      description: cleanDesc,
      avatarDataUrl: safeAvatar,
      bannerPreset: ALLOWED_BANNERS.includes(params.bannerPreset)
        ? params.bannerPreset
        : 'monolith',
      bannerDataUrl: safeBanner,
      accentTone: ALLOWED_TONES.includes(params.accentTone)
        ? params.accentTone
        : 'platinum',
      creatorId: params.creatorId,
      memberIds: uniqueMemberIds,
      lastMessageId: null,
      lastMessageFromId: null,
      lastMessageCiphertext: null,
      lastMessageIv: null,
      lastMessageSignature: null,
      lastMessageTimestamp: null,
      lastMessageExpiresAt: null,
      createdAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const memberId of uniqueMemberIds) {
      const env = params.keyEnvelopes[memberId];
      if (!env) continue;
      batch.set(doc(db, 'groups', groupId, 'members', memberId), {
        userId: memberId,
        groupId,
        iv: env.iv,
        wrappedKey: env.wrappedKey,
        wrappedByUserId: env.wrappedByUserId,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  const profiles = await fetchPublicProfiles(uniqueMemberIds);
  const members = uniqueMemberIds
    .map((id) => profiles.get(id))
    .filter((u): u is PublicUser => Boolean(u));

  return {
    id: groupId,
    name: cleanName,
    description: cleanDesc,
    avatarDataUrl: safeAvatar,
    bannerPreset: params.bannerPreset,
    bannerDataUrl: safeBanner,
    accentTone: params.accentTone,
    creatorId: params.creatorId,
    members,
    keyEnvelopes: params.keyEnvelopes,
    createdAt: createdAtMs,
    lastMessage: null,
  };
}

export async function updateGroupInFirestore(
  groupId: string,
  updates: {
    name?: string;
    description?: string;
    avatarDataUrl?: string | null;
    bannerPreset?: BannerPresetKey;
    bannerDataUrl?: string | null;
    accentTone?: AccentToneKey;
  }
): Promise<void> {
  const path = `groups/${groupId}`;
  try {
    const ref = doc(db, 'groups', groupId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Groupe introuvable.');
    const cur = snap.data() as Record<string, unknown>;

    const nextName =
      typeof updates.name === 'string' && updates.name.trim().length > 0
        ? updates.name.trim().slice(0, 40)
        : String(cur.name || 'Groupe');
    const nextDesc =
      typeof updates.description === 'string'
        ? updates.description.trim().slice(0, 100)
        : String(cur.description || '');
    const nextAvatar =
      updates.avatarDataUrl === null
        ? null
        : typeof updates.avatarDataUrl === 'string' &&
            updates.avatarDataUrl.startsWith('data:image/') &&
            updates.avatarDataUrl.length <= 160_000
          ? updates.avatarDataUrl
          : (cur.avatarDataUrl as string | null) ?? null;
    const nextBannerPreset =
      updates.bannerPreset && ALLOWED_BANNERS.includes(updates.bannerPreset)
        ? updates.bannerPreset
        : (cur.bannerPreset as BannerPresetKey) || 'monolith';
    const nextBannerData =
      updates.bannerDataUrl === null
        ? null
        : typeof updates.bannerDataUrl === 'string' &&
            updates.bannerDataUrl.startsWith('data:image/') &&
            updates.bannerDataUrl.length <= 260_000
          ? updates.bannerDataUrl
          : (cur.bannerDataUrl as string | null) ?? null;
    const nextTone =
      updates.accentTone && ALLOWED_TONES.includes(updates.accentTone)
        ? updates.accentTone
        : (cur.accentTone as AccentToneKey) || 'platinum';

    await updateDoc(ref, {
      name: nextName,
      description: nextDesc,
      avatarDataUrl: nextAvatar,
      bannerPreset: nextBannerPreset,
      bannerDataUrl: nextBannerData,
      accentTone: nextTone,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function addGroupMemberInFirestore(
  groupId: string,
  myUid: string,
  targetUserId: string,
  envelope: GroupKeyEnvelope
): Promise<void> {
  if (await isBlockedBetweenInFirestore(myUid, targetUserId)) {
    throw new Error('Impossible d’inviter un utilisateur bloqué.');
  }

  const path = `groups/${groupId}/members/${targetUserId}`;
  try {
    const groupRef = doc(db, 'groups', groupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists()) throw new Error('Groupe introuvable.');
    const existingIds = Array.isArray(snap.data().memberIds)
      ? (snap.data().memberIds as string[])
      : [];
    if (existingIds.length >= 25 && !existingIds.includes(targetUserId)) {
      throw new Error('Limite maximale de 25 membres atteinte.');
    }

    const nextIds = existingIds.includes(targetUserId)
      ? existingIds
      : [...existingIds, targetUserId];

    const batch = writeBatch(db);
    batch.update(groupRef, {
      memberIds: nextIds,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', targetUserId), {
      userId: targetUserId,
      groupId,
      iv: envelope.iv,
      wrappedKey: envelope.wrappedKey,
      wrappedByUserId: envelope.wrappedByUserId,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function leaveGroupInFirestore(
  groupId: string,
  myUid: string
): Promise<void> {
  const path = `groups/${groupId}`;
  try {
    const groupRef = doc(db, 'groups', groupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists()) return;
    const data = snap.data() as Record<string, unknown>;
    const existingIds = Array.isArray(data.memberIds)
      ? (data.memberIds as string[])
      : [];
    const remaining = existingIds.filter((id) => id !== myUid);

    if (remaining.length === 0 && data.creatorId === myUid) {
      await deleteGroupInFirestore(groupId);
      return;
    }

    const batch = writeBatch(db);
    batch.delete(doc(db, 'groups', groupId, 'members', myUid));
    if (remaining.length > 0) {
      batch.update(groupRef, {
        memberIds: remaining,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteGroupInFirestore(groupId: string): Promise<void> {
  const path = `groups/${groupId}`;
  try {
    const groupRef = doc(db, 'groups', groupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists()) return;
    const memberIds = Array.isArray(snap.data().memberIds)
      ? (snap.data().memberIds as string[])
      : [];

    const msgSnap = await getDocs(collection(db, 'groups', groupId, 'messages'));
    const batch = writeBatch(db);
    for (const m of msgSnap.docs) {
      batch.delete(m.ref);
    }
    for (const memberId of memberIds) {
      batch.delete(doc(db, 'groups', groupId, 'members', memberId));
    }
    batch.delete(groupRef);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function sendGroupMessageInFirestore(params: {
  id: string;
  groupId: string;
  fromId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  ttlSeconds: number;
}): Promise<GroupMessageEnvelope> {
  const expiresAt =
    params.ttlSeconds > 0 ? Date.now() + params.ttlSeconds * 1000 : null;
  const path = `groups/${params.groupId}/messages/${params.id}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', params.groupId, 'messages', params.id), {
      id: params.id,
      groupId: params.groupId,
      fromId: params.fromId,
      ciphertext: params.ciphertext,
      iv: params.iv,
      signature: params.signature,
      timestamp: params.timestamp,
      expiresAt,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'groups', params.groupId), {
      lastMessageId: params.id,
      lastMessageFromId: params.fromId,
      lastMessageCiphertext: params.ciphertext,
      lastMessageIv: params.iv,
      lastMessageSignature: params.signature,
      lastMessageTimestamp: params.timestamp,
      lastMessageExpiresAt: expiresAt,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  return {
    id: params.id,
    groupId: params.groupId,
    fromId: params.fromId,
    ciphertext: params.ciphertext,
    iv: params.iv,
    signature: params.signature,
    timestamp: params.timestamp,
    expiresAt,
  };
}

export async function deleteGroupMessageInFirestore(
  groupId: string,
  messageId: string
): Promise<void> {
  const path = `groups/${groupId}/messages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'groups', groupId, 'messages', messageId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// Friends, Requests & Blocks
// ============================================================================

export function subscribeFriendsSnapshot(
  myUid: string,
  onChange: (snapshot: FriendsSnapshot) => void
): Unsubscribe {
  let friendDocs: Array<Record<string, unknown>> = [];
  let reqDocs: Array<Record<string, unknown>> = [];
  let blockDocs: Array<Record<string, unknown>> = [];

  async function recompute() {
    const uids = new Set<string>();
    for (const f of friendDocs) {
      if (typeof f.userA === 'string' && f.userA !== myUid) uids.add(f.userA);
      if (typeof f.userB === 'string' && f.userB !== myUid) uids.add(f.userB);
    }
    for (const r of reqDocs) {
      if (typeof r.fromId === 'string') uids.add(r.fromId);
      if (typeof r.toId === 'string') uids.add(r.toId);
    }
    for (const b of blockDocs) {
      if (typeof b.blockerId === 'string') uids.add(b.blockerId);
      if (typeof b.targetId === 'string') uids.add(b.targetId);
    }
    uids.add(myUid);

    const profiles = await fetchPublicProfiles(Array.from(uids));

    const friends: PublicUser[] = [];
    for (const f of friendDocs) {
      const peerId = f.userA === myUid ? String(f.userB || '') : String(f.userA || '');
      const u = profiles.get(peerId);
      if (u) friends.push(u);
    }
    friends.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

    const incoming: FriendRequestRecord[] = [];
    const outgoing: FriendRequestRecord[] = [];
    for (const r of reqDocs) {
      const fromUser = profiles.get(String(r.fromId || ''));
      const toUser = profiles.get(String(r.toId || ''));
      if (!fromUser || !toUser) continue;
      const item: FriendRequestRecord = {
        id: String(r.id || ''),
        fromUser,
        toUser,
        createdAt: Number(r.createdAtMs || Date.now()),
      };
      if (r.toId === myUid) incoming.push(item);
      if (r.fromId === myUid) outgoing.push(item);
    }
    incoming.sort((a, b) => b.createdAt - a.createdAt);
    outgoing.sort((a, b) => b.createdAt - a.createdAt);

    const blocked: PublicUser[] = [];
    const blockedByIds: string[] = [];
    for (const b of blockDocs) {
      if (b.blockerId === myUid) {
        const u = profiles.get(String(b.targetId || ''));
        if (u) blocked.push(u);
      } else if (b.targetId === myUid && typeof b.blockerId === 'string') {
        blockedByIds.push(b.blockerId);
      }
    }

    onChange({ friends, incoming, outgoing, blocked, blockedByIds });
  }

  const unsubFriends = onSnapshot(
    query(collection(db, 'friendships'), where('participantIds', 'array-contains', myUid)),
    (snap) => {
      friendDocs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      void recompute();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'friendships')
  );

  const unsubRequests = onSnapshot(
    query(collection(db, 'friendRequests'), where('participantIds', 'array-contains', myUid)),
    (snap) => {
      reqDocs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      void recompute();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'friendRequests')
  );

  const unsubBlocks = onSnapshot(
    query(collection(db, 'blocks'), where('participantIds', 'array-contains', myUid)),
    (snap) => {
      blockDocs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      void recompute();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'blocks')
  );

  return () => {
    unsubFriends();
    unsubRequests();
    unsubBlocks();
  };
}

export async function sendFriendRequestInFirestore(
  myUid: string,
  targetUserId: string
): Promise<'requested' | 'accepted' | 'already_friends'> {
  if (myUid === targetUserId) {
    throw new Error('Vous ne pouvez pas vous ajouter vous-même.');
  }
  if (await isBlockedBetweenInFirestore(myUid, targetUserId)) {
    throw new Error('Impossible : un blocage est actif avec cet utilisateur.');
  }

  const sorted = [myUid, targetUserId].sort();
  const friendshipId = `${sorted[0]}__${sorted[1]}`;
  const friendSnap = await getDoc(doc(db, 'friendships', friendshipId));
  if (friendSnap.exists()) return 'already_friends';

  const reverseReqId = `${targetUserId}__${myUid}`;
  const reverseReqSnap = await getDoc(doc(db, 'friendRequests', reverseReqId));
  if (reverseReqSnap.exists()) {
    await acceptFriendRequestInFirestore(myUid, targetUserId);
    return 'accepted';
  }

  const reqId = `${myUid}__${targetUserId}`;
  const path = `friendRequests/${reqId}`;
  try {
    const existing = await getDoc(doc(db, 'friendRequests', reqId));
    if (!existing.exists()) {
      await setDoc(doc(db, 'friendRequests', reqId), {
        id: reqId,
        fromId: myUid,
        toId: targetUserId,
        participantIds: [myUid, targetUserId],
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  return 'requested';
}

export async function acceptFriendRequestInFirestore(
  myUid: string,
  fromUserId: string
): Promise<void> {
  if (await isBlockedBetweenInFirestore(myUid, fromUserId)) {
    throw new Error('Impossible : un blocage est actif.');
  }
  const reqId = `${fromUserId}__${myUid}`;
  const sorted = [myUid, fromUserId].sort();
  const friendshipId = `${sorted[0]}__${sorted[1]}`;
  const path = `friendships/${friendshipId}`;

  try {
    const reqRef = doc(db, 'friendRequests', reqId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) {
      throw new Error('Demande d’ami introuvable.');
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'friendships', friendshipId), {
      id: friendshipId,
      userA: sorted[0],
      userB: sorted[1],
      participantIds: sorted,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    });
    batch.delete(reqRef);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function declineFriendRequestInFirestore(
  myUid: string,
  otherUserId: string
): Promise<void> {
  const path = 'friendRequests';
  try {
    const batch = writeBatch(db);
    const r1 = doc(db, 'friendRequests', `${myUid}__${otherUserId}`);
    const r2 = doc(db, 'friendRequests', `${otherUserId}__${myUid}`);
    const [s1, s2] = await Promise.all([getDoc(r1), getDoc(r2)]);
    if (s1.exists()) batch.delete(r1);
    if (s2.exists()) batch.delete(r2);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function removeFriendInFirestore(
  myUid: string,
  otherUserId: string
): Promise<void> {
  const sorted = [myUid, otherUserId].sort();
  const friendshipId = `${sorted[0]}__${sorted[1]}`;
  try {
    await deleteDoc(doc(db, 'friendships', friendshipId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `friendships/${friendshipId}`);
  }
}

export async function blockUserInFirestore(
  myUid: string,
  targetUserId: string
): Promise<void> {
  const blockId = `${myUid}__${targetUserId}`;
  const sorted = [myUid, targetUserId].sort();
  const friendshipId = `${sorted[0]}__${sorted[1]}`;
  try {
    const [fSnap, r1Snap, r2Snap] = await Promise.all([
      getDoc(doc(db, 'friendships', friendshipId)),
      getDoc(doc(db, 'friendRequests', `${myUid}__${targetUserId}`)),
      getDoc(doc(db, 'friendRequests', `${targetUserId}__${myUid}`)),
    ]);

    const batch = writeBatch(db);
    batch.set(doc(db, 'blocks', blockId), {
      id: blockId,
      blockerId: myUid,
      targetId: targetUserId,
      participantIds: [myUid, targetUserId],
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    });
    if (fSnap.exists()) batch.delete(fSnap.ref);
    if (r1Snap.exists()) batch.delete(r1Snap.ref);
    if (r2Snap.exists()) batch.delete(r2Snap.ref);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `blocks/${blockId}`);
  }
}

export async function unblockUserInFirestore(
  myUid: string,
  targetUserId: string
): Promise<void> {
  const blockId = `${myUid}__${targetUserId}`;
  try {
    await deleteDoc(doc(db, 'blocks', blockId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `blocks/${blockId}`);
  }
}

// ============================================================================
// Private Friend Aliases (Custom Friend Nicknames)
// ============================================================================

export function subscribeFriendAliases(
  myUid: string,
  onChange: (aliases: Record<string, string>) => void
): Unsubscribe {
  const path = `users/${myUid}/friendAliases`;
  return onSnapshot(
    collection(db, 'users', myUid, 'friendAliases'),
    (snap) => {
      const next: Record<string, string> = {};
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const targetId = String(data.targetUserId || d.id);
        const nickname = typeof data.nickname === 'string' ? data.nickname.trim() : '';
        if (targetId && nickname) {
          next[targetId] = nickname;
        }
      }
      onChange(next);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function setFriendAliasInFirestore(
  myUid: string,
  targetUserId: string,
  nickname: string
): Promise<void> {
  if (!targetUserId || targetUserId === myUid) return;
  const clean = nickname.trim().slice(0, 32);
  const ref = doc(db, 'users', myUid, 'friendAliases', targetUserId);
  const path = `users/${myUid}/friendAliases/${targetUserId}`;

  try {
    if (!clean) {
      await deleteDoc(ref);
      return;
    }
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        nickname: clean,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        targetUserId,
        nickname: clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removeFriendAliasInFirestore(
  myUid: string,
  targetUserId: string
): Promise<void> {
  if (!targetUserId || targetUserId === myUid) return;
  const path = `users/${myUid}/friendAliases/${targetUserId}`;
  try {
    await deleteDoc(doc(db, 'users', myUid, 'friendAliases', targetUserId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function dispatchPushNotification(payload: {
  targetUserIds: string[];
  title: string;
  body: string;
  discreetTitle: string;
  discreetBody: string;
  tag: string;
  data: Record<string, unknown>;
}): Promise<void> {
  if (payload.targetUserIds.length === 0) return;
  try {
    const token = await getFreshFirebaseIdToken();
    if (!token) return;
    await fetch('/api/push/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-blocking best-effort background push
  }
}
