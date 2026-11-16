import type { PublicUser } from '../types';

const SESSION_STORAGE_KEY = 'discret_session_v1';
const LEGACY_SESSION_KEY = 'discret_tab_session_v1';
const IDB_NAME = 'discret_secure_keystore_v1';
const IDB_STORE = 'keys';
const WRAP_KEY_ID = 'session_wrap_key_v1';

export interface PersistedSession {
  token: string;
  user: PublicUser;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}

interface EncryptedSessionEnvelope {
  v: 2;
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
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

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}

async function getStoredWrapKey(): Promise<CryptoKey | null> {
  const db = await openKeyDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(WRAP_KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function putStoredWrapKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(key, WRAP_KEY_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function deleteStoredWrapKey(): Promise<void> {
  try {
    const db = await openKeyDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.delete(WRAP_KEY_ID);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore IndexedDB cleanup errors
  }
}

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await getStoredWrapKey();
  if (existing) return existing;

  // Non-extractable AES-256-GCM key bound to browser origin IndexedDB
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await putStoredWrapKey(key);
  return key;
}

export async function writeEncryptedLocalSession(
  payload: PersistedSession
): Promise<void> {
  try {
    const wrapKey = await getOrCreateWrapKey();
    const iv = new Uint8Array(new ArrayBuffer(12));
    window.crypto.getRandomValues(iv);

    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const plainBuf = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(plainBuf).set(encoded);

    const cipherBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrapKey,
      plainBuf
    );

    const envelope: EncryptedSessionEnvelope = {
      v: 2,
      iv: toBase64(iv),
      ciphertext: toBase64(cipherBuf),
    };
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // If WebCrypto/IndexedDB fails in restricted mode, skip persistent local cache safely
  }
}

export async function readEncryptedLocalSession(): Promise<PersistedSession | null> {
  try {
    let raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      const legacy =
        window.sessionStorage.getItem(LEGACY_SESSION_KEY) ||
        window.sessionStorage.getItem('voile_tab_session_v1');
      if (legacy) {
        raw = legacy;
        window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
        window.sessionStorage.removeItem('voile_tab_session_v1');
      }
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw) as
      | EncryptedSessionEnvelope
      | PersistedSession;

    if (
      parsed &&
      typeof parsed === 'object' &&
      'v' in parsed &&
      parsed.v === 2 &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ciphertext === 'string'
    ) {
      const wrapKey = await getStoredWrapKey();
      if (!wrapKey) return null;

      const plainBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(parsed.iv) },
        wrapKey,
        fromBase64(parsed.ciphertext)
      );
      const decrypted = JSON.parse(
        new TextDecoder().decode(plainBuf)
      ) as PersistedSession;
      return decrypted?.user?.id ? decrypted : null;
    }

    // Legacy plaintext session migration -> immediately re-encrypt with non-extractable key
    const legacyParsed = parsed as PersistedSession;
    if (legacyParsed?.user?.id && legacyParsed.ecdhPrivateJwk && legacyParsed.ecdsaPrivateJwk) {
      await writeEncryptedLocalSession(legacyParsed);
      return legacyParsed;
    }
  } catch {
    // Corrupted or invalid local session
  }
  return null;
}

export async function clearEncryptedLocalSession(): Promise<void> {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
    window.sessionStorage.removeItem('voile_tab_session_v1');
  } catch {
    // Ignore storage errors
  }
  await deleteStoredWrapKey();
}
