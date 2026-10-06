# ApplyPilot Cloud: mobile website + encrypted sync

The ApplyPilot website (`web/`) is a **mobile-first PWA**. People use it from their phone when their laptop isn't around: search jobs, review matches, apply from the phone with a quick-fill sheet, or **send jobs to the desktop app**, which fills them in when it's next online. Data syncs between devices through an **end-to-end encrypted (zero-knowledge) vault**.

## Security model (strict by design)

| Layer | Mechanism |
|---|---|
| Identity | **Google Sign-In** (Google Identity Services). The server verifies the Google **ID token** with `google-auth-library` (signature, `aud` = our client ID, `iss`, `exp`, `email_verified`). No Google passwords or refresh tokens are ever handled or stored. |
| Data confidentiality | **Zero-knowledge**: every user record is encrypted on the device with **AES-256-GCM** under a random 256-bit data key (DEK). The DEK is wrapped by a key derived from the user's **vault passphrase** (PBKDF2-SHA256, 600,000 iterations, 16-byte salt) and separately by a 160-bit **recovery key** (HKDF-SHA256). The server stores only ciphertext and wrapped keys; it cannot read profiles, resumes, applications, answers or API keys. A full database leak exposes no user content. |
| Integrity | GCM authentication tags, plus **AAD binding** `ap:v1:<userId>:<collection>:<id>` on every record, so the server can't swap or move ciphertexts undetected. |
| Key handling | The DEK stays in memory as a **non-extractable** WebCrypto key. It is never written to localStorage or IndexedDB. The vault auto-locks after 15 min idle and on logout. Passphrases need ≥ 12 characters and trivial ones are rejected. The recovery key is shown once and never stored. |
| Sessions | 256-bit random token in a `__Host-ap_session` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`). Only its **SHA-256 hash** is stored server-side. 30-day sliding expiry; revocable; logout and "sign out everywhere". |
| CSRF | Double-submit token: a readable `ap_csrf` cookie must equal the `X-CSRF-Token` header on every non-GET request, with an `Origin` check against `APP_ORIGIN`. |
| Devices | Desktop apps get a **device token** (256-bit, only the SHA-256 hash is stored) by redeeming a one-time 8-character link code (10 min TTL, single use, rate-limited). They're listed under Devices and revocable. |
| Transport & browser | HTTPS only in production: HSTS (2 years, preload), strict **CSP** (Google Identity + Anthropic only), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `frame-ancestors 'none'`, `COOP: same-origin-allow-popups` (needed by the Google popup). |
| Abuse | Rate limits per IP and per user on auth, link codes, job search and writes. Body size limits (records ≤ 256 KB, blobs ≤ 6 MB, 60 MB quota per user). |
| Logging | Request logs contain method, path, status and duration only: no bodies, tokens, emails or IPs beyond rate limiting. |
| AI | AI calls go **directly from the user's device to Anthropic** with the user's own key, which is stored inside the encrypted vault. The server never sees prompts or keys. |
| Account | Export (all ciphertext plus the vault document) and **delete account** (hard-deletes all rows and blobs immediately). |

Trade-off, stated openly to users: if they lose **both** the passphrase and the recovery key, their data cannot be recovered by anyone, including us. That's the price of zero-knowledge.

What the server *can* see: the Google account email, name and picture; record counts, sizes and timestamps; and job **search queries** (searches run server-side against public job APIs). Job search uses no personal data. Match scoring runs on the device.

## Shared crypto: `web/shared/vaultCrypto.js`

An ESM module built on WebCrypto. It runs in browsers, Node and the desktop app. Tests: `node --test web/shared/vaultCrypto.test.mjs`.

```
createVault(passphrase) → { vault, dek, recoveryKey }      // upload `vault`, show recoveryKey once
unlockVault(vault, passphrase, {extractable?}) → dek        // throws 'Wrong passphrase'
unlockWithRecovery(vault, recoveryKey) → dek
rewrapVault(vault, {passphrase}|{recoveryKey}, newPassphrase, {newRecoveryKey?}) → { vault, recoveryKey }
encryptJSON(dek, value, aad) → "v1.<iv>.<ct>"   decryptJSON(dek, payload, aad)
encryptBytes(dek, Uint8Array, aad) → Uint8Array  decryptBytes(dek, blob, aad)
aadFor(userId, collection, id)   newId()   toB64u/fromB64u   assertPassphraseStrength(p)
```

## HTTP API (`/api`, JSON unless noted)

Authentication is either the session cookie (web) or `Authorization: Bearer <deviceToken>` (desktop). Errors return `{ "error": "<message>" }` with the appropriate status. All non-GET cookie-authenticated requests require `X-CSRF-Token`.

| Method & path | Auth | Body → Response |
|---|---|---|
| `GET /api/health` | none | → `{ ok: true, version }` |
| `GET /api/config` | none | → `{ googleClientId, devLogin: bool, version }` |
| `POST /api/auth/google` | none | `{ credential }` (Google ID token) → `{ user }` + sets cookies |
| `POST /api/auth/dev` | none, **only if `AP_DEV_LOGIN=1` and `NODE_ENV!=='production'`** | `{ email }` → `{ user }` + cookies |
| `POST /api/auth/logout` | session | → `{ ok }` (revokes this session) |
| `POST /api/auth/logout-all` | session | → `{ ok }` (revokes all sessions and devices) |
| `GET /api/me` | any | → `{ user: { id, email, name, picture }, hasVault: bool, device?: { id, name } }` |
| `GET /api/vault` | any | → `{ vault, version }` or 404 |
| `PUT /api/vault` | session | `{ vault, baseVersion }` (null to create) → `{ version }`; 409 on version mismatch |
| `GET /api/items?since=<ms>&collection=<c>` | any | → `{ items: [{ collection, id, ciphertext, version, updatedAt, deleted }], now }` |
| `PUT /api/items/:collection/:id` | any | `{ ciphertext, baseVersion }` (null for new) → `{ version, updatedAt }`; 409 `{ current }` on conflict |
| `DELETE /api/items/:collection/:id` | any | → `{ version }` (tombstone, ciphertext removed) |
| `PUT /api/blobs/:id` | any | raw bytes (`application/octet-stream`, already encrypted) → `{ size }` |
| `GET /api/blobs/:id` | any | → raw bytes |
| `DELETE /api/blobs/:id` | any | → `{ ok }` |
| `GET /api/jobs/search?q=&location=&remote=any\|remote\|onsite&sources=` | any | → `{ jobs: [...normalized Job], stats }`. Public data only, 15-min cache per query, rate-limited |
| `GET /api/jobs/platforms` | none | → the 252-platform directory |
| `POST /api/devices/link-code` | session | → `{ code, expiresAt }` |
| `POST /api/devices/redeem` | none | `{ code, name }` → `{ deviceToken, user }` |
| `GET /api/devices` | session | → `{ devices: [{ id, name, createdAt, lastSeenAt }] }` |
| `DELETE /api/devices/:id` | session | → `{ ok }` |
| `GET /api/account/export` | session | → `{ vault, items, blobs: [ids] }` |
| `DELETE /api/account` | session | `{ confirm: "DELETE" }` → `{ ok }` (hard delete) |

`collection` and `id` must match `^[a-zA-Z0-9_-]{1,64}$`.

### Collections (all encrypted; AAD = `aadFor(userId, collection, id)`)

| Collection | id | Plaintext shape |
|---|---|---|
| `profile` | `main` | `{ values }`: same keys as `electron/data/profile-schema.json` |
| `resumes` | resume id | `{ id, name, fileName, ext, size, text, skills, roles, isDefault, blobId, createdAt }`. File bytes live in a blob (`encryptBytes`, AAD `aadFor(userId,'blob',blobId)`) |
| `applications` | application id | the desktop application object (`job` snapshot, status, notes, events, resumeId, score…) |
| `qa` | qa id | `{ id, question, answer, source, uses, updatedAt }` |
| `settings` | `main` | `{ anthropicKey, aiModel, preferences }`, synced secrets (still E2E encrypted) |
| `outbox` | random id | `{ jobId, job, resumeId, mode: 'review'\|'auto', createdAt, from: 'web' }`. Jobs sent from the phone to the desktop; the desktop deletes them once picked up |
| `savedJobs` | job id | normalized Job plus match result |

Conflict policy: last-writer-wins per record with optimistic versions (409 → client refetches, merges where obvious, retries).

## Desktop ↔ web sync (implemented in `electron/cloudSync.js`)

1. On the web: **Settings → Devices → Link desktop app** shows an 8-character code.
2. In the desktop app: **Settings → Phone & web** → enter the server URL, the code, and the vault passphrase.
3. The desktop stores the device token and the DEK, both encrypted with Windows DPAPI (`safeStorage`). It then syncs every 60 s while online:
   - It pushes profile, resumes (with encrypted files), applications and Q&A.
   - It pulls `outbox` items and turns them into queued applications. Their mode decides what happens next: review (fill, user submits) or autopilot (allow-listed ATSs only).
4. The desktop never needs the passphrase again unless the link is revoked. Revoking the device on the website makes the desktop unlink itself on its next sync.
5. Conflicts:
   - Desktop-owned records (resumes, applications) win on push.
   - Profile and Q&A use the newest `_updatedAt`.
   - Phone-made status changes to applications are merged in.
   - A record that fails decryption (tampered or corrupted) is skipped, never applied.

Verified end-to-end by `scripts/cloud-sync.e2e.js`, which includes searching the server's SQLite file (and WAL) for the test user's name, email, phone number, skills and answers; none were found.

## Deployment

- One Node 24 process serves the built PWA and the API. SQLite (`node:sqlite`) sits on a persistent volume. Dockerfile and Render/Fly configs live in `web/`.
- Env vars:
  - `GOOGLE_CLIENT_ID` (Google Cloud Console → Credentials → OAuth client ID → Web application; add `APP_ORIGIN` as an authorized JavaScript origin)
  - `APP_ORIGIN` (e.g. `https://app.applypilot.app`)
  - `DATABASE_PATH`
  - `NODE_ENV=production`
- Local dev: `cd web && npm install && npm run dev`, with `AP_DEV_LOGIN=1` to use email-only dev login without a Google client ID.
