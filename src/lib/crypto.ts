// Web Crypto API End-to-End Encryption & Zero-Knowledge Key Derivation Engine
import type { ReplyReference } from '../types';

const KEY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PBKDF2_ITERATIONS = 250_000;

function sanitizeReplyReference(raw: unknown): ReplyReference | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return undefined;
  return {
    id: r.id.slice(0, 128),
    senderName:
      typeof r.senderName === 'string' && r.senderName.trim()
        ? r.senderName.trim().slice(0, 48)
        : 'Contact',
    excerpt: typeof r.excerpt === 'string' ? r.excerpt.slice(0, 180) : '',
  };
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8Encode(str: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(str);
  const buffer = new ArrayBuffer(encoded.byteLength);
  const view = new Uint8Array(buffer);
  view.set(encoded);
  return view;
}

function utf8Decode(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Generates a high-entropy unique access key (24 chars from 32-char unambiguous alphabet = 120 bits).
 * Formatted as DISCRET-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 */
export function generateUniqueAccessKey(): string {
  const randomBytes = new Uint8Array(24);
  window.crypto.getRandomValues(randomBytes);
  let raw = '';
  for (let i = 0; i < 24; i++) {
    raw += KEY_ALPHABET[randomBytes[i] % KEY_ALPHABET.length];
  }
  const groups = raw.match(/.{1,4}/g) ?? [];
  return `DISCRET-${groups.join('-')}`;
}

export function normalizeAccessKey(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.startsWith('DISCRET')) return cleaned.slice(7);
  if (cleaned.startsWith('VOILE')) return cleaned.slice(5);
  return cleaned;
}

export async function deriveLookupId(rawKey: string): Promise<string> {
  const normalized = normalizeAccessKey(rawKey);
  const data = utf8Encode(`voile:lookup:v1:${normalized}`);
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derives deterministic, domain-separated zero-knowledge credentials
 * solely from the user's secret DISCRET access key.
 * Neither email nor password ever corresponds to a real mailbox or Google account.
 */
export async function deriveVaultAuthCredentials(
  rawKey: string
): Promise<{ vaultEmail: string; vaultPassword: string }> {
  const normalized = normalizeAccessKey(rawKey);
  const emailDigest = await window.crypto.subtle.digest(
    'SHA-256',
    utf8Encode(`discret:fb-id:v1:${normalized}`)
  );
  const emailHex = Array.from(new Uint8Array(emailDigest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    utf8Encode(normalized),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const authBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: utf8Encode('discret:fb-auth-secret:v1'),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const authB64Url = toBase64(authBits)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return {
    vaultEmail: `${emailHex}@vault.discret.app`,
    vaultPassword: `${authB64Url}!D1`,
  };
}

async function deriveVaultAesKey(
  rawKey: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const normalized = normalizeAccessKey(rawKey);
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    utf8Encode(normalized),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function computePublicFingerprint(
  ecdhPublicJwk: JsonWebKey,
  ecdsaPublicJwk: JsonWebKey
): Promise<string> {
  const canonical = JSON.stringify({
    ecdh: { x: ecdhPublicJwk.x, y: ecdhPublicJwk.y },
    ecdsa: { x: ecdsaPublicJwk.x, y: ecdsaPublicJwk.y },
  });
  const digest = await window.crypto.subtle.digest('SHA-256', utf8Encode(canonical));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return (hex.match(/.{1,4}/g) ?? []).join(' ');
}

export async function computeConversationSafetyNumber(
  fpA: string,
  fpB: string
): Promise<string> {
  const sorted = [fpA.replace(/\s+/g, ''), fpB.replace(/\s+/g, '')].sort().join(':');
  const digest = await window.crypto.subtle.digest('SHA-256', utf8Encode(sorted));
  const bytes = new Uint8Array(digest).slice(0, 15);
  const blocks: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const num = ((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]) % 100000;
    blocks.push(num.toString().padStart(5, '0'));
  }
  return blocks.join(' ');
}

export interface GeneratedIdentityPayload {
  lookupId: string;
  ecdhPublicJwk: JsonWebKey;
  ecdsaPublicJwk: JsonWebKey;
  ecdhPrivateKey: CryptoKey;
  ecdsaPrivateKey: CryptoKey;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
  encryptedVault: string;
  vaultSalt: string;
  vaultIv: string;
  fingerprint: string;
}

export async function createIdentityFromAccessKey(
  accessKey: string
): Promise<GeneratedIdentityPayload> {
  const [ecdhPair, ecdsaPair] = await Promise.all([
    window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    ),
    window.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    ),
  ]);

  const [ecdhPublicJwk, ecdhPrivateJwk, ecdsaPublicJwk, ecdsaPrivateJwk] =
    await Promise.all([
      window.crypto.subtle.exportKey('jwk', ecdhPair.publicKey),
      window.crypto.subtle.exportKey('jwk', ecdhPair.privateKey),
      window.crypto.subtle.exportKey('jwk', ecdsaPair.publicKey),
      window.crypto.subtle.exportKey('jwk', ecdsaPair.privateKey),
    ]);

  const saltBuf = new ArrayBuffer(16);
  const salt = new Uint8Array(saltBuf);
  window.crypto.getRandomValues(salt);

  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  window.crypto.getRandomValues(iv);

  const vaultKey = await deriveVaultAesKey(accessKey, salt);
  const vaultPlaintext = utf8Encode(
    JSON.stringify({ ecdhPrivateJwk, ecdsaPrivateJwk })
  );
  const encryptedVaultBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    vaultKey,
    vaultPlaintext
  );

  const [lookupId, fingerprint] = await Promise.all([
    deriveLookupId(accessKey),
    computePublicFingerprint(ecdhPublicJwk, ecdsaPublicJwk),
  ]);

  return {
    lookupId,
    ecdhPublicJwk,
    ecdsaPublicJwk,
    ecdhPrivateKey: ecdhPair.privateKey,
    ecdsaPrivateKey: ecdsaPair.privateKey,
    ecdhPrivateJwk,
    ecdsaPrivateJwk,
    encryptedVault: toBase64(encryptedVaultBuf),
    vaultSalt: toBase64(salt),
    vaultIv: toBase64(iv),
    fingerprint,
  };
}

