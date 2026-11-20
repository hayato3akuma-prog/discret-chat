import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import * as webpush from 'web-push';
import { WebSocket, WebSocketServer } from 'ws';

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

interface PushDiskState {
  pushSubscriptions: Record<string, StoredPushSubscription[]>;
  vapidKeys?: VapidKeyPair;
}

interface GoogleJwk extends crypto.JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
}

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const PUSH_STORE_FILE = path.join(DATA_DIR, 'push-store.json');
const LEGACY_VAULT_FILE = path.join(DATA_DIR, 'vault.json');
const FIREBASE_CONFIG_FILE = path.resolve(process.cwd(), 'firebase-applet-config.json');

function resolveFirebaseProjectId(): string {
  const envId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (envId) return envId;
  try {
    const raw = fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
      return parsed.projectId.trim();
    }
  } catch (err) {
    console.error('Unable to read firebase-applet-config.json:', err);
  }
  return '';
}

const FIREBASE_PROJECT_ID = resolveFirebaseProjectId();
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: Map<string, crypto.KeyObject> = new Map();
let cachedJwksExpiresAt = 0;

async function getGooglePublicKey(
  kid: string,
  forceRefresh = false
): Promise<crypto.KeyObject | null> {
  const now = Date.now();
  if (!forceRefresh && now < cachedJwksExpiresAt && cachedJwks.has(kid)) {
    return cachedJwks.get(kid) ?? null;
  }

  try {
    const res = await fetch(GOOGLE_JWKS_URL);
    if (!res.ok) return cachedJwks.get(kid) ?? null;

    const cacheControl = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? Math.max(Number(maxAgeMatch[1]), 60) : 3600;

    const body = (await res.json()) as { keys?: GoogleJwk[] };
    const nextMap = new Map<string, crypto.KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (typeof jwk.kid === 'string') {
        try {
          const keyObj = crypto.createPublicKey({
            key: jwk,
            format: 'jwk',
          });
          nextMap.set(jwk.kid, keyObj);
        } catch {
          // Skip invalid JWK entry
        }
      }
    }

    if (nextMap.size > 0) {
      cachedJwks = nextMap;
      cachedJwksExpiresAt = now + maxAgeSec * 1000;
    }
  } catch (err) {
    console.error('Failed to refresh Google Firebase JWKS:', err);
  }

  return cachedJwks.get(kid) ?? null;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const jsonStr = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(
  token: string
): Promise<VerifiedFirebaseToken | null> {
  if (!FIREBASE_PROJECT_ID || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    name?: string;
  }>(payloadB64);

  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    return null;
  }
  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 30) {
    return null;
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 60) {
    return null;
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 60) {
    return null;
  }

  let publicKey = await getGooglePublicKey(header.kid, false);
  if (!publicKey) {
    publicKey = await getGooglePublicKey(header.kid, true);
  }
  if (!publicKey) return null;

  try {
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const signature = Buffer.from(sigB64, 'base64url');
    const verified = crypto.verify('sha256', signingInput, publicKey, signature);
    if (!verified) return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

function loadPushState(): PushDiskState {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const sourceFile = fs.existsSync(PUSH_STORE_FILE)
      ? PUSH_STORE_FILE
      : fs.existsSync(LEGACY_VAULT_FILE)
        ? LEGACY_VAULT_FILE
        : null;

    if (!sourceFile) {
      return { pushSubscriptions: {} };
    }

    const raw = fs.readFileSync(sourceFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PushDiskState>;
    return {
      pushSubscriptions:
        parsed.pushSubscriptions && typeof parsed.pushSubscriptions === 'object'
          ? parsed.pushSubscriptions
          : {},
      vapidKeys:
        parsed.vapidKeys &&
        typeof parsed.vapidKeys.publicKey === 'string' &&
        typeof parsed.vapidKeys.privateKey === 'string'
          ? parsed.vapidKeys
          : undefined,
    };
  } catch (err) {
    console.error('Failed to load push store, initializing empty store:', err);
    return { pushSubscriptions: {} };
  }
}

const pushState: PushDiskState = loadPushState();
const activeSockets = new Map<string, Set<WebSocket>>();

interface PendingCallInvite {
  callId: string;
  fromId: string;
  toId: string;
  caller: Record<string, unknown>;
  callType: 'audio' | 'video';
  sdp: unknown;
  iceCandidates: unknown[];
  createdAt: number;
}

const CALL_INVITE_TTL_MS = 45_000;
const pendingCallInvites = new Map<string, PendingCallInvite[]>();

function prunePendingCallsForUser(userId: string) {
  const now = Date.now();
  const list = pendingCallInvites.get(userId);
  if (!list) return;
  const valid = list.filter((c) => now - c.createdAt < CALL_INVITE_TTL_MS);
  if (valid.length === 0) {
    pendingCallInvites.delete(userId);
  } else {
    pendingCallInvites.set(userId, valid);
  }
}

function removePendingCall(userId: string, callId: string) {
  const list = pendingCallInvites.get(userId);
  if (!list) return;
  const next = list.filter((c) => c.callId !== callId);
  if (next.length === 0) {
    pendingCallInvites.delete(userId);
  } else {
    pendingCallInvites.set(userId, next);
  }
}

let writeTimer: NodeJS.Timeout | null = null;
function schedulePersistPushState() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${PUSH_STORE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(pushState), 'utf8');
      fs.renameSync(tmpFile, PUSH_STORE_FILE);
    } catch (err) {
      console.error('Failed to persist push store:', err);
    }
  }, 150);
}

