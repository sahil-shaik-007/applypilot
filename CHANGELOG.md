# Changelog

All notable changes to ApplyPilot. Format based on [Keep a Changelog](https://keepachangelog.com/).

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
