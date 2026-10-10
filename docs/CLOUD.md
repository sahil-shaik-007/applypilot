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
| Native app sessions | The iOS/Android apps sign in with `{ client: 'native' }` and receive a bearer token `ap_s_<256-bit base64url>` in the body instead of cookies. Only its SHA-256 hash is stored, with the same 30-day sliding expiry as web sessions. It is listed under Devices (`apps`) and Sessions and is revocable there, by logout, or by "sign out everywhere". Session rows carry a `kind` (`web` / `native`), so a native token is **never** accepted from a cookie and a web cookie token is never accepted as a bearer token. Bearer requests are CSRF-exempt. A native sign-in returns its token only in the response body, so it accepts no Origin (native HTTP), a Capacitor origin or `APP_ORIGIN`. Any other browser Origin is refused. |
| Google audiences | `GOOGLE_CLIENT_ID` (web) plus `GOOGLE_CLIENT_IDS` (comma-separated Android/iOS OAuth client IDs) form an exact-match allow-list. Both the library check and our re-check require every `aud` to be in it. |
| CORS | Sent **only** for the Capacitor origins in `APP_NATIVE_ORIGINS` (default `capacitor://localhost, https://localhost, http://localhost`). Exact match, no credentials mode, methods `GET/POST/PUT/DELETE`, headers `Authorization, Content-Type` only (no `X-CSRF-Token`), preflight max-age 600 s. Other origins get no CORS headers (preflight 403). Cookies on requests from app origins are ignored. The web app is same-origin and unchanged. In production you may narrow the list to `capacitor://localhost,https://localhost`. |
| Watchlist (plaintext, opt-in) | See "Cloud watchlist" below. The **only** unencrypted user data: up to 10 normalized queries (role ≤ 200 chars, location ≤ 120, remote filter). It requires `consent: true` on every add. It is stored once per distinct query and shared by subscribers. It is deleted when the last subscriber removes it, on opt-out (`DELETE /api/watchlist`) and on account deletion, and it is included in export. |
| Job history | `job_history` / `job_fingerprints` hold public job ids, a hash of company+title+location, and first/last-seen timestamps and counts. There are **no user ids and no queries**. Rows are purged after 365 days unseen. |
| Push | Notifications carry **no content**: the title is "ApplyPilot" and the body is "N new matches — open ApplyPilot" (Web Push payloads are additionally E2E-encrypted to the browser, RFC 8291). Web Push endpoints must be `https`, default port, on an allow-listed push-service host (`PUSH_ENDPOINT_HOSTS`, an SSRF guard, re-checked at send time; redirects are not followed; 10 s timeout). Endpoints and device tokens are stored (needed to deliver), never logged and never exported. Each target is tied to the session or device that registered it, and is deleted with it, on sign-out everywhere, on account deletion, and on 404/410/unregistered responses. Max 10 targets per user and at most one "new matches" push per user per 30 min. VAPID keys are auto-generated into `<data dir>/vapid.json` (mode 0600, gitignored) if not supplied. FCM/APNs only run when configured. |
| Limits (new endpoints) | 16 KB JSON bodies on `/auth`, `/devices`, `/sessions`, `/watchlist`, `/push`, `/jobs`, `/account`. Per-user rate limits: watchlist writes 60/15 min, history 60/min, push 30/15 min. The scheduler runs one search at a time (≥ 4 s + 0–4 s jitter apart), at most 120 per rolling hour, with a 2 h+ backoff for failing queries. |

Trade-off, stated openly to users: if they lose **both** the passphrase and the recovery key, their data cannot be recovered by anyone, including us. That's the price of zero-knowledge.

What the server *can* see: the Google account email, name and picture; record counts, sizes and timestamps; and job **search queries** (searches run server-side against public job APIs). Job search uses no personal data. Match scoring runs on the device.