export async function unlockVaultWithAccessKey(
  accessKey: string,
  vaultSaltB64: string,
  vaultIvB64: string,
  encryptedVaultB64: string
): Promise<{
  ecdhPrivateKey: CryptoKey;
  ecdsaPrivateKey: CryptoKey;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}> {
  const salt = fromBase64(vaultSaltB64);
  const iv = fromBase64(vaultIvB64);
  const ciphertext = fromBase64(encryptedVaultB64);

  const vaultKey = await deriveVaultAesKey(accessKey, salt);
  const decryptedBuf = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    vaultKey,
    ciphertext
  );

  const parsed = JSON.parse(utf8Decode(decryptedBuf)) as {
    ecdhPrivateJwk: JsonWebKey;
    ecdsaPrivateJwk: JsonWebKey;
  };

  const [ecdhPrivateKey, ecdsaPrivateKey] = await Promise.all([
    window.crypto.subtle.importKey(
      'jwk',
      parsed.ecdhPrivateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    ),
    window.crypto.subtle.importKey(
      'jwk',
      parsed.ecdsaPrivateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    ),
  ]);

  return {
    ecdhPrivateKey,
    ecdsaPrivateKey,
    ecdhPrivateJwk: parsed.ecdhPrivateJwk,
    ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
  };
}

export async function importKeysFromJwks(
  ecdhPrivateJwk: JsonWebKey,
  ecdsaPrivateJwk: JsonWebKey
): Promise<{ ecdhPrivateKey: CryptoKey; ecdsaPrivateKey: CryptoKey }> {
  const [ecdhPrivateKey, ecdsaPrivateKey] = await Promise.all([
    window.crypto.subtle.importKey(
      'jwk',
      ecdhPrivateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    ),
    window.crypto.subtle.importKey(
      'jwk',
      ecdsaPrivateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    ),
  ]);
  return { ecdhPrivateKey, ecdsaPrivateKey };
}

export async function signChallenge(
  ecdsaPrivateKey: CryptoKey,
  challenge: string
): Promise<string> {
  const sig = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    ecdsaPrivateKey,
    utf8Encode(challenge)
  );
  return toBase64(sig);
}

