# Microsoft Store listing: ApplyPilot

Paste these into **Partner Center → Apps and games → ApplyPilot → Store listings → English (United States)**.
Limits are Partner Center's; every field below fits them.

## Product name (reserved name)

ApplyPilot

## Short description (≤ 1,000 chars; shown at the top of the listing)

Search every job board at once and apply faster. ApplyPilot finds matching jobs across 25+ sources and 700+ company career pages, ranks each against your resume, and fills applications for you in your own browser, with a review queue so nothing is sent without you. Your data stays on your PC.

## Description (≤ 10,000 chars)

ApplyPilot runs your job hunt like a campaign.

**Search everything at once**
- 25+ live job sources and 729 verified company career boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee), searched in parallel with duplicates removed.
- A directory of 252 job platforms with one-click searches: Naukri, LinkedIn, Indeed, Wellfound, Internshala, government boards and more.
- Every job gets an explainable match score: title, skills, experience, location and freshness, with matched and missing skills.

**Campaigns with the right resume**
- Run several campaigns in parallel, one per target role, each with its own resume, filters, minimum match score and daily cap.
- Upload multiple resumes; ApplyPilot sends the best one for each job and shows which resume gets interviews.

**Applications filled for you, safely**
- Fills Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee forms in your own Edge or Chrome.
- LinkedIn, Indeed and Naukri use assisted mode: we fill, you click submit, so your accounts stay safe.
- Review-first by default, a cancel window before any auto-submit, daily and per-company caps, and a dry-run mode.
- Screening questions are answered from your profile and saved answers. Unknown questions wait for you; nothing is guessed.

**Only jobs you can actually take**
- Scam detection (fees, WhatsApp/Telegram recruiting, too-good earnings) blocks a posting before any data leaves your PC.
- Filters for language, region-restricted remote jobs and visa sponsorship.

**AI studio (bring your own Claude key, optional)**
- ATS score with missing keywords, truthful tailored resumes (a verifier removes anything not in your original), cover letters, interview prep and referral messages.

**Track everything**
- Drag-and-drop pipeline (Saved, Applied, Interview, Offer), notes, follow-up reminders, proof screenshots and CSV export.
- Referral finder from your LinkedIn connections export (stays on your PC).

**Private by design**
- No account needed. All data stays on your PC; API keys are encrypted with Windows. Export or delete everything in one click.
- Optional phone companion with end-to-end encrypted sync.

Free plan included. Pro, a 90-day Sprint Pass and Lifetime unlock parallel campaigns, more resumes and full autopilot on supported application systems.

Requires Microsoft Edge (pre-installed on Windows) or Google Chrome.

## What's new in this version

Take the `## [x.y.z]` section of CHANGELOG.md (`npm run release -- notes`), shortened to its headline bullets.

## Product features (up to 20, ≤ 200 chars each)

1. Search 25+ job sources and 729 company career boards in parallel
2. Explainable match score for every job, with matched and missing skills
3. Parallel campaigns, one per role, each with its own resume
4. Auto-fill on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee
5. Assisted mode for LinkedIn, Indeed and Naukri: we fill, you submit
6. Review queue, cancel window and daily caps before anything is sent
7. Answer bank: answer a screening question once, reuse it everywhere
8. Scam and eligibility checks before any data leaves your PC
9. Truthful AI-tailored resume PDF per job (bring your own Claude key)
10. Application tracker with reminders, proof screenshots and CSV export
11. Resume A/B analytics: see which resume gets interviews
12. Local-only data, no account, export or delete everything

## Search terms (up to 7, ≤ 30 chars each, ≤ 21 words total)

job search · auto apply · job application · resume · career · job tracker · cover letter

## Category

Primary: **Productivity**. Secondary: **Business**.

## Contact and URLs

| Field | Value |
|---|---|
| Privacy policy URL (required: the app uses the internet) | https://applypilot.app/privacy (publish docs/PRIVACY.md there) |
| Website | https://applypilot.app |
| Support contact | support@applypilot.app |
| Copyright | Copyright © 2026 ApplyPilot |
| Additional license terms | https://applypilot.app/terms (docs/TERMS.md) |

## Screenshots (desktop, 1440×900 PNG; 1366×768 minimum, up to 10)

Upload in this order from `docs/screenshots/` (captions ≤ 200 chars):

| # | File | Caption |
|---|---|---|
| 1 | 04-dashboard.png | Your whole job hunt at a glance: stats, pipeline and live activity |
| 2 | 12-find-jobs.png | Search every job source at once, ranked by match |
| 3 | 13-job-detail.png | Explainable match score with matched and missing skills |
| 4 | 07-campaigns-running.png | Parallel campaigns, one per role, each with its own resume |
| 5 | 08-review-queue.png | Approve matches in bulk before anything is sent |
| 6 | 09-needs-you.png | Pre-filled applications waiting for your final click |
| 7 | 10-answer-bank.png | Answer a screening question once, reuse it everywhere |
| 8 | 11-applications.png | Track every application with proof screenshots |
| 9 | 16-ai-studio.png | ATS score, truthful tailoring and cover letters with your own Claude key |
| 10 | 17-settings-data.png | Your data stays on your PC: export or delete everything |

Retake them with `node scripts/e2e.js --exe release/win-unpacked/ApplyPilot.exe --screenshots` after the new logo lands
so the sidebar mark matches the Store tiles.

## Store logos

- Tiles inside the package: `build/appx/*.png`, rendered from `assets/brand/png/icon-1024.png` by
  `node scripts/release.js appx-assets`.
- Partner Center → Store listing → **Store logos**: upload `assets/brand/png/icon-1024.png` as the 1:1 box art
  (300×300 minimum), and optionally a 2:3 poster (720×1080) built from `assets/brand/wordmark.png`.

## Properties, age rating and pricing

- **Age rating (IARC questionnaire):** utility app; no violence, user-generated content shared with others, or
  purchases of physical goods. Answer "yes" to "shares user's personal information with third parties" only for the
  job applications the user sends; expected rating: 3+/Everyone.
- **System requirements:** Windows 10 version 1809 (17763) or later, x64; internet connection; Microsoft Edge or Chrome.
- **Pricing:** Free. Paid plans are sold through Dodo Payments inside the app (allowed for non-game apps under Store
  policy 10.8.2). Do not use Store in-app purchases.
- **Markets:** all.
- **Privacy:** "This app accesses, collects or transmits personal information": **Yes** (profile data is sent to
  employer forms and, when the user opts in, to Anthropic and Dodo Payments), so the privacy URL is mandatory.

## Package

Upload `release/ApplyPilot-Store-<version>.appx`, built by CI (`applypilot-windows` artifact) or locally with
`npm run dist:store`, after setting the Partner Center identity (see docs/PUBLISHING.md §2). The Store signs it;
no certificate is needed. The Store build has no self-updater: the Store delivers updates.

Notes for certification (Submission options → Notes for certification):

> ApplyPilot is an Electron desktop app (runFullTrust). It drives the user's installed Microsoft Edge or Chrome via
> the DevTools protocol to fill job applications the user approves. No account or sign-in is needed to test:
> finish the short onboarding ("Skip for now" on the resume step), then open Find jobs and search "software engineer".
> Paid features can be tried with the 7-day Pro trial that starts when onboarding finishes.
