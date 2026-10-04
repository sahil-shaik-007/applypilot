# Working on ApplyPilot

## Setup

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts Vite (hot reload) and Electron together. If Electron's binary didn't download (npm 11 blocks install scripts by default): `node node_modules/electron/install.js`.

Requirements: Node 20+, Windows 10/11, Microsoft Edge or Google Chrome installed.

## Conventions

- **Main process = CommonJS**, no new dependencies unless unavoidable. **Renderer = ESM/React**.
- All renderer ↔ main communication goes through `window.api.call(channel, …)` (promise, throws readable errors) and `window.api.on(fn)` (live events). Add handlers with `handle('area:action', fn)` in `electron/main.js`.
- Keep the UI consistent with the design tokens in `src/styles.css`; reuse primitives from `src/components/ui.jsx`.
- Safety rules in [ARCHITECTURE.md](docs/ARCHITECTURE.md#safety-guarantees-by-design) are non-negotiable: do not add auto-submit for sites outside the allow-list, CAPTCHA solving, or automated logins.

## Common tasks

| Task | How |
|---|---|
| Add a job source | New file in `electron/connectors/` (see contract in ARCHITECTURE.md), then `node scripts/test-connectors.js --only <id>` |
| Add company boards | Edit `scripts/company-candidates.js`, run `node scripts/verify-companies.js` |
| Add a job platform to the directory | Edit `electron/data/platforms.json` (and `docs/JOB_PLATFORMS.md`) |
| Add a profile field | Edit `electron/data/profile-schema.json` — the form renders from it; teach `electron/apply/answers.js` how to use it |
| Support a new ATS | New adapter in `electron/apply/adapters/` + register in `engine.js`; test with `scripts/apply-dryrun.js --url=…` |
| Change plan limits or prices | `PLANS` in `electron/license.js`, `PRICING` and checkout links in `src/config.js` |

## Testing against real sites — be a good citizen

- Use `scripts/apply-dryrun.js` (never submits). Do not submit test applications to real employers.
- Respect job-source rate limits; connectors already cache and throttle.
- Use an isolated profile: `APPLYPILOT_USER_DATA=C:\tmp\ap-test` so you never touch real user data.

## Building and releasing

```bash
npm run dist
```

See [docs/SELLING.md](docs/SELLING.md) for signing, auto-update, Microsoft Store and licensing. **Never commit `keys/`** (the license signing key) — it is git-ignored.
