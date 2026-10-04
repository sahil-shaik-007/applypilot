# ApplyPilot Architecture

ApplyPilot is an **Electron** desktop app. The UI is **React + Vite** (renderer); everything else runs in the Electron **main process** (Node). There is no backend: all data is local and every network call goes straight from the user's PC to a job source, an employer's form, Anthropic, or Dodo Payments.

```
┌────────────────────────── Renderer (src/, React) ──────────────────────────┐
│  12 pages · AppProvider (src/lib/store.jsx) · window.api.call / .on        │
└──────────────▲─────────────────────────────────────────────┬───────────────┘
               │ events (campaign:update, application:update, │ IPC invoke
               │ activity, search:progress, plan)             ▼
┌─────────────────────── preload.js (contextBridge, sandboxed) ───────────────┐
└──────────────▲─────────────────────────────────────────────┬───────────────┘
               │                                              ▼
┌─────────────────────────── Main process (electron/) ────────────────────────┐
│ main.js ─ IPC handlers, tray, notifications, DPAPI-encrypted keys           │
│   ├─ store.js        JSON collections in %APPDATA%/ApplyPilot/data          │
│   ├─ connectors/     one module per job source + index.js aggregator       │
│   ├─ match.js        scoring, skill extraction, ghost/scam flags            │
│   ├─ resume.js       PDF/DOCX/TXT parsing, profile guess, best-resume pick  │
│   ├─ ai.js           Claude: cover letter, answers, tailoring, prep         │
│   ├─ campaigns.js    parallel campaign loops + apply orchestration         │
│   ├─ license.js      plans, trial, offline Ed25519 keys, Dodo activation   │
│   └─ apply/          Playwright engine, ATS adapters, profile answerer     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data flow of a campaign

1. `CampaignManager.start(id)` creates an `AbortController` and runs `loop()` — **one independent loop per campaign**, so campaigns run in parallel. The plan limits how many may be active (`PLANS[x].campaigns`).
2. `runOnce()` calls `searchAll()` for every role × location (max 3 locations). `searchAll()` fans out to every ready connector with `Promise.all`, applies a per-connector timeout, and de-duplicates across sources (`company|title`), preferring the copy that links straight to an auto-apply-capable ATS.
3. Each job is filtered (`alreadyHandled` duplicate + per-company cap, exclude lists, required keywords) then scored by `scoreJob()` against the chosen resume's text, the profile and the campaign.
4. Jobs ≥ `minScore` become **applications**:
   - `mode: queue` → status `queued` (max 50 waiting per campaign) for one-click approval in the Review queue.
   - `mode: review` / `auto` → `applyApplication()` runs two at a time per campaign; the engine caps total browser tabs globally.
5. `applyApplication()` builds a cover letter (AI or template), then calls `ApplyEngine.applyToJob()`. When the engine reports `needs-user` the application becomes `awaiting-you` and the campaign moves on; the engine keeps watching that tab (up to 30 min) and `finalize()` records `applied` when a confirmation appears.
6. The loop sleeps `intervalMinutes` (min 15) and repeats.

## Connectors (`electron/connectors/`)

Every `*.js` file (except `index.js` and `_`-prefixed helpers) is auto-loaded. Contract:

```js
module.exports = {
  id, name, kind: 'api' | 'ats' | 'feed', homepage, description, regions,
  requiresKeys: ['someKey'], optionalKeys: [],
  async search({ query, location, remote, limit }, ctx) { /* → Job[] via makeJob() */ },
};
```

`ctx` = `{ keys, companies, log }`. Build jobs with `makeJob(source, {...})` from `_util.js` (normalised shape: title, company, location, remote, salary*, description, url, applyUrl, ats, atsMeta, tags, postedAt). Use `matchesQuery` / `matchesLocation` when the API can't filter server-side (`matchesLocation` understands aliases such as Bengaluru ↔ Bangalore).

- **Free:** Himalayas, Remote OK, We Work Remotely, Remotive, Arbeitnow, Jobicy, The Muse, HN Who's Hiring, 4 Day Week, Rise, No Fluff Jobs, jobdata API, Working Nomads.
- **ATS boards** (read from `electron/data/companies.json`, 729 verified boards + user-added): Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee.
- **Keyed:** JSearch (RapidAPI and OpenWeb Ninja), Adzuna, Jooble, Reed, USAJOBS, Careerjet, SerpApi Google Jobs, Findwork. They appear as "not connected" until the user pastes a key in Settings → Job sources.

To add a source: drop a file in the folder, run `node scripts/test-connectors.js --only <id>`.

To add company boards: add slugs to `scripts/company-candidates.js` and run `node scripts/verify-companies.js` (verifies each against the live ATS API and rewrites `companies.json`).

## Auto-apply engine (`electron/apply/`)

- `engine.js` — `ApplyEngine`: one shared persistent Chromium context (user's installed Edge/Chrome via `playwright-core`, profile in `%APPDATA%/ApplyPilot/browser-profile` so logins persist), a semaphore limiting parallel tabs, per-application `AbortSignal`, screenshots as proof.
- `adapters/` — `greenhouse`, `lever`, `ashby`, `workable`, `smartrecruiters`, `recruitee` + `generic` (heuristic label→field matching for any form).
- `answers.js` — deterministic profile-based answerer (names, links, work authorisation, sponsorship, salary, notice period, per-skill years, EEO…) with a fuzzy option matcher. Returns `null` when unsure → falls through to the Q&A memory, then AI, then the user.
- `dom.js` — robust fill helpers (React-controlled inputs, comboboxes, radios, file upload, captcha detection, cookie banner rejection).

### Safety guarantees (by design)

| Rule | Where enforced |
|---|---|
| Auto-submit only on the six allow-listed ATSs, only when every required answer is known and no captcha is visible | `engine.js` (`AUTO_SUBMIT_ATS`, `canAuto`) |
| LinkedIn / Indeed / Naukri / Glassdoor / Workday / unknown sites are **assisted only** | `engine.js` (`ASSISTED_ATS`) |
| Dry-run mode can never submit (adapter `submit()` throws, submit clicks refused, POSTs aborted) | `engine.js`, adapters |
| Never logs in, never reads/fills password fields, never solves CAPTCHAs | `engine.js`, `dom.js` |
| Daily caps (plan + user + per campaign), duplicate guard, ≤ 2 applications per company / 30 days | `campaigns.js` |
| Unknown questions are never guessed — they pause and are saved to the Answer bank | `campaigns.answerQuestion` |
| Free plan can't auto-submit (falls back to review mode) | `campaigns.applyApplication` |

## AI (`electron/ai.js`)

Bring-your-own Anthropic key (stored with Electron `safeStorage` / DPAPI). Uses the official `@anthropic-ai/sdk`; structured outputs (`output_config.format` JSON schema) for resume parsing, ATS tailoring and screening answers; adaptive thinking is left to the model; `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) is enabled on Opus 5.5 / Sonnet 5.5 so a safety decline retries on a fallback model. Default model `claude-opus-5-5`, selectable in Settings.

