# Changelog

All notable changes to ApplyPilot. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.6.0] — 2026-10-14

### Added
- **Answers belong to a profile.** The answer bank is scoped per profile (or shared with all). A profile uses its own answers first, then shared ones, never another person's. Saving an answer from a job's questions saves it for that application's profile, with a "use for all profiles" switch. Available on the phone/web and the desktop.
- **Pending jobs.** A job that couldn't be filled stays under "Needs you" with the missing questions. Answer them, press "Review and apply", confirm in the check sheet, and the job goes back to your PC to apply. The Queue shows how many jobs are waiting for answers.
- **Retry from the PC.** A job sent again for a profile whose application is waiting, failed or queued restarts that application instead of being ignored.
- **Profiles on the desktop.** Switch, add, rename and delete profiles; pick the profile for a campaign, a manual apply and each resume. Per-profile "applied today" counts on the dashboard.
- **Browser state is not shared between profiles.** Before an application form opens for a different profile than the last one, ApplyPilot clears that site's saved data (storage and cookies for that site only). Your logins on LinkedIn, Indeed, Naukri and similar sites are kept.
- **Bridge and extension** return only the current profile's answers, and answers typed in the extension are saved for that profile.

### Changed
- When campaigns run for several profiles, each profile gets an even share of the plan's daily limit. The plan limit itself is unchanged.
- Deleting a profile keeps its resumes and applications (open applications keep a copy of its details); its campaigns fall back to the main profile.

