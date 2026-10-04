# Changelog

All notable changes to ApplyPilot. Format based on [Keep a Changelog](https://keepachangelog.com/).

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
