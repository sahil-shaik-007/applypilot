# ApplyPilot Cloud (`web/`)

One Node 24 process that serves the **zero-knowledge sync + job-search API** (`web/server`) and the built
**mobile PWA** (`web/client/dist`). The binding API and security spec is [`docs/CLOUD.md`](../docs/CLOUD.md);
the client-side crypto is [`web/shared/vaultCrypto.js`](shared/vaultCrypto.js). The server never decrypts
anything: it stores ciphertext, wrapped keys and hashes of tokens.

```
web/
  server/           Express 5 API (ESM), node:sqlite storage, tests in server/test
  shared/           vaultCrypto.js (WebCrypto, shared by PWA, desktop and tests)
  client/           the PWA (Vite + React), built to client/dist
  Dockerfile        multi-stage image (build context = repo root)
  render.yaml       Render Blueprint      fly.toml   Fly.io config
```

## Setup

Requirements: Node 24+ (uses built-in `node:sqlite`, no native modules).

```bash
cd web
npm install                 # server deps (express, helmet, express-rate-limit, google-auth-library)
npm --prefix client install # PWA deps
cp .env.example .env        # optional; defaults work for local dev
```

## Local development

```bash
npm run dev          # API on :8787 (watch mode, AP_DEV_LOGIN=1) + Vite PWA on :5174 (proxies /api)
npm run dev:server   # API only
```

Open http://localhost:5174. With `AP_DEV_LOGIN=1` the sign-in screen offers email-only **dev login**, so no
Google client is needed. Dev login is refused when `NODE_ENV=production` (the server will not even start).

Cookies are `Secure`; browsers treat `http://localhost` as a secure context, so this works over plain HTTP
on localhost. To test from a phone, use an HTTPS tunnel and set `APP_ORIGIN` to the tunnel origin; a plain
`http://192.168.x.x` LAN address will not keep the session cookie.

### Tests

```bash
npm test                              # server suite + shared crypto tests (node:test, real HTTP, temp SQLite)
LIVE=1 npm test                       # also run the live job-search smoke test (hits public APIs)
$env:LIVE=1; npm test                 # same, PowerShell
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `APP_ORIGIN` | `http://localhost:5174` (dev only) | Exact browser origin. **Required and must be https in production.** Used for the Origin check. |
| `GOOGLE_CLIENT_ID` | (empty) | OAuth Web client ID. Empty disables Google sign-in (503). |
| `DATABASE_PATH` | `web/server/data/applypilot.db` | Docker: `/data/applypilot.db` on a persistent volume. |
| `NODE_ENV` | | `production` enables HSTS and `upgrade-insecure-requests`, and forbids dev login. `npm start` sets it. |
| `AP_DEV_LOGIN` | | `1` enables `POST /api/auth/dev` outside production only. |
| `TRUST_PROXY` | `1` in production, else `0` | Reverse-proxy hops to trust for client IPs (rate limiting). |
| `CLIENT_DIST` | `web/client/dist` | Where the built PWA lives. |

## Creating the Google OAuth client

1. Open Google Cloud Console and create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose External and fill in the app name, support email and
   privacy policy URL. Only the basic scopes (`openid`, `email`, `profile`) are used.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Web application**.
4. **Authorized JavaScript origins**: add your `APP_ORIGIN` (e.g. `https://app.applypilot.app`). For local
   testing with Google, also add `http://localhost:5174` and `http://localhost`.
   No redirect URIs are needed: the PWA uses the Google Identity Services popup/One Tap and posts the ID token
   to `POST /api/auth/google`.
5. Copy the client ID (`….apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID`. There is **no client secret**
   to configure; the server only verifies ID tokens.

## Production

```bash
npm run build   # builds client/dist
npm start       # NODE_ENV=production node server/index.js
```

### Docker

The build context is the repository root, because the server reuses `electron/connectors` and
`electron/data`:

```bash
cp web/.dockerignore web/Dockerfile.dockerignore   # Docker applies <Dockerfile>.dockerignore for this context
docker build -f web/Dockerfile -t applypilot-cloud .
docker run -p 8787:8787 -v applypilot-data:/data \
  -e APP_ORIGIN=https://app.example.com -e GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com applypilot-cloud
```

The image runs as the non-root `node` user and keeps the database on the `/data` volume. Put it behind a
TLS-terminating proxy (Render and Fly do this for you).

### Render

Create a **Blueprint** from this repo and set the Blueprint path to `web/render.yaml`. Then set `APP_ORIGIN`
and `GOOGLE_CLIENT_ID` in the dashboard. The 1 GB disk is mounted at `/data`, and the health check is `/api/health`.

### Fly.io

```bash
fly launch --no-deploy --copy-config --config web/fly.toml      # or edit `app` in fly.toml first
fly volumes create applypilot_data --size 1 --config web/fly.toml
fly secrets set APP_ORIGIN=https://<app>.fly.dev GOOGLE_CLIENT_ID=... --config web/fly.toml
fly deploy . --config web/fly.toml
```

Run **exactly one instance**: SQLite and the in-memory rate limiter and search cache are single-process.

## Security notes

- **Zero-knowledge.** Records are AES-256-GCM ciphertext bound by AAD to `user/collection/id`; blobs are
  encrypted bytes. The vault document holds only wrapped DEKs and KDF parameters. The server never parses
  ciphertext. A test proves the database file holds no plaintext.
- **Auth.** Google ID tokens are verified with `google-auth-library` (signature, `aud`, `iss`, `exp`), and
  `email_verified` is required. Sessions use a 256-bit token in `__Host-ap_session` (HttpOnly, Secure,
  SameSite=Lax, Path=/). Only SHA-256 hashes are stored. Expiry slides over 30 days, and every sign-in
  rotates the session.
- **CSRF.** The readable `ap_csrf` cookie must equal the `X-CSRF-Token` header, and the token must be the one
  derived from the session (so a forged cookie pair fails). `Origin` must equal `APP_ORIGIN`, and
  `Sec-Fetch-Site: cross-site` is refused. Sign-in endpoints also require the app Origin. Device bearer
  requests are exempt. No CORS headers are ever sent.
- **Devices.** One-time 8-character codes use a 31-symbol alphabet with no `0 O 1 I L`. Codes are stored
  hashed, expire after 10 minutes and are single-use. A new code replaces the old one. Redemption is
  rate-limited per IP and globally. Device tokens (`apd_…`, 256-bit) are stored hashed and are revocable.
  "Sign out everywhere" revokes all sessions and devices. A device unused for 180 days stops working.
- **Limits.** JSON bodies ≤ 300 KB, records ≤ 256 KB, blobs ≤ 6 MB, 60 MB per user. Rate limits apply per IP
  and per user on auth, link codes, redeem, search and writes.
- **Headers.** helmet applies a strict CSP (self + Google Identity Services + `api.anthropic.com` for
  connect; `img-src https: data:`; `frame-ancestors 'none'`). It also sets HSTS (2 years, preload) in
  production, `Referrer-Policy: no-referrer`, COOP `same-origin-allow-popups`, X-Frame-Options DENY and a
  minimal Permissions-Policy.
- **Account deletion** hard-deletes all rows and blobs in a transaction with `secure_delete` on, then
  truncates the WAL.
- **Logs** contain only method, path, status and duration.