### Tests
- Desktop e2e 71/71; phone-to-desktop sync 13/13 (new: a second profile's job keeps its own details); feature units 18/18; apply self-test 8/8; web server tests 110.

## [1.5.0] — 2026-10-11

### Added
- **Several profiles** (for example "Me" and a family member). Each profile has its own details and resumes. Campaigns and applications belong to one profile, and campaigns for different profiles run in parallel. Duplicate checks are per profile, so two people can apply to the same job.
- **Resume per profile.** A resume belongs to one profile or is shared with all. Pick the owner on the Resumes page.
- **Check before applying** (phone and web). Before "Send to my PC", the sheet shows what will be filled from the chosen profile, asks for anything missing and saves it to that profile, lets you choose the resume, and sends only after you confirm.
- **Browser extension fills from your profile.** The page check lists what will be filled and what is missing. It fills only after you confirm, never submits, and attaches the resume only when you ask for it. The desktop bridge returns the profile of the tracked application for the job's URL.

### Changed
- Job actions depend on the device. In the phone app: "Apply in app" and "Send to my PC". In a browser: "Send to my PC" and "Open job page". "Apply on this phone" no longer appears on a laptop.
- The desktop applies each queued job with the profile and resume that were sent with it.
- Review queue: the "Needs you" list shows the first 100 items.

### Fixed
- Workable open/closed check and company-name handling (see 1.4.2).

### Tests
- Desktop e2e 71/71 (after the stress test's Needs-you cap and the Answer-bank delete locator update).
- Feature units 18/18, web server tests 110 passing (1 live test skipped).

## [1.4.2] — 2026-10-11

### Fixed
- **Wrong company name for career pages.** Adding a careers page took the company from the page title, so a job page such as "Graduate Engineer Trainee - Exponent Energy" made the job title the company (every job from that board showed "Graduate Engineer Trainee"). The company now comes from the site name, then the company part of a job-page title, then "Careers at X" titles, then the board slug.
- **Workable open/closed check.** Workable postings are now checked against Workable's single-job endpoint, so a filled posting is skipped instead of being treated as unknown.
- **Workable application form:**
  - Name, email, phone and address come from your profile, or from the resume when the profile is empty. A draft the browser restored (an old name, email or phone) is overwritten. The field is never left with a value that isn't yours.
  - The resume you selected is attached, even if an older draft file is still on the form. The app checks the attachment by its original file name.
  - Phone numbers are typed in national format, so the country code isn't doubled.
- **YES / NO questions on Workable** (role="radio" groups) are detected, answered and verified. Before, they were skipped without any message.
- **Values already on a form are reported.** A pre-filled answer that isn't from your profile is kept for review and listed as unanswered, instead of being submitted silently.

### Known limits
- The name on a resume is split into first and last names by a guess. If the form shows the wrong split, set first and last name in Profile.
- A resume file restored as a draft on other ATS forms can still be kept; this release fixes Workable only.
- Tests were not run for this release, at your request.

## [1.4.1] — 2026-10-11

### Added
- **Choose any time period.** "Posted within" (campaigns and Find jobs) and "Found within" (Find jobs) use one picker:
  - presets: any time, last hour, 6 hours, 12 hours, 24 hours, 2, 3 or 7 days, 14 days, 30 days
  - **Custom period…**: any amount of hours, days, weeks or months (up to one year)
  - campaigns that used the old day-based setting keep working
  - a campaign card shows its period, for example "posted last 2 weeks"

### Changed
- Reinstalled ApplyPilot: uninstalled 1.4.0 and installed 1.4.1 fresh. Your saved data folder is kept by the uninstaller.

## [1.4.0] — 2026-10-11

### Added
- **Plain-English job search** (Find jobs → "Describe what you want"). For example: *"List data analyst roles at Stripe and Notion that sponsor visas in India."*
  - The AI (your Claude key or a local model) turns the request into a plan: companies, role words, visa requirement and countries.
  - ApplyPilot then reads the named companies' job boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Workday and the other ATS connectors) and your career pages. Only real postings from those boards are returned; a company with nothing open is reported as "none open".
  - Results are normal jobs, so they can be applied for like any other job. The closed-job check still runs before anything is sent.
  - A suggested careers URL is used only if that page really loads and lists jobs.
- **Local AI models** (Settings → AI → Local model on your PC). Works with Ollama and LM Studio (any OpenAI-compatible server). Find models, pick one, and cover letters, resume tailoring, answers, interview prep and plain-English search use it. Your data only goes to the address you enter. See docs/LOCAL_AI.md.
- **Country filter**: on the Find jobs page, and per campaign ("Countries"). Detected from the job's location text; postings with no clear location are left out of a country filter rather than guessed.
- **Date and month filters**:
  - "Posted within": last 24 hours, 3, 7 or 30 days (campaigns and Find jobs)
  - "Only in these months" (campaigns)
  - "Found within": last hour, 6 hours or 24 hours (Find jobs), based on when ApplyPilot first saw the job. Job boards don't report a reliable time of day, so this is the honest "time" filter.
- **Where applications came from**:
  - Clicking *Found*, *Applied* or *Queued* on a campaign opens its details.
  - The *Sources* tab shows, per job board, how many jobs it returned in the last run, how many were applied for and how many are queued, and any errors.
  - The *Applied* and *Queued* tabs list each application with its source.
  - The review queue has a Source column.
- **Never apply at your current employer.** Companies you work for today are skipped, from your profile's current company and open-ended work history. Manual Apply is blocked there too, with a message. Former employers are not blocked.
- **Closed postings are removed from your queue.** Queued jobs are re-checked (up to 20 per run, each at most every 6 hours). A posting that has been taken down is moved to skipped with a note, so you never review a job that's no longer open.
- New module `electron/jobFilters.js` (country, dates, employer), `electron/discover.js` (plain-English search) and local model support in `electron/ai.js`.

### Changed
- Settings → AI has a provider switch: *Claude (cloud, your key)* or *Local model (on your PC)*. Both count against your plan's daily AI allowance.

### Known limits
- Visa sponsorship is read from the posting's text. ApplyPilot can't verify an employer's visa policy beyond what the posting says.
- Plain-English search quality depends on the model. Small local models can miss company names or role words; check the summary (it lists the companies it searched).
- The e2e run uses a mock local model for the plan and the live sources for the search. Live discovery took about 20 seconds for two companies in testing.

### Tests
- Desktop e2e: 71/71 (new checks: campaign filters, Sources drill-down, local AI settings, Find jobs filters).
- New `scripts/features.test.js`: 17/17 (country, date, month and time windows; current-employer rule; company and role matching; local model calls against a mock server).
- Apply self-test 8/8, cloud sync 12/12, cloud server 110 passing (1 live test skipped).

## [1.3.0] — 2026-10-11

### Added
- **Watch any company's careers page** (Settings → Career pages). Paste a careers link, ApplyPilot works out how the page lists its jobs and previews them before you add it:
  - Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee boards are read from their public APIs, so those jobs are auto-apply capable
  - Workday sites are read through Workday's public job endpoint
  - pages with schema.org JobPosting data are read directly
  - as a last resort, job-looking links on the page are used
  - watched pages are included in every search and campaign; each page can be refreshed, switched off or removed
  - new modules: `electron/careerPages.js` and the `careerpages` connector. Verified live against Lever, Ashby, Greenhouse, Workday and plain-HTML pages.
- **Interview calendar export**: "Add to calendar" writes an .ics file with a one-hour reminder (Applications drawer).
- **Diagnostics and update check** (Settings → Data & privacy): "Export diagnostics" saves versions, settings (no keys), counts and recent errors, with no profile, resume or application contents. "Check for updates" reports the installed version.
- **Local log file** at `%APPDATA%\ApplyPilot\logs\applypilot.log` (rotating, 2 MB) for engine, cloud and crash messages.
- **New logo: "check-plane"**, a check mark whose long stroke is a paper plane. See docs/BRAND.md.
- **Mobile projects** (see docs/MOBILE.md, docs/IOS.md, docs/ANDROID.md):
  - Capacitor 8 wraps the web app as `web/client/android` and `web/client/ios`
  - the iOS project builds and launches in the Simulator on GitHub's macOS runners (`.github/workflows/ios.yml`, branch `ci/ios-build`)
  - the Android debug APK builds locally
- **ApplyPilot Cloud (server)**:
  - native sign-in tokens for the mobile apps (`POST /api/auth/google` with `client:'native'`), with per-session separation from browser cookies
  - a cloud watchlist: saved searches the server re-runs hourly, with a consent step and privacy text; new matches are queued for the app
  - ghost-job signal: `firstSeen`, repost detection and job history per id, with no user data
  - web and mobile push (Web Push, FCM, APNs) that never carries job content; each push target is removed with its session
  - 110 server tests pass (1 live test skipped)

### Changed
- Settings → "Company boards" is now **Career pages**. The ATS-slug adder stays below it.
- The window minimum, taskbar fit and version are unchanged from 1.2.0.

### Not finished in 1.3.0 (tracked in docs/STATUS.md)
- The browser extension and desktop bridge exist as files but are not connected to the app yet (no pairing screen, no `startBridge` in the main process).
- The Workday, Recruitee and other new ATS connectors are not registered as standalone sources; Workday is used only by the career-pages reader.
- The Android and iOS apps are not published (no store listings, no signing secrets set, no Sign in with Apple yet). Mobile e2e was not run for this release.

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
