# Testing ApplyPilot

ApplyPilot ships with six layers of automated tests. Run them before every release. The release workflow is: test → fix → rebuild → reinstall → commit/push with docs and screenshots.

| Layer | Command | What it covers | Network |
|---|---|---|---|
| **End-to-end UI** | `node scripts/e2e.js` | 71 checks through the real Electron UI (includes Career pages: inspect, add, toggle, refresh, remove). See the list below. | Live job sources |
| E2E on the installer build | `node scripts/e2e.js --exe release/win-unpacked/ApplyPilot.exe` | Same 71 checks against the packaged app (asar, unpacked modules, bundled icon) | Live |
| **Phone ↔ desktop sync** | `node scripts/cloud-sync.e2e.js [--exe …]` | Starts the real cloud server, plays the phone with the shared crypto, drives the desktop app: link, encrypted push/pull, outbox → Review queue, phone edits flowing back, tamper rejection, device revocation, and **"server DB contains no readable personal data"** (10 checks) | Local server |
| **Cloud server** | `cd web && npm test` | 110 passing tests (1 live test skipped without `LIVE=1`): auth (Google ID token, dev-login gating), sessions, CSRF/Origin, vault, items/versions/tombstones, blobs/quotas, device link/revoke, export, delete account, rate limits, headers, and an E2E crypto test proving only ciphertext is stored | None (`LIVE=1` adds a live search) |
| Mobile PWA | `node web/client/e2e/mobile.e2e.mjs` | Phone-sized (390×844) walkthrough: sign-in, vault create/lock/unlock, profile, resume upload, search, swipe triage, quick-fill, send to laptop, devices, delete account; no horizontal overflow at 360 px | Local server |
| **Feature units** | `node scripts/features.test.js` | 17 checks: country, date/month/time windows, current-employer rule, plain-English company and role matching, local AI model calls (mock server) | None |
| Apply engine self-test | `node scripts/apply-selftest.js` | 8 checks against a **local** page: submit path, dry-run guard, review hand-off, abort, missing-answer safety, cancel-window Hold, cancel window elapsing, and the watchdog (a slow fill is never submitted) | None |
| Apply dry-run on real postings | `node scripts/apply-dryrun.js [greenhouse\|lever\|ashby] [--url=…]` | Fills real application forms and **never submits** | Live |
| Connectors | `node scripts/test-connectors.js` · `node scripts/test-ats.js` | Every job source returns well-formed jobs | Live |

Useful flags for `e2e.js`:
- `--screenshots` refreshes `docs/screenshots/*.png`.
- `--quick` skips the slow live campaign and applying checks (about 1 minute).

## How the E2E suite works

- Launches Electron via Playwright with an **isolated, throwaway profile** (`%TEMP%\applypilot-e2e-<timestamp>`), so it never touches your real data.
- Builds its own test resumes in `%TEMP%\applypilot-e2e-fixtures`. They need Python with `reportlab` and `python-docx`.
- Uploads resumes by **real drag-and-drop** on the dropzone, which exercises the sandboxed `webUtils.getPathForFile` path. Other actions go through the UI or IPC.
- Runs the apply browser hidden (`APPLYPILOT_HEADLESS=1`) and **only in review mode**. Every opened form is cancelled at the end, so nothing is ever submitted to an employer.
- Exits with code 1 if any check fails. Per-check results go to `%TEMP%\applypilot-e2e-results.json`.

## The 67 desktop checks

**Onboarding & uploads**
- A 7-day trial is active from first launch.
- The welcome screen shows.
- Drag-and-drop uploads a PDF and a DOCX.
- A resume chip can be removed with ×, and Cancel keeps it.
- Duplicates are rejected, including the same file under a new name.
- Unsupported files are rejected without blocking the rest of the batch.
- A word-positioned PDF is parsed with real spaces and skills.
- An image-only PDF is flagged as unreadable.
- Name and email are pre-filled from the resume, and both are required.
- Tags, chips and Yes/No controls work.
- Finishing setup creates the first campaign.

**Window & small screens**
- An oversized window is pulled back above the taskbar.
- A maximized window that covers the taskbar is corrected.
- Restoring from the tray keeps the window maximized.
- The minimum size fits a 1366×768 laptop.
- Every page fits and stays reachable at 1280×672, 1366×728, 1024×600 and 960×560.