async function deriveConversationAesKey(
  myEcdhPrivateKey: CryptoKey,
  peerEcdhPublicJwk: JsonWebKey,
  conversationId: string
): Promise<CryptoKey> {
  const peerPublicKey = await window.crypto.subtle.importKey(
    'jwk',
    peerEcdhPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    myEcdhPrivateKey,
    256
  );

  const hkdfMaterial = await window.crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8Encode(`voile-conv:${conversationId}`),
      info: utf8Encode('voile-e2ee-aes-256-gcm-v1'),
    },
    hkdfMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function getCanonicalConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

export async function encryptAndSignMessage(params: {
  id: string;
  fromId: string;
  toId: string;
  plaintext: string;
  replyTo?: ReplyReference;
  timestamp: number;
  myEcdhPrivateKey: CryptoKey;
  myEcdsaPrivateKey: CryptoKey;
  peerEcdhPublicJwk: JsonWebKey;
}): Promise<{ ciphertext: string; iv: string; signature: string; conversationId: string }> {
  const conversationId = getCanonicalConversationId(params.fromId, params.toId);
  const aesKey = await deriveConversationAesKey(
    params.myEcdhPrivateKey,
    params.peerEcdhPublicJwk,
    conversationId
  );

  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  window.crypto.getRandomValues(iv);

  const replyTo = sanitizeReplyReference(params.replyTo);
  const payload = JSON.stringify({
    text: params.plaintext,
    ...(replyTo ? { replyTo } : {}),
    v: replyTo ? 2 : 1,
    ts: params.timestamp,
  });

  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    utf8Encode(payload)
  );

  const ciphertext = toBase64(cipherBuf);
  const ivB64 = toBase64(iv);

  const signTranscript = `${params.id}|${params.fromId}|${params.toId}|${ivB64}|${ciphertext}|${params.timestamp}`;
  const sigBuf = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    params.myEcdsaPrivateKey,
    utf8Encode(signTranscript)
  );

  return {
    conversationId,
    ciphertext,
    iv: ivB64,
    signature: toBase64(sigBuf),
  };
}

export async function decryptAndVerifyMessage(params: {
  id: string;
  conversationId: string;
  fromId: string;
  toId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  myEcdhPrivateKey: CryptoKey;
  peerEcdhPublicJwk: JsonWebKey;
  senderEcdsaPublicJwk: JsonWebKey;
}): Promise<{
  text: string;
  replyTo?: ReplyReference;
  verified: boolean;
  error?: boolean;
}> {
  try {
    const aesKey = await deriveConversationAesKey(
      params.myEcdhPrivateKey,
      params.peerEcdhPublicJwk,
      params.conversationId
    );

    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(params.iv) },
      aesKey,
      fromBase64(params.ciphertext)
    );

    const parsed = JSON.parse(utf8Decode(plainBuf)) as {
      text: string;
      replyTo?: unknown;
    };

    let verified = false;
    try {
      const senderPubKey = await window.crypto.subtle.importKey(
        'jwk',
        params.senderEcdsaPublicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      const signTranscript = `${params.id}|${params.fromId}|${params.toId}|${params.iv}|${params.ciphertext}|${params.timestamp}`;
      verified = await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        senderPubKey,
        fromBase64(params.signature),
        utf8Encode(signTranscript)
      );
    } catch {
      verified = false;
    }

    return {
      text: parsed.text,
      replyTo: sanitizeReplyReference(parsed.replyTo),
      verified,
    };
  } catch {
    return {
      text: 'Message illisible (clé ou intégrité invalide)',
      verified: false,
      error: true,
    };
  }
}

// ============================================================================
// End-to-End Encrypted Group Messaging Primitives
// ============================================================================

export function generateGroupKeyBytes(): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(32);
  const bytes = new Uint8Array(buf);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

