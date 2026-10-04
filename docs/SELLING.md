# Selling & distributing ApplyPilot

A step-by-step playbook for a solo developer in India. Background research and sources are in [MARKET_RESEARCH.md](MARKET_RESEARCH.md).

## 1. Pricing (already built into the app)

| Plan | USD | INR | Limits enforced in-app |
|---|---|---|---|
| Free | $0 | ₹0 | 1 campaign, 2 resumes, 10 applications/day, fill-only (no auto-submit), 5 AI actions/day |
| Pro | $12/mo or $79/yr | ₹499/mo or ₹2,999/yr | 10 parallel campaigns, 50 resumes, 120/day, auto-submit, 6 browser tabs, unlimited AI, analytics |
| Sprint Pass | $29 once (90 days) | ₹1,199 | Same as Pro, no auto-renew |
| Lifetime | $149 (launch $99) | ₹5,999 (launch ₹3,999) | Pro + 10 tabs |

Limits live in `electron/license.js` (`PLANS`); the pricing cards are in `src/config.js` (`PRICING`). Safety features are never paywalled.

Users pay Anthropic directly for AI (their own key), so your cost per user is near zero.

## 2. Set up payments with Dodo Payments (recommended)

1. Sign up at dodopayments.com and complete individual KYC (PAN + bank account).
2. Create products and **enable license keys** on each:
   - `ApplyPilot Pro (monthly)`, `ApplyPilot Pro (yearly)`: subscription, activation limit 2.
   - `ApplyPilot Sprint Pass (90 days)`: one-time, key expiry 90 days, activation limit 2.
   - `ApplyPilot Lifetime`: one-time, activation limit 3.
   
   The app maps the product name to a plan: names containing "Lifetime" → lifetime, "Sprint" → sprint, anything else → pro.
3. Copy each product's hosted checkout link into `src/config.js` → `CONFIG.checkout`, plus the customer-portal link (`customerPortal`) for one-click cancellation.
4. Rebuild (`npm run dist`). When a buyer pastes their key under **Settings → Plan & license**, the app calls Dodo's public `/licenses/activate` endpoint. It re-validates on every launch with a 14-day offline grace period. A refunded or revoked key quietly drops back to Free, and user data is never locked.

To test against Dodo's test mode, launch with `APPLYPILOT_DODO_BASE=https://test.dodopayments.com`.

**Fallback provider:** Polar.sh also has license keys and pays out to India. Swap the two `fetch` calls in `electron/license.js`.

## 3. Offline keys (giveaways, influencers, B2B deals)

```bash
npm run license:issue -- friend@example.com lifetime
```

```bash
npm run license:issue -- reviewer@example.com pro 30
```

Keys are Ed25519-signed with `keys/license-private.pem`. **Back that file up and never share it.** If you lose it you can't issue new offline keys. If you rotate it (`license:keys`), every key you already issued stops working.

## 4. Ship the installer

1. Bump `version` in `package.json`.
2. Run `npm run dist` to produce `release/ApplyPilot-Setup-x.y.z.exe`.
3. Distribute it:
   - **GitHub Releases** (free). Add a `publish` block to `package.json` → `build` and `electron-updater` auto-updates users on every launch:
     ```json
     "publish": [{ "provider": "github", "owner": "<you>", "repo": "applypilot-releases" }]
     ```
   - **Microsoft Store** (free individual developer account). Add `appx` to `build.win.target`; the Store signs the package, so users see no SmartScreen warning. This is the best first channel.
   - **winget**: submit a manifest pointing at your GitHub release.
4. **Code signing:** unsigned installers show a "Windows protected your PC" warning; users click *More info → Run anyway*. Once revenue justifies it, buy an OV code-signing certificate (about $130–220/yr) and set `CSC_LINK` and `CSC_KEY_PASSWORD` before `npm run dist`.

## 5. Go-to-market checklist

- Landing page with a 60-second demo video (record a campaign filling the queue, then approving 10 jobs).
- Post where job seekers are: r/developersIndia, r/cscareerquestions, r/jobs, r/recruitinghell, LinkedIn, YouTube Shorts and Instagram Reels ("I applied to 50 jobs in 10 minutes, here's my interview rate").
- ProductHunt launch on a Tuesday, with the lifetime launch price as the hook.
- College placement cells: offer free Pro for final-year students in exchange for a testimonial.
- Affiliate program: Dodo supports discount codes; give career coaches and YouTubers 30%.
- Lead with the differentiators competitors lack: **local-only data, no subscription traps, resume A/B analytics, no account-ban risk.**

## 6. Legal basics

- Add a privacy policy (all data stays on the device; no telemetry) and terms of use (users are responsible for the accuracy of their applications and for complying with each job site's terms).
- Keep the respectful defaults: review-first mode, daily caps, the per-company cap, and no auto-submit on LinkedIn, Indeed or Naukri.
- Some free job sources ask for attribution (Remotive, Remote OK, Rise, Jobicy). The app shows "via <source>" on every job card, and keeps your About page credits.
