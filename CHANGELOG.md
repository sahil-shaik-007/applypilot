# Changelog

All notable changes to ApplyPilot. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] — 2026-10-06

### Fixed
- **Window could extend under the Windows taskbar** (bottom of the app unreachable), e.g. after display, resolution or scaling changes, and on small laptops where the old 1080×700 minimum size exceeded the usable area. New `electron/windowFit.js`:
  - re-validates the window against the display's work area on show/restore/maximize/resize/move and on display changes
  - the page reports back if it's ever taller than the screen
  - minimum size is now 960×560, the window size and position are remembered and validated, and restoring from the tray keeps the maximized state
  - compact layout for short screens, plus an icon-rail sidebar below 1080 px wide
  - covered by new E2E checks at 1280×672, 1366×728, 1024×600 and 960×560
- **Apply engine watchdog**: a stuck page could hold a browser slot forever. Filling is now capped at 3 min; a timed-out form is handed to you and is **never** auto-submitted.

### Added (from the competitive analysis of 37 products: docs/COMPETITIVE_ANALYSIS.md)
- **Truthful tailored resume PDF per job.** Claude rewrites your real resume for the job; a verifier removes any skill, employer, school, certification or claim not in your original; an ATS-friendly PDF is generated and uploaded for that application. It can run per job (AI tools) or for every job in a campaign ("AI-tailor").
- **Eligibility checks** before any personal data leaves the PC:
  - scam detection (fees, WhatsApp/Telegram recruiting, shorteners/generic forms, too-good earnings, requests for ID/bank details)
  - posting-language detection against the languages you speak
  - remote-region restrictions ("US only", "EMEA") against your country
  - Jobs filter "Only jobs I can take" (on by default)
- **Visa sponsorship detection**: badge and "Sponsors visa" filter; "no sponsorship" jobs are skipped automatically if your profile says you need a visa.
- **Cancel window before every auto-submit** (default 30 s, configurable) with Hold / Submit now in the Review queue and a desktop notification.
- **Still-open check** right before applying (Greenhouse, Lever, Ashby, SmartRecruiters public APIs); closed jobs are skipped.
- **Referral finder**: import LinkedIn Connections.csv (stays local); every job shows who you know there.
- **Research links** on every job: people, company page, Glassdoor/AmbitionBox reviews, interview questions, news. AI **referral request** and **follow-up email** writers.
- **Market pay**: 25th–75th percentile salary for similar roles, computed locally.
- **Morning digest** notification (new matches, forms to submit, follow-ups due, questions to answer).
- **Tracker import** from Teal, Huntr, Simplify or any spreadsheet CSV (auto-detects columns, maps statuses, skips duplicates), and a **work-search log** export.
- **Phone & web companion (ApplyPilot Cloud)** — see docs/CLOUD.md and web/README.md:
  - mobile-first PWA with Google sign-in, job search, swipe triage, a quick-fill sheet for applying from the phone, and "send to my laptop"
  - **zero-knowledge, end-to-end encrypted** sync: AES-256-GCM, PBKDF2-SHA256 600k, recovery key, AAD-bound records, non-extractable keys, auto-lock
  - hardened server: hashed session/device tokens, CSRF double-submit + Origin checks, strict CSP, HSTS, rate limits, quotas, hard-delete account
  - desktop **Settings → Phone & web** links this PC with a one-time code and syncs every 60 s
- Tests:
  - `scripts/cloud-sync.e2e.js`: phone ↔ desktop, 10 checks, including "the server DB contains no readable personal data"
  - E2E grew to 65 checks
  - engine self-test grew to 8 checks (cancel-window Hold, watchdog never submits)
  - server: 64 tests

## [1.1.0] — 2026-10-04

Quality release driven by a new 51-check end-to-end test suite (`scripts/e2e.js`), run against both the dev build and the packaged installer.