**Referrals, imports, eligibility**
- LinkedIn connections power "You know N people at …".
- A Teal CSV imports with statuses mapped and duplicates skipped.
- The "Only jobs I can take" and "Sponsors visa" filters work.
- **A likely scam is blocked before any browser opens.**
- The cancel-window setting exists.
- The Network and Phone & web tabs work.

**Profile & resumes**
- Edits autosave.
- A Yes/No answer can be cleared.
- Work history items can be added and removed.
- A resume can be renamed, role-tagged, made default and re-read.
- A role tag can be removed.

**Campaigns (live)**
- Campaigns can be created and edited in the editor, each with its own resume.
- Three campaigns run in parallel, each queuing at most 50 jobs.
- Queued jobs use the campaign's pinned resume.
- Pause works.
- Re-running doesn't re-queue or re-count jobs.

**Review & apply (live, never submits)**
- The queue filters by campaign; select + skip removes jobs.
- **Six applications fill in parallel** (peak concurrency is checked) and are handed to the user.
- Unknown questions go to the Answer bank.
- Cancelling closes the tabs.

**Answer bank** — add, answer and delete a question.

**Applications**
- The drawer offers Apply and a resume switcher; delete asks for confirmation.
- Status can be changed.
- "Clear closed" works.

**Find jobs (live)**
- A multi-source search returns ranked results.
- Save and unsave work.
- Filters narrow the list.

**Platforms & AI studio**
- 252 platforms load and filter by region.
- AI studio renders and blocks AI actions when no key is set.

**Settings & licensing**
- An API key can be saved (masked) and removed.
- A source can be toggled off and on.
- A company board URL is added under the right ATS, and can be removed.
- AI shows a no-key message.
- An offline Lifetime key activates and can be removed.
- An expired trial resolves to Free.

**Stress & limits**
- The Dashboard, Applications and Review queue each render 3,000 applications in under 2 s, with the table paged.
- Free-plan limits are enforced: a 2nd campaign and a 3rd resume are blocked with upgrade messages.

**Packaging & hygiene**
- The icon loads in the bundle.
- The PDF engine works inside the bundle.
- No renderer errors occur during the run.

**Privacy** — "Delete everything" wipes all data and restarts.

## Latest results (v1.2.0, 6 Oct 2026)

| Suite | Result |
|---|---|
| Desktop E2E (dev build) | **71/71** |
| Phone ↔ desktop sync E2E | **10/10** |
| Apply engine self-test | **8/8** |
| Cloud server | **64 pass, 0 fail** (1 live test skipped unless `LIVE=1`; passes with it) |
| Vault crypto | **9/9** |

## Previous results (v1.1.0, 4 Oct 2026)

| Build | Result |
|---|---|
| Dev (`electron .`) | **49/49** (before the packaging checks were added) |
| Packaged `release/win-unpacked/ApplyPilot.exe` | **51/51**, three consecutive green runs |
| `apply-selftest.js` | **5/5** |

Highlights from the packaged run:
- Three parallel campaigns queued 50 / 50 / 44 jobs.
- Six parallel applications filled 17 / 17 / 17 (Greenhouse) and 7 / 6 / 7 (Ashby) fields, with peak concurrency of 6 and 0 submissions.
- Page render with 3,000 applications: Dashboard 1.3 s, Applications 1.1 s, Review queue 1.8 s.

## Bugs found by this suite and fixed in 1.1.0

See [CHANGELOG.md](../CHANGELOG.md#110--2026-10-04). In brief:
- Resumes couldn't be removed during onboarding.
- PDF words were glued together.
- Greenhouse redirects led to 0 fields filled.
- The tray icon was missing in installed builds.
- New users hit the Free-plan limit during onboarding.
- Deleting a resume broke pinned campaigns.
- The "found" stat re-counted the same jobs, and the queue had no total cap.
- A Lever URL could be filed under the wrong ATS.
- Role-phrased experience questions went unanswered.
- The Review queue was slow with hundreds of rows.
- "Delete all data" was promised in the privacy policy but missing.
