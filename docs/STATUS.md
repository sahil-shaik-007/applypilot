# ApplyPilot — status (v1.0.0, 3 Oct 2026)

**Installer:** `release/ApplyPilot-Setup-1.0.0.exe` (112 MB, per-user NSIS install). Run `npm run dist` to rebuild.

## Verified working (tested end-to-end in the real app)
- Onboarding wizard → resume import (name, email, phone, links, years, 19 skills) → profile → first campaign → 7-day Pro trial.
- Live search: 19 free sources in parallel, about 25–35 s cold, duplicates removed across sources, every job given an explainable match score.
- Campaign in review-queue mode: search → score → 50 ranked matches queued with the right resume.
- Auto-apply engine (Edge), three applications in parallel on real Greenhouse, Lever and Ashby forms:
  - Resume uploaded and 5–12 fields filled per form.
  - Unknown questions saved to the Answer bank.
  - Each job handed to the user as "Needs you" within 45–75 s, without blocking the campaign.
  - Nothing was submitted during testing.
- Licensing:
  - Offline Ed25519 keys activate; tampered keys are rejected.
  - A bogus key sent to the live Dodo Payments API returns "License key not found."
  - Removing a key falls back to the trial or Free plan.
- AI request path for all models; errors map to clear messages. A real call still needs the user's own Anthropic key.
- The packaged `.exe` boots for a fresh user, finds Edge, loads 28 connectors, 729 company boards and 252 platforms, and runs live searches.

## Before you sell
1. Create Dodo Payments products and paste the checkout links into `src/config.js` (see [SELLING.md](SELLING.md)).
2. Back up `keys/license-private.pem` somewhere safe (git-ignored, never shipped).
3. Optional: a code-signing certificate, or publish via the Microsoft Store, to avoid the SmartScreen warning.
4. Optional: add a GitHub `publish` block for auto-updates.

## Known limitations
- Real AI output was not tested here (no API key on this machine).
- SmartRecruiters forms are often behind DataDome bot protection, so they're handed to the user.
- Multi-page wizards (Workday) are pre-filled one page at a time.
- Free sources' coverage varies by query. Remotive's public API now returns very few jobs; jobdata's free tier is about 10 requests/hour.
- LinkedIn, Indeed and Naukri are assisted-only by design (their terms forbid bots). For LinkedIn and Indeed listings, add a JSearch key.
- Some India unicorns (PhonePe, Zepto, Flipkart, Dream11) use their own career sites, not a supported ATS.