### Fixed
- **Onboarding: uploaded resumes can now be removed** (× on each chip, with confirmation). Previously there was no way to undo an upload during setup.
- **PDF resumes with no space characters** (common with Canva/Word/LaTeX exports) were read as glued-together words ("ProficientinPythonandSQL"), so no skills were detected. PDFs are now read with Mozilla pdf.js, rebuilding word spacing from glyph positions (legacy parser kept as fallback). Existing resumes are re-read automatically on first launch; each resume also has a **Re-read** button.
- **Greenhouse applications filled 0 fields** when a company redirected its Greenhouse job page to its own careers site (e.g. HelloFresh). The engine now opens Greenhouse's embeddable application form, which cannot be redirected (0 → 17–21 fields filled).
- The engine no longer reports "Form filled" when nothing was filled; it tells the user to apply in the opened tab instead.
- **Deleting a resume** that a campaign or queued job was pinned to made those applications fail; they now fall back to automatic resume selection.
- **Duplicate resumes**: the same file (even renamed) is now rejected with a clear message; unsupported files (e.g. images) are rejected while the rest of a multi-file upload still imports.
- **Tray icon missing in the installed app** (icon file wasn't bundled), so closing the window with running campaigns hid the app with no way back. Icon is now bundled and loaded as a NativeImage for window, tray and notifications.
- **New users were on the Free plan during onboarding** (2-resume limit could block setup). The 7-day Pro trial now starts on first launch.
- "Found" stat re-counted the same jobs on every hourly run; queue mode had no total cap. Now only genuinely new jobs are counted and each campaign keeps at most 50 jobs waiting.
- Company boards: pasting a careers URL now detects the ATS from the domain (a Lever URL was saved under the selected "greenhouse").
- Experience questions phrased "minimum of N years of experience *as a* <role>" are now answered from total experience.
- Unknown optional one-word fields ("Twitter", "Other") no longer clutter the Answer bank.

### Added
- **Delete all my data** (Settings → Data & privacy) — wipes profile, resumes, applications, keys, license and browser profile, then restarts (the privacy policy already promised this).
- In-app confirmation dialogs (replacing native `confirm()` popups) for every destructive action.
- Applications drawer: **Apply now / Fill, I submit** and resume switching for saved, failed, skipped and needs-you applications; delete now asks for confirmation.
- Jobs drawer: **Unsave / Un-skip**.
- Applications board: **Clear closed** (bulk remove rejected/failed/skipped), per-column "Show more", table paging (200 rows at a time).
- Review queue: **filter by campaign**, paging (100 rows at a time), **Answer** shortcut on items with open questions, tooltips on icon buttons.
- Dashboard: **Clear** activity feed. Profile: Yes/No answers can be cleared by clicking the selected option again.
- Onboarding: separate GitHub and portfolio fields; larger removable resume chips.
- Skill dictionary expanded beyond tech (finance & accounting, HR, sales & marketing, operations & supply chain, mechanical/civil/electrical engineering, healthcare, education) with proper display names (AutoCAD, SAP FICO, VLOOKUP, GD&T…).
- `scripts/e2e.js` end-to-end suite and `docs/TESTING.md`; screenshots in `docs/screenshots/`.

### Changed
- Installer trimmed to ~115 MB by excluding pdf.js viewer assets and its optional native canvas renderer (not needed for text extraction).

## [1.0.0] — 2026-10-04

First release.

### Added
- **Job search** across 19 free sources in parallel, plus 9 keyed sources (JSearch ×2, Adzuna, Jooble, Reed, USAJOBS, Careerjet, SerpApi, Findwork) and 729 verified company career boards on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee. Cross-source de-duplication and location aliases (Bengaluru ↔ Bangalore, NYC, NCR…).
- **Directory of 252 job platforms** with deep-linked searches (India, US, UK, EU, remote, freelance, government, "hidden job" Google ATS searches).
- **Parallel campaigns**: one per role, each with its own resume, filters, schedule, minimum match score and daily cap; modes *Review queue*, *Fill, I submit* and *Full autopilot*.
- **Multiple resumes** with role tags, automatic best-resume selection per job, and per-resume interview-rate analytics.
- **Match scoring** with title/skills/experience/location/freshness breakdown, matched and missing skills, ghost-job and scam flags.
- **Auto-apply engine** (Playwright driving the user's own Edge/Chrome): Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee adapters plus a generic form filler; assisted-only mode for LinkedIn/Indeed/Naukri/Glassdoor/Workday.
- **13-section profile** and a deterministic answerer for screening questions; **Answer bank** memory; unknown questions are never guessed.
- **AI studio** (bring-your-own Anthropic key): ATS score and tailoring, cover letters, interview prep, recruiter outreach, resume → profile parsing.
- **Application tracker**: drag-and-drop board, table, notes, follow-up reminders, proof screenshots, CSV and JSON export.
- **Licensing**: Free / 7-day trial / Pro / Sprint / Lifetime; offline Ed25519 keys and Dodo Payments online activation with offline grace.
- **Onboarding wizard**, system tray (campaigns keep running when the window is closed), Windows notifications, start-with-Windows option.
- NSIS installer via electron-builder; auto-update wiring via electron-updater.

### Safety
- Review-first defaults, daily caps, ≤ 2 applications per company per 30 days, no CAPTCHA solving, no automated login, dry-run mode that cannot submit.