If the user opts into the **cloud watchlist**, the server also stores those few queries in plain text, which jobs each query found, and their Web Push endpoint or FCM/APNs device token. It needs these to keep searching and to notify them while their devices are off. The app must show this before enabling it. The server returns the exact wording as `privacy` from `GET /api/watchlist`.

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
| `POST /api/auth/google` (native) | none | `{ credential, client: 'native', platform?: 'ios'\|'android', deviceName? }` → `{ token: 'ap_s_…', user, session: { id, name, platform, expiresAt } }`, **no cookies**. `aud` may be any id in `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_IDS` |
| `POST /api/auth/dev` (native) | dev only | `{ email, client: 'native', platform?, deviceName? }` → same as above |
| `GET /api/me` (native) | bearer `ap_s_` | → `{ user, hasVault, session: { id, name, platform, expiresAt } }` |
| `POST /api/auth/logout` / `logout-all` | session or `ap_s_` bearer | as above; with a bearer token it revokes that token (no cookies touched). Both also delete the push targets of what they revoke |
| `GET /api/devices` | session | now also → `apps: [{ id, name, platform, createdAt, lastSeenAt, current }]` (signed-in phone apps) |
| `DELETE /api/devices/:id` | session | also accepts an app id (revokes that phone's token and its push targets) |
| `GET /api/sessions` | session | → `{ sessions: [{ id, kind: 'web'\|'native', name, platform, createdAt, lastSeenAt, expiresAt, current }] }` |
| `DELETE /api/sessions/:id` | session | → `{ ok }` (revoke any web or app session; 404 if not yours) |
| `GET /api/account/export` | session | now also → `watchlist: [{ id, q, location, remote, createdAt }]`, `push: [{ id, type, createdAt, lastOkAt }]` |
| `GET /api/jobs/search` | any | each job now has `firstSeen` (ms, or null) |
| `GET /api/jobs/history?ids=a,b` | any | → `{ [jobId]: { firstSeen, lastSeen, timesSeen, repostFirstSeen?, repostIds? } }` (unknown ids omitted; ≤ 200 ids; repeated `ids=` also works) |
| `POST /api/jobs/history` | any | `{ ids: [...] }` → same (use for ids containing commas) |
| `GET /api/watchlist` | any | → `{ items: [{ id, q, location, remote, createdAt, lastRunAt, nextRunAt, lastCount }], max: 10, privacy }` |
| `POST /api/watchlist` | any | `{ q, location?, remote?: 'any'\|'remote'\|'onsite', consent: true }` → 201 `{ item, created: true }`, or 200 `{ item, created: false }` if that normalized query exists; 400 without `consent: true` (body includes `privacy`); 409 when full |
| `DELETE /api/watchlist/:id` | any | → `{ ok }` (also drops its queued new jobs) |
| `DELETE /api/watchlist` | any | → `{ ok, removed }` (opt out: every query, queue and cursor) |
| `GET /api/watchlist/new?cursor=<seq>&limit=1..200` | any | → `{ jobs: [{ ...Job, firstSeen, watchId, foundAt, seq }], cursor, more }`. Pass the last `cursor` next time; passing it acknowledges everything ≤ it. Start with 0 |
| `GET /api/push/config` | none | → `{ webPush: { publicKey } \| null, native: { fcm: bool, apns: bool } }` |
| `POST /api/push/subscribe` | any | `{ subscription: PushSubscription.toJSON() }` → `{ id }` |
| `DELETE /api/push/subscribe` | any | `{ endpoint }` → `{ ok, removed }`; with `{}` removes all Web Push subscriptions of this session/device |
| `POST /api/push/native` | any | `{ platform: 'android'\|'ios', token, provider?: 'fcm'\|'apns' }` (android ⇒ fcm; ios defaults to apns, send `provider:'fcm'` if the iOS app uses Firebase) → `{ id, provider, configured }` |
| `DELETE /api/push/native` | any | `{ token }` → `{ ok, removed }` |
| `POST /api/push/test` | any | → `{ sent, failed, removed, skipped }` (content-free test notification to all your targets) |

Native apps send `Authorization: Bearer ap_s_…` on every request and never use cookies or `X-CSRF-Token`. Don't send an `Authorization` header to the sign-in endpoints: an invalid or expired token there gets a 401. A 401 on any other call means the token is gone, so sign in again. "Session" endpoints (vault create/rewrap, link code, devices, export, delete account) accept the app token. Desktop `apd_` tokens still can't use them.

### Cloud watchlist (opt-in, plaintext)

- **Storage.** A query is normalized like `/api/jobs/search` (NFKC, lower-case, whitespace collapsed) and stored once, keyed by its hash, no matter how many users watch it.
- **Schedule.** A single in-process queue checks every minute for due queries and runs them one at a time through the shared job-search cache. Each query runs every 60 min plus 0–5 min jitter, with a 4–8 s gap between searches and at most 120 searches per hour across all users. If every source fails, the query waits 2 h × failures (capped at 12 h).
- **Baseline.** A query's first run only records what already exists. Each later run appends job ids the query has never produced to every subscriber's queue: max 50 per run, 500 per user, kept 14 days.
- **Notify.** Then it sends at most one content-free push per user per 30 min with the unacknowledged count.
- **Repost signal.** Every fresh search (user or scheduled) records `firstSeen` / `lastSeen` / `timesSeen` per public job id. `timesSeen` counts observations at least 30 min apart. A company+title+location fingerprint gives `repostFirstSeen` / `repostIds` when the same posting reappears under a new id.

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