## Licensing (`electron/license.js`)

- **Plans** (`PLANS`): Free, Trial (7 days), Pro, Sprint, Lifetime — limits for campaigns, resumes, daily applies, parallel tabs, AI actions, auto-submit and analytics.
- **Offline keys:** `AP1.<payload>.<ed25519 signature>`, minted by `scripts/license-tool.js` with `keys/license-private.pem`; verified with `electron/license-public.pem`.
- **Online keys:** Dodo Payments public `/licenses/activate` + `/licenses/validate`; re-validated on launch with a 14-day offline grace; refunded/revoked keys fall back to Free (data is never locked).

## Storage (`electron/store.js`)

Debounced, atomic (`tmp` + `rename`) JSON collections in `%APPDATA%/ApplyPilot/data`: `settings`, `profile`, `resumes` (files in `resumes/`), `campaigns`, `jobs` (bounded cache), `applications`, `qa`, `activity`, `license`, `platform-usage`. A corrupt file is copied aside and replaced with defaults.

## Renderer (`src/`)

- `lib/store.jsx` — `AppProvider`: bootstraps from `app:bootstrap`, merges live events, exposes `run(channel, args, okMsg)` that toasts errors.
- `components/ui.jsx` — design system primitives; `components/jobs.jsx` — job card, detail drawer, AI results.
- `pages/` — Dashboard, Jobs, Campaigns, ReviewQueue, Applications, Resumes, Profile, QA, Platforms, AIStudio, Settings, Onboarding.
- `styles.css` — design tokens modelled on trustmrr.com/acquire: `#0a0a0a` background, Inconsolata, `rgb(26,45,58)` premium cards with the `premium-streak` shimmer, 10 px radii, uppercase 10 px labels, pill badges, gradient CTA.

## Testing helpers

| Command | Purpose |
|---|---|
| `node scripts/test-connectors.js [--only id] [-q "role"]` | Live-test free connectors |
| `node scripts/test-ats.js [ids…]` | Live-test ATS connectors (counts, timings) |
| `node scripts/apply-selftest.js` | Engine self-test against a local page (submit path, abort, review) |
| `node scripts/apply-dryrun.js [greenhouse\|lever\|ashby] [--url=…]` | Fill real postings **without ever submitting** |
| `APPLYPILOT_USER_DATA=<dir> electron . --remote-debugging-port=9333` | Run against an isolated profile and drive the UI over CDP |
| `APPLYPILOT_HEADLESS=1` | Test-only: run the apply browser hidden |

Never run the apply engine in `auto` mode against real postings while testing.