export async function wrapGroupKeyForMember(params: {
  rawGroupKey: Uint8Array<ArrayBuffer>;
  myEcdhPrivateKey: CryptoKey;
  memberEcdhPublicJwk: JsonWebKey;
  myUserId: string;
  memberUserId: string;
}): Promise<{ iv: string; wrappedKey: string; wrappedByUserId: string }> {
  const convContext = `group-wrap:${getCanonicalConversationId(
    params.myUserId,
    params.memberUserId
  )}`;
  const wrapAesKey = await deriveConversationAesKey(
    params.myEcdhPrivateKey,
    params.memberEcdhPublicJwk,
    convContext
  );

  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  window.crypto.getRandomValues(iv);

  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrapAesKey,
    params.rawGroupKey
  );

  return {
    iv: toBase64(iv),
    wrappedKey: toBase64(cipherBuf),
    wrappedByUserId: params.myUserId,
  };
}

export async function unwrapGroupKeyBytes(params: {
  myEcdhPrivateKey: CryptoKey;
  wrapperEcdhPublicJwk: JsonWebKey;
  myUserId: string;
  wrappedByUserId: string;
  iv: string;
  wrappedKey: string;
}): Promise<Uint8Array<ArrayBuffer>> {
  const convContext = `group-wrap:${getCanonicalConversationId(
    params.myUserId,
    params.wrappedByUserId
  )}`;
  const wrapAesKey = await deriveConversationAesKey(
    params.myEcdhPrivateKey,
    params.wrapperEcdhPublicJwk,
    convContext
  );

  const plainBuf = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(params.iv) },
    wrapAesKey,
    fromBase64(params.wrappedKey)
  );

  const out = new Uint8Array(new ArrayBuffer(plainBuf.byteLength));
  out.set(new Uint8Array(plainBuf));
  return out;
}

export async function importGroupAesKey(
  rawGroupKey: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'raw',
    rawGroupKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAndSignGroupMessage(params: {
  id: string;
  groupId: string;
  fromId: string;
  plaintext: string;
  replyTo?: ReplyReference;
  timestamp: number;
  groupAesKey: CryptoKey;
  myEcdsaPrivateKey: CryptoKey;
}): Promise<{ ciphertext: string; iv: string; signature: string }> {
  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  window.crypto.getRandomValues(iv);

  const replyTo = sanitizeReplyReference(params.replyTo);
  const payload = JSON.stringify({
    text: params.plaintext,
    ...(replyTo ? { replyTo } : {}),
    v: replyTo ? 2 : 1,
    ts: params.timestamp,
  });

  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    params.groupAesKey,
    utf8Encode(payload)
  );

  const ciphertext = toBase64(cipherBuf);
  const ivB64 = toBase64(iv);

  const signTranscript = `${params.id}|group|${params.groupId}|${params.fromId}|${ivB64}|${ciphertext}|${params.timestamp}`;
  const sigBuf = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    params.myEcdsaPrivateKey,
    utf8Encode(signTranscript)
  );

  return {
    ciphertext,
    iv: ivB64,
    signature: toBase64(sigBuf),
  };
}

export async function decryptAndVerifyGroupMessage(params: {
  id: string;
  groupId: string;
  fromId: string;
  ciphertext: string;
  iv: string;
  signature: string;
  timestamp: number;
  groupAesKey: CryptoKey;
  senderEcdsaPublicJwk?: JsonWebKey;
}): Promise<{
  text: string;
  replyTo?: ReplyReference;
  verified: boolean;
  error?: boolean;
}> {
  try {
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(params.iv) },
      params.groupAesKey,
      fromBase64(params.ciphertext)
    );

    const parsed = JSON.parse(utf8Decode(plainBuf)) as {
      text: string;
      replyTo?: unknown;
    };

    let verified = false;
    if (params.senderEcdsaPublicJwk) {
      try {
        const senderPubKey = await window.crypto.subtle.importKey(
          'jwk',
          params.senderEcdsaPublicJwk,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify']
        );
        const signTranscript = `${params.id}|group|${params.groupId}|${params.fromId}|${params.iv}|${params.ciphertext}|${params.timestamp}`;
        verified = await window.crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          senderPubKey,
          fromBase64(params.signature),
          utf8Encode(signTranscript)
        );
      } catch {
        verified = false;
      }
    }

    return {
      text: parsed.text,
      replyTo: sanitizeReplyReference(parsed.replyTo),
      verified,
    };
  } catch {
    return {
      text: 'Message de groupe illisible',
      verified: false,
      error: true,
    };
  }
}