function resolveVapidKeys(): VapidKeyPair {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }
  if (pushState.vapidKeys?.publicKey && pushState.vapidKeys?.privateKey) {
    return pushState.vapidKeys;
  }
  const generated = webpush.generateVAPIDKeys();
  pushState.vapidKeys = generated;
  schedulePersistPushState();
  return generated;
}

const vapidKeys = resolveVapidKeys();
const vapidSubject =
  process.env.VAPID_SUBJECT?.trim() || 'mailto:security@discret.app';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

function hasOpenSocket(userId: string): boolean {
  const sockets = activeSockets.get(userId);
  if (!sockets) return false;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function sendToUser(userId: string, payload: unknown): number {
  const sockets = activeSockets.get(userId);
  if (!sockets) return 0;
  const serialized = JSON.stringify(payload);
  let delivered = 0;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
      delivered += 1;
    }
  }
  return delivered;
}

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
  const subs = pushState.pushSubscriptions[userId];
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
    pushState.pushSubscriptions[userId] = subs.filter(
      (s) => !invalidEndpoints.has(s.endpoint)
    );
    schedulePersistPushState();
  }

  return { sent, failed, removed: invalidEndpoints.size };
}

function sanitizeCallerProfile(
  rawCaller: unknown,
  authenticatedUid: string
): Record<string, unknown> {
  if (!rawCaller || typeof rawCaller !== 'object') {
    return {
      id: authenticatedUid,
      handle: '@discret',
      displayName: 'Contact DISCRET',
    };
  }
  const c = rawCaller as Record<string, unknown>;
  return {
    ...c,
    id: authenticatedUid,
    displayName:
      typeof c.displayName === 'string' && c.displayName.trim()
        ? c.displayName.trim().slice(0, 32)
        : 'Contact DISCRET',
    handle: typeof c.handle === 'string' ? c.handle.slice(0, 40) : '@discret',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  type AuthedRequest = express.Request & { authUid: string };

  async function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Jeton Firebase manquant.' });
      return;
    }
    const token = authHeader.slice(7).trim();
    const verified = await verifyFirebaseIdToken(token);
    if (!verified) {
      res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
      return;
    }
    (req as AuthedRequest).authUid = verified.uid;
    next();
  }

  // ============================================================================
  // Web Push Notifications API (VAPID, Stateless Auth via Firebase ID Token)
  // ============================================================================

  app.get('/api/push/vapid-public-key', requireAuth, (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.get('/api/push/status', requireAuth, (req, res) => {
    const uid = (req as AuthedRequest).authUid;
    const subs = pushState.pushSubscriptions[uid] ?? [];
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
    const uid = (req as AuthedRequest).authUid;
    const { subscription, discreetMode } = req.body ?? {};
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const authKey = subscription?.keys?.auth;

    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      typeof p256dh !== 'string' ||
      typeof authKey !== 'string'
    ) {
      res.status(400).json({ error: 'Abonnement Web Push invalide.' });
      return;
    }

    if (!pushState.pushSubscriptions[uid]) {
      pushState.pushSubscriptions[uid] = [];
    }

    const now = Date.now();
    const existingIdx = pushState.pushSubscriptions[uid].findIndex(
      (s) => s.endpoint === endpoint
    );

    const record: StoredPushSubscription = {
      endpoint,
      expirationTime:
        typeof subscription.expirationTime === 'number'
          ? subscription.expirationTime
          : null,
      keys: { p256dh, auth: authKey },
      discreetMode:
        typeof discreetMode === 'boolean'
          ? discreetMode
          : existingIdx >= 0
            ? Boolean(pushState.pushSubscriptions[uid][existingIdx].discreetMode)
            : false,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 180)
          : undefined,
      createdAt:
        existingIdx >= 0
          ? pushState.pushSubscriptions[uid][existingIdx].createdAt
          : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      pushState.pushSubscriptions[uid][existingIdx] = record;
    } else {
      pushState.pushSubscriptions[uid].push(record);
    }

    schedulePersistPushState();
    res.json({
      ok: true,
      count: pushState.pushSubscriptions[uid].length,
      discreetMode: Boolean(record.discreetMode),
    });
  });

  app.patch('/api/push/preferences', requireAuth, (req, res) => {
    const uid = (req as AuthedRequest).authUid;
    const { endpoint, discreetMode } = req.body ?? {};
    if (typeof discreetMode !== 'boolean') {
      res.status(400).json({ error: 'Préférence invalide.' });
      return;
    }

    const subs = pushState.pushSubscriptions[uid] ?? [];
    for (const sub of subs) {
      if (!endpoint || sub.endpoint === endpoint) {
        sub.discreetMode = discreetMode;
        sub.updatedAt = Date.now();
      }
    }
    schedulePersistPushState();
    res.json({ ok: true, discreetMode });
  });

  app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    const uid = (req as AuthedRequest).authUid;
    const { endpoint } = req.body ?? {};
    const subs = pushState.pushSubscriptions[uid] ?? [];
    if (typeof endpoint === 'string' && endpoint.length > 0) {
      pushState.pushSubscriptions[uid] = subs.filter(
        (s) => s.endpoint !== endpoint
      );
    } else {
      pushState.pushSubscriptions[uid] = [];
    }
    schedulePersistPushState();
    res.json({ ok: true, count: pushState.pushSubscriptions[uid].length });
  });

  app.post('/api/push/test', requireAuth, async (req, res) => {
    const uid = (req as AuthedRequest).authUid;
    const result = await sendPushToUser(uid, {
      title: 'HOI • Test Push Service Worker',
      body: 'Les notifications push en arrière-plan sont actives sur cet appareil.',
      discreetTitle: 'HOI',
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

  app.post('/api/push/dispatch', requireAuth, async (req, res) => {
    const senderUid = (req as AuthedRequest).authUid;
    const {
      targetUserIds,
      title,
      body,
      discreetTitle,
      discreetBody,
      tag,
      data,
    } = req.body ?? {};

    if (!Array.isArray(targetUserIds) || typeof title !== 'string' || typeof body !== 'string') {
      res.status(400).json({ error: 'Paramètres de notification invalides.' });
      return;
    }

    const targets = Array.from(
      new Set(
        targetUserIds.filter(
          (id): id is string =>
            typeof id === 'string' && id.length > 0 && id !== senderUid
        )
      )
    ).slice(0, 25);

    const results = await Promise.all(
      targets.map((targetId) =>
        sendPushToUser(targetId, {
          title: title.slice(0, 120),
          body: body.slice(0, 240),
          discreetTitle:
            typeof discreetTitle === 'string' ? discreetTitle.slice(0, 80) : 'HOI',
          discreetBody:
            typeof discreetBody === 'string'
              ? discreetBody.slice(0, 160)
              : 'Nouvelle activité chiffrée reçue.',
          tag: typeof tag === 'string' ? tag.slice(0, 80) : `discret-${Date.now()}`,
          data: data && typeof data === 'object' ? (data as Record<string, unknown>) : { url: '/' },
        })
      )
    );

    const summary = results.reduce(
      (acc, cur) => ({
        sent: acc.sent + cur.sent,
        failed: acc.failed + cur.failed,
        removed: acc.removed + cur.removed,
      }),
      { sent: 0, failed: 0, removed: 0 }
    );

    res.json({ ok: true, ...summary });
  });

  const server = http.createServer(app);

  // Real-time WebSocket Signaling Server (WebRTC Calls & Typing Indicators)
  const wss = new WebSocketServer({ noServer: true });
  const wsAliveMap = new WeakMap<WebSocket, boolean>();

  const wsHeartbeat = setInterval(() => {
    for (const [, sockets] of activeSockets.entries()) {
      for (const ws of sockets) {
        if (wsAliveMap.get(ws) === false) {
          ws.terminate();
          continue;
        }
        wsAliveMap.set(ws, false);
        try {
          ws.ping();
        } catch {
          // Ignore ping error
        }
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(wsHeartbeat);
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    void verifyFirebaseIdToken(token).then((verified) => {
      if (!verified) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, verified.uid);
      });
    });
  });

  wss.on('connection', (ws: WebSocket, userId: string) => {
    wsAliveMap.set(ws, true);
    ws.on('pong', () => {
      wsAliveMap.set(ws, true);
    });

    let userSockets = activeSockets.get(userId);
    if (!userSockets) {
      userSockets = new Set();
      activeSockets.set(userId, userSockets);
    }
    userSockets.add(ws);

    // Replay any still-valid incoming call invites (e.g. user opened app from push notification)
    prunePendingCallsForUser(userId);
    const queuedCalls = pendingCallInvites.get(userId);
    if (queuedCalls && queuedCalls.length > 0) {
      const latestInvite = queuedCalls[queuedCalls.length - 1];
      try {
        ws.send(
          JSON.stringify({
            type: 'call:invite',
            callId: latestInvite.callId,
            fromId: latestInvite.fromId,
            caller: latestInvite.caller,
            callType: latestInvite.callType,
            sdp: latestInvite.sdp,
          })
        );
        for (const candidate of latestInvite.iceCandidates) {
          ws.send(
            JSON.stringify({
              type: 'call:ice',
              callId: latestInvite.callId,
              fromId: latestInvite.fromId,
              candidate,
            })
          );
        }
      } catch {
        // Ignore replay write error
      }
    }

    ws.on('message', (raw) => {
      wsAliveMap.set(ws, true);
      try {
        const data = JSON.parse(String(raw)) as {
          type?: string;
          toId?: string;
          groupId?: string;
          memberIds?: unknown;
          isTyping?: boolean;
          callId?: string;
          callType?: 'audio' | 'video';
          caller?: unknown;
          sdp?: unknown;
          candidate?: unknown;
          reason?: string;
          audioMuted?: boolean;
          videoEnabled?: boolean;
        };

        if (data.type === 'ws:ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ws:pong' }));
          }
          return;
        }

        if (data.type === 'typing:state') {
          if (typeof data.groupId === 'string' && Array.isArray(data.memberIds)) {
            const members = Array.from(
              new Set(
                data.memberIds.filter(
                  (id): id is string =>
                    typeof id === 'string' && id.length > 0 && id !== userId
                )
              )
            ).slice(0, 30);

            for (const memberId of members) {
              sendToUser(memberId, {
                type: 'typing:state',
                fromId: userId,
                groupId: data.groupId,
                isTyping: Boolean(data.isTyping),
              });
            }
          } else if (typeof data.toId === 'string' && data.toId !== userId) {
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

          const callType = data.callType === 'video' ? 'video' : 'audio';
          const caller = sanitizeCallerProfile(data.caller, userId);
          const callerName =
            typeof caller.displayName === 'string'
              ? caller.displayName
              : 'Contact HOI';

          prunePendingCallsForUser(data.toId);
          const pendingList = pendingCallInvites.get(data.toId) ?? [];
          pendingList.push({
            callId: data.callId,
            fromId: userId,
            toId: data.toId,
            caller,
            callType,
            sdp: data.sdp,
            iceCandidates: [],
            createdAt: Date.now(),
          });
          pendingCallInvites.set(data.toId, pendingList.slice(-3));

          const peerOnline = hasOpenSocket(data.toId);
          sendToUser(data.toId, {
            type: 'call:invite',
            callId: data.callId,
            fromId: userId,
            caller,
            callType,
            sdp: data.sdp,
          });

          void sendPushToUser(data.toId, {
            title:
              callType === 'video'
                ? `Appel vidéo entrant • ${callerName}`
                : `Appel audio entrant • ${callerName}`,
            body: 'Ouvrez HOI pour répondre en temps réel.',
            discreetTitle: 'HOI',
            discreetBody: 'Appel chiffré entrant',
            tag: `call-${data.callId}`,
            forceShow: true,
            data: {
              url: `/?open=dm&peerId=${encodeURIComponent(userId)}&callId=${encodeURIComponent(
                data.callId
              )}`,
              type: 'dm',
              peerId: userId,
              callId: data.callId,
            },
          }).then((pushSummary) => {
            if (!peerOnline) {
              sendToUser(userId, {
                type: 'call:queued',
                callId: data.callId,
                pushSent: pushSummary.sent > 0,
              });
            }
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
          if (data.type === 'call:ice' && data.candidate) {
            const list = pendingCallInvites.get(data.toId);
            const targetInvite = list?.find((item) => item.callId === data.callId);
            if (targetInvite && targetInvite.iceCandidates.length < 40) {
              targetInvite.iceCandidates.push(data.candidate);
            }
          }

          if (
            data.type === 'call:accept' ||
            data.type === 'call:decline' ||
            data.type === 'call:hangup'
          ) {
            removePendingCall(data.toId, data.callId);
            removePendingCall(userId, data.callId);
          }

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
    // Self-destructing cleanup Service Worker for browsers that still have an old dev-sw.js active
    app.get('/dev-sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      );
      res.send(
        `self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.includes('workbox')).map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('navigate' in client) {
          client.navigate(client.url).catch(() => {});
        }
      }
    } catch {}
  })());
});`
      );
    });

    app.get('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.json({
        id: '/',
        name: 'HOI',
        short_name: 'HOI',
        description:
          'Messagerie privée chiffrée de bout en bout, sans e-mail et par clé unique.',
        theme_color: '#050507',
        background_color: '#050507',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/hoi-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/hoi-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/hoi-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        lang: 'fr',
      });
    });

    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const devPlugins = [
      {
        name: 'inject-dev-manifest',
        transformIndexHtml(html: string) {
          if (html.includes('rel="manifest"')) return html;
          return html.replace(
            '</head>',
            '    <link rel="manifest" href="/manifest.webmanifest" />\n  </head>'
          );
        },
      },
      ...(hmrDisabled
        ? [
            {
              name: 'disable-hmr-client-ws',
              transform(code: string, id: string) {
                if (id.endsWith('/vite/dist/client/client.mjs')) {
                  return code.replace(
                    /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                    'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });'
                  );
                }
              },
            },
          ]
        : []),
    ];
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: hmrDisabled ? false : { server },
      },
      plugins: devPlugins,
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('sw-push.js')
          ) {
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, max-age=0'
            );
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, max-age=0'
      );
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`HOI signaling & push relay running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
