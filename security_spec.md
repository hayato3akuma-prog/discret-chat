# DISCRET Security Rules Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Verified / Zero-Knowledge Vault Identity**: Every Firestore read/write requires `request.auth != null` and either `request.auth.token.email_verified == true` or a cryptographic key-derived vault identity matching `^[a-f0-9]{40}@vault\.discret\.app$` (`firebase.sign_in_provider == 'password'`). No real email or Google identity is required or stored.
2. **Owner-Only Vault Isolation**: `/users/{userId}` contains `encryptedVault`, `vaultSalt`, `vaultIv`, and `lookupId`. Only `request.auth.uid == userId` may `get`, `list`, `create`, or `update` it.
3. **No Blanket Collection Listing**: No collection permits `allow list: if isSignedIn();`. Every `allow list` validates `resource.data` against `request.auth.uid`, or explicitly sets `allow list: if false;` (`/handleIndex`, `/searchBuckets`).
4. **Master Gate on Subcollections**: `/conversations/{convId}/messages/{messageId}`, `/groups/{groupId}/members/{memberId}`, and `/groups/{groupId}/messages/{messageId}` gate access via parent document membership (`get()` / `exists()`) and enforce `fromId == request.auth.uid` on message creation.
5. **Block Enforcement**: Direct messages, friend requests, friendships, and group member additions are rejected if a `/blocks/{a__b}` document exists in either direction.
6. **Temporal & Schema Integrity**: Every document enforces strict `hasAll` + `hasOnly` key checks, explicit `.size()` bounds on strings/arrays, ID regex `^[a-zA-Z0-9_\-]+$`, immutable `createdAt`/`ownerUid`/`creatorId`, and `request.time` server timestamps.
7. **Founder-Only Group Deletion**: Only `existing().creatorId == request.auth.uid` can delete `/groups/{groupId}`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Shadow Field Injection on PublicProfile Create**: `{ ..., isAdmin: true }` -> Rejected by `hasOnly(...)` inside `isValidPublicProfile()`.
2. **Identity Spoofing on DirectMessage Create**: `{ fromId: "other-uid", toId: "me", ... }` -> Rejected by `incoming().fromId == request.auth.uid`.
3. **Cross-User Vault Read**: Authenticated user B calls `getDoc(doc(db, 'users', 'userA'))` -> Rejected by `isOwner(userId)`.
4. **Blanket User List Scraping**: Authenticated user runs `getDocs(collection(db, 'publicProfiles'))` -> Rejected by `allow list` requiring `existing().ownerUid == request.auth.uid`.
5. **ID Poisoning (Oversized Path Variable)**: Creating `/groups/{1500-char-id}` -> Rejected by `isValidId(groupId)` (`id.size() <= 128`).
6. **Unbounded Array / Payload Exhaustion**: Creating `/groups/{id}` with `memberIds` of 26+ UIDs or 300KB banner -> Rejected by `data.memberIds.size() <= 25` and `bannerDataUrl.size() <= 260000`.
7. **Client Timestamp Forgery**: Creating `/friendRequests/{id}` with `createdAt: new Date(0)` instead of `serverTimestamp()` -> Rejected by `incoming().createdAt == request.time`.
8. **Immortal Field Mutation**: Updating `/groups/{id}` attempting to change `creatorId` or `createdAt` -> Rejected by `incoming().creatorId == existing().creatorId && incoming().createdAt == existing().createdAt`.
9. **Unauthorized Friend Force-Add**: Creating `/friendships/{a__b}` without a matching `/friendRequests/{other__me}` -> Rejected by `exists(/databases/$(database)/documents/friendRequests/...)`.
10. **DM While Blocked**: Creating `/conversations/{convId}/messages/{msgId}` when `/blocks/{recipient__sender}` exists -> Rejected by `!isBlockedPair(...)`.
11. **Non-Founder Group Deletion**: Group member (not `creatorId`) calls `deleteDoc(doc(db, 'groups', groupId))` -> Rejected by `existing().creatorId == request.auth.uid`.
12. **Recipient Read-Receipt Tampering**: Recipient updates `ciphertext` alongside `readAt` on a DM -> Rejected by `affectedKeys().hasOnly(['readAt'])` and immutability checks.
