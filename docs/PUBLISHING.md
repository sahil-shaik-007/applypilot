# Publishing ApplyPilot: launch checklist

An ordered "do this, then this" list for a solo developer in India. Costs and rules were checked in October 2026; re-check
anything marked *(verify)* on the day you do it. Pricing and payments background: [SELLING.md](SELLING.md).

**Fastest path to first sale (about 3–5 days):** §0 → §1 (website and legal) → §2 (payments) → §3 (GitHub Releases
with auto-update) → §4 (Microsoft Store) → §5 (winget). The cloud, extension and mobile apps (§6–§9) can follow.

## Costs at a glance

| Item | Cost | When |
|---|---|---|
| Domain `applypilot.app` (or similar; `.app` is HTTPS-only) | about $15–20/yr | Day 0 |
| GitHub public repo for releases + Pages | free | Day 0 |
| Microsoft Store individual developer account | **free** (since Sept 2025) | Day 0 |
| winget | free | after first release |
| Dodo Payments | no monthly fee; about 4% + 40¢ per sale (+1.5% international, +0.5% subscriptions) *(verify)* | Day 1 |
| Code signing (optional, see §3.4) | $0 (Store) or about $120–290/yr (OV certificate) | later |
| Cloud server: Render Starter + 1 GB disk, or Fly.io | about $7.25/mo (Render) or $2–5/mo (Fly) | when you launch phone/web |
| Google OAuth client | free | with the cloud |
| Chrome Web Store | $5 once | any time |
| Edge Add-ons | free | any time |
| Google Play | $25 once | 3+ weeks before Android launch |
| Apple Developer Program | $99/yr (₹ price shown at checkout) | before iOS launch |

---

## 0. Decide and reserve (Day 0, about 1 hour)

1. **Buy the domain.** Check that `applypilot.app` is free (Cloudflare Registrar, Porkbun or Namecheap). Put DNS on
   Cloudflare (free); you'll use its email routing too. If you choose another domain, search the repo for
   `applypilot.app` and update `src/config.js` (`website`, `supportEmail`, `cloudUrl`), `package.json` `homepage`,
   `store/**` and the docs.
2. **Support email.** Cloudflare → Email → Email Routing: forward `support@applypilot.app` to your Gmail (free). In
   Gmail, add it under *Send mail as* so replies come from that address.
3. **Create the public releases repo** `sahil-shaik-007/applypilot-releases` (public, with a README). Installers and
   auto-updates are served from it, so your source repo stays private. *Why:* electron-updater can't read a private
   repo without shipping a GitHub token inside the app, which anyone could extract.
4. **Create a fine-grained token** for CI: GitHub → Settings → Developer settings → Fine-grained tokens. Give it
   access to **only** `applypilot-releases`, with **Contents: Read and write**, and a 1-year expiry. Then save it as a secret:
   `gh secret set RELEASES_TOKEN --repo sahil-shaik-007/applypilot`.
5. **Reserve the Store name.** Sign up at <https://storedeveloper.microsoft.com> as an **individual** (free: ID +
   selfie verification). In Partner Center go to **Apps and games → New product → MSIX or PWA app** and reserve
   **ApplyPilot** (or "ApplyPilot: Job Auto-Apply" if it's taken).

## 1. Website and legal pages (Day 0–1)

Payment providers and every store reject listings without live privacy and terms pages. Dodo also reviews your website.

1. Host a one-page site at `https://applypilot.app` with:
   - what the app does, 3–4 screenshots, pricing (from `src/config.js` → `PRICING`) and a download button linking to
     `https://github.com/sahil-shaik-007/applypilot-releases/releases/latest`
   - `/privacy`: [PRIVACY.md](PRIVACY.md). Add sections for the cloud sync and the browser extension once they
     launch.
   - `/terms`: [TERMS.md](TERMS.md)
   - `/refund`: a refund policy, for example "full refund within 14 days, email support@applypilot.app". Dodo
     requires one.
   - `/support`: the support email address and an FAQ (SmartScreen warning, how to activate a key, how to cancel)
   - your legal name and city, plus the contact email in the footer (merchant review needs it)

   Cheapest option: GitHub Pages on the public `applypilot-releases` repo (Settings → Pages → custom domain
   `applypilot.app`), or Cloudflare Pages. Both are free.
2. **Analytics: none in the app.** The privacy policy says "no analytics, no telemetry", so keep it that way. Use
   GitHub release download counts, Partner Center analytics, Dodo's dashboard and the store consoles. On the website,
   use cookieless Cloudflare Web Analytics if you want visitor counts, and say so in a "Website" line in `/privacy`.

## 2. Payments with Dodo Payments (Day 1; KYC can take 1–3 days)

1. Sign up at <https://dodopayments.com>, complete individual KYC (PAN, Aadhaar/ID, bank account) and add the
   website URL from §1.
2. Create four products, each with **License keys** enabled. The app maps names to plans: a name containing "Lifetime"
   becomes lifetime, "Sprint" becomes sprint, anything else becomes pro.

   | Product | Type | Price | Key activations |
   |---|---|---|---|
   | ApplyPilot Pro (monthly) | subscription | $12 / ₹499 | 2 |
   | ApplyPilot Pro (yearly) | subscription | $79 / ₹2,999 | 2 |
   | ApplyPilot Sprint Pass (90 days) | one-time, key expires in 90 days | $29 / ₹1,199 | 2 |
   | ApplyPilot Lifetime | one-time | $99 launch / $149 | 3 |
3. Copy each product's **hosted checkout link** and the **customer portal** link into `src/config.js`:
   ```js
   checkout: { proMonthly: 'https://checkout.dodopayments.com/buy/pdt_…', proYearly: '…', sprint: '…', lifetime: '…' },
   customerPortal: 'https://…',
   ```
4. Test in test mode: run the app with `APPLYPILOT_DODO_BASE=https://test.dodopayments.com`, buy with a test card,
   paste the key under **Settings → Plan & license**, then refund it and check the app drops back to Free on the
   next launch.
5. Back up `keys/license-private.pem` (password manager plus an offline copy). Without it you can't issue offline keys.

## 3. Windows: GitHub Releases with auto-update (Day 1–2)

Already configured in this repo:

- `package.json` → `build.publish` points at **github `sahil-shaik-007/applypilot-releases`**. electron-builder bakes
  `resources/app-update.yml` into the app and writes `latest.yml` and the `.blockmap` (for differential downloads) next
  to the installer. `electron/main.js` calls `autoUpdater.checkForUpdatesAndNotify()` on every launch of a packaged build.
- `.github/workflows/windows.yml` runs on every push and PR. It runs `npm ci`, the UI build, the apply-engine
  self-test, a quick E2E (informational), then packages NSIS and APPX, verifies them with `scripts/release.js check`,
  renders the winget manifests and uploads everything as the `applypilot-windows` artifact.
- `.github/workflows/web.yml` runs the cloud server tests, the PWA build, and a Docker image build with a health check.
- `.github/workflows/release.yml` runs on a `v*` tag. It checks that the tag matches the version and that
  CHANGELOG.md has notes, then runs both workflows and creates the GitHub Release with
  `ApplyPilot-Setup-x.y.z.exe`, `.blockmap` and `latest.yml`. The release goes to `applypilot-releases` when
  `RELEASES_TOKEN` is set, otherwise to the private repo (archive only: apps can't update from it).

### 3.1 Cut a release

```powershell
# 1. write the "## [1.2.1] — 2026-10-12" section in CHANGELOG.md and commit it
npm run release -- prepare 1.2.1      # bumps package.json + lock, commits "release: v1.2.1", tags v1.2.1
git push origin main --follow-tags    # starts .github/workflows/release.yml
gh run watch                          # about 15 min
```

Rehearse without a tag first: **Actions → release → Run workflow** (leave "publish" off). It builds everything and
prints where it would upload.

Local equivalents: `npm run dist` (NSIS installer), `npm run dist:store` (APPX), `npm run release:check`
(verifies the installer, `.blockmap`, `latest.yml` hash and size, and `app-update.yml`).

### 3.2 Check that auto-update works (once, with your first public release)

1. Install `vX.Y.Z` from the public release.
2. Release `vX.Y.Z+1`.
3. Start the installed app. Once the download finishes, Windows shows a notification that an update is ready, and the
   update installs when you quit the app. To check without waiting for the notification, look for the new installer in
   `%LOCALAPPDATA%\applypilot-updater\pending\`.

### 3.3 Alternatives to the public releases repo (documented, not configured)

- **Private repo plus token in the app** (`"private": true` and `GH_TOKEN` at runtime). **Don't do this**: the token
  ships inside every install.
- **Your own server** (`"provider": "generic", "url": "https://applypilot.app/updates"`): upload `latest.yml`,
  `.exe` and `.blockmap` there, for example to Cloudflare R2. Use it if you ever leave GitHub.

### 3.4 Code signing in 2026 (fixes "Windows protected your PC")

| Option | Cost | Works for an individual in India? | Notes |
|---|---|---|---|
| **Microsoft Store (MSIX)** | free | yes | The Store signs the package; Store installs show no SmartScreen warning. **Do this first (§4).** |
| **Azure Artifact Signing** (formerly Trusted Signing) | about $10/mo | **No (Oct 2026)**: public-trust certificates go to individuals in the USA and Canada and organizations in US/CA/EU/UK only | Re-check <https://learn.microsoft.com/azure/artifact-signing/> later. CI already supports it via `AZURE_*` secrets and variables (see `scripts/release.js`). |
| **OV certificate, cloud HSM**: Certum "Standard Code Signing in the Cloud" (issues to individuals), SSL.com eSigner, Sectigo | about $120–290/yr | yes (ID + address verification) | Since March 2026 certificates last at most 458 days. The key must sit in an HSM or token, so there's no `.pfx` to put in CI. Sign locally with the vendor's tool (Certum SimplySign, SSL.com CodeSignTool) or use `win.signtoolOptions.sign` with a custom script. |
| **EV certificate** | $250–500/yr | yes | No longer skips SmartScreen reputation (Microsoft changed this in 2024). Not worth the premium. |
| **Unsigned** (now) | $0 | n/a | Users click *More info → Run anyway*. The warning fades as the file builds download reputation. |

If you buy a certificate that comes as a `.pfx` (rare now), save it as secrets and every CI build is signed:
`gh secret set CSC_LINK < cert.pfx.base64` and `gh secret set CSC_KEY_PASSWORD`.

## 4. Microsoft Store (Day 2; certification usually takes 1–3 business days)

1. Partner Center → your app → **Product management → Product identity**. Copy three values into GitHub repository
   variables (not secrets), which CI uses for the Store package:
   ```powershell
   gh variable set APPX_IDENTITY_NAME --body "12345SahilShaik.ApplyPilot"           # Package/Identity/Name
   gh variable set APPX_PUBLISHER --body "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"  # Package/Identity/Publisher
   gh variable set APPX_PUBLISHER_DISPLAY_NAME --body "Sahil Shaik"                 # Package/Properties/PublisherDisplayName
   ```
   Also replace the `TODO` placeholders in `package.json` → `build.appx` with the same values, so local
   `npm run dist:store` builds are Store-ready too.
2. Run the release (or **Actions → windows → Run workflow**). From the `applypilot-windows` artifact take
   `ApplyPilot-Store-x.y.z.appx`. It's built from the same app minus `app-update.yml`, so it never self-updates; the
   Store delivers updates.
3. Partner Center → **Start your submission**:
   - **Pricing and availability:** Free, all markets.
   - **Properties:** category Productivity; privacy policy URL; system requirements (Windows 10 1809+, x64).
   - **Age ratings:** fill the IARC questionnaire (expect 3+).
   - **Packages:** upload the `.appx`.
   - **Store listings:** paste from [store/microsoft-store/listing.md](../store/microsoft-store/listing.md) and upload
     the screenshots it lists.
   - **Notes for certification:** paste the text from the listing file.
4. Submit. Payments for Pro go through Dodo, not Store in-app purchase; the Store allows its own payment system for
   non-game apps (policy 10.8.2 *(verify)*).
5. For later versions, upload the new `.appx` to a new submission. The version must increase; electron-builder
   uses `x.y.z.0`.

Tile images are in `build/appx/` (rendered from the new logo by `node scripts/release.js appx-assets`; re-run it if
the logo changes).

**Build the `.appx` in CI, not locally.** electron-builder runs the `makeappx.exe` from its downloaded `winCodeSign`
bundle. On the dev PC (Windows 11 build 26220, no Windows SDK) that copy fails with "side-by-side configuration is
incorrect" (`spawn UNKNOWN`). Also, without Developer Mode, unpacking the bundle hits symlink errors (harmless). The
`windows-latest` runner builds it fine (about 30 s). An unsigned `.appx` can't be installed by double-click; that's
expected, since the Store signs it.

## 5. winget (Day 2–3, after the first **public** release)

Follow [store/winget/README.md](../store/winget/README.md): `winget install Microsoft.WingetCreate`, then
`wingetcreate submit` with the manifests from the release artifact (`winget/`). Package id
`ApplyPilot.ApplyPilot`. Moderators merge in a few days. For each later version, run
`wingetcreate update ApplyPilot.ApplyPilot --version x.y.z --urls <installer url> --submit`.

## 6. Cloud (phone and web companion) (when you launch mobile)

1. **Pick a host.**
   - **Render:** New → Blueprint → this repo, Blueprint path `web/render.yaml`. Starter instance ($7/mo) plus
     1 GB disk ($0.25/mo). Render needs access to the private repo (GitHub app).
   - **Fly.io:** `fly launch --no-deploy --copy-config --config web/fly.toml`, then
     `fly volumes create applypilot_data --size 1 --config web/fly.toml` and `fly deploy . --config web/fly.toml`.
     About $2–5/mo with auto-stop.
2. **Domain:** add `app.applypilot.app` as a custom domain on the service, then a Cloudflare CNAME to the host's
   target with the proxy **off** (DNS only), so the host issues the TLS certificate.
3. **Google OAuth client:** Google Cloud Console → new project → OAuth consent screen (External, app name, support
   email, privacy URL, authorized domain `applypilot.app`; scopes openid/email/profile only, so no Google
   verification is needed beyond optional branding). Then Credentials → **OAuth client ID → Web application** →
   Authorized JavaScript origin `https://app.applypilot.app`. Full steps: [web/README.md](../web/README.md).
   - Android and iOS apps need their own client IDs (Android: package name + SHA-1 of the **Play app-signing**
     key from Play Console → App integrity). List them in `GOOGLE_CLIENT_IDS` (comma-separated) on the server.
4. **Env vars on the host:**

   | Var | Value |
   |---|---|
   | `APP_ORIGIN` | `https://app.applypilot.app` |
   | `GOOGLE_CLIENT_ID` | the web client ID |
   | `GOOGLE_CLIENT_IDS` | extra Android/iOS client IDs (comma-separated), when the apps launch |
   | `NODE_ENV`, `DATABASE_PATH`, `PORT`, `TRUST_PROXY` | preset in render.yaml / fly.toml |

   Never set `AP_DEV_LOGIN` in production (the server refuses to start).
5. Deploy, open `https://app.applypilot.app/api/health`, sign in with Google on your phone, and link the desktop app.
6. Back up the SQLite volume. It holds only ciphertext, but losing it loses users' synced data: on Render, use disk
   snapshots; on Fly, `fly volumes snapshots`.

## 7. Browser extension (any time; review usually takes 1–3 days)

1. `node extension/tools/package.js` builds `extension/dist/applypilot-extension.zip`.
2. **Chrome Web Store:** <https://chrome.google.com/webstore/devconsole>, $5 one-time fee, 2-step verification
   required. Fill in:
   - single purpose: "Save job postings to the ApplyPilot desktop app and autofill application forms"
   - permission justifications for activeTab, scripting, storage and `http://127.0.0.1/*` (talks only to the local
     desktop app)
   - data-use disclosures: personal info is used to fill forms the user opens and isn't sold or transferred
   - privacy URL, 1280×800 screenshots, 128 px icon
3. **Edge Add-ons:** Partner Center → Microsoft Edge program (free, same account as the Store). Upload the same zip
   and reuse the listing.

## 8. Android: Google Play (start 3+ weeks before you want it live)

1. Create a Play Console **personal** account at <https://play.google.com/console> ($25 one-time). It needs identity
   verification and a verified Android phone.
2. **New personal accounts must run a closed test with at least 12 testers opted in for 14 straight days** before
   applying for production. Start this first; it's the longest wait in this whole list.
3. **Signing:** create the upload keystore once and back it up (losing it means a support reset):
   ```powershell
   keytool -genkeypair -v -keystore applypilot-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Use Play App Signing (the default): Google holds the app key and you sign uploads with this key.
   `web/client/android/app/build.gradle` reads `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` (env or Gradle properties). Store them as GitHub secrets
   (the keystore base64-encoded) for `.github/workflows/android.yml`.
4. Build an **AAB** (`bundleRelease`) and upload it to Internal testing, then Closed testing.
5. Fill in **App content**: privacy policy, Data safety form (account email, encrypted user data, nothing shared or
   sold), ads (none), target audience 18+, content rating.
6. **Payments:** Play requires Google Play Billing for digital goods. In India, user-choice billing is allowed *(verify)*.
   The simplest compliant launch is a free companion app with no purchase links, where Pro is bought on the website or
   desktop.
7. After 14 days, go to **Dashboard → Apply for production**.

## 9. iOS: App Store

1. Join the Apple Developer Program at <https://developer.apple.com/programs/> ($99/yr, as an individual). You need an
   Apple ID with 2FA; approval takes about 1–2 days.
2. **Sign in with Apple is required:** the app offers Google sign-in, so guideline 4.8 requires an equivalent option,
   and Sign in with Apple is the only accepted one. **Gap:** the server only verifies Google ID tokens
   (`web/server/routes/auth.js`), so an Apple ID-token verifier and the iOS button are needed before submitting.
3. Signing: in the developer portal create the App ID (`capacitor.config.json` appId) with the Sign in with Apple
   capability, a distribution certificate, and an App Store provisioning profile. For CI, add an App Store Connect API
   key (`.p8`, key ID, issuer ID) as secrets for `.github/workflows/ios.yml`. Building needs macOS: the GitHub macOS
   runner or a Mac.
4. App Store Connect → New app. Add:
   - privacy policy URL
   - **App Privacy** labels: email and name for the account; user content end-to-end encrypted
   - screenshots (6.9" iPhone)
   - a demo account or dev-login instructions for review, since review needs to get past sign-in
5. **Payments:** don't sell or link to Pro inside the iOS app unless you add In-App Purchase (guideline 3.1.1). Launch
   as a free companion.
6. TestFlight internal test, then Submit for review (usually 1–2 days).

## 10. Marketing launch (in the week after §1–§5)

1. **Before launch:** record a 60-second demo (a campaign filling the queue, then approving 10 jobs) and put it on the
   site and the Store listing. Write a launch post: "I built a job auto-apply app that never submits where sites forbid
   bots."
2. **Launch day** (Tuesday or Wednesday):
   - Product Hunt, with the Lifetime launch price ($99) as the hook
   - Show HN ("Show HN: ApplyPilot, a local-first job auto-apply desktop app")
   - r/developersIndia, r/cscareerquestions, r/jobs, r/SideProject (read each subreddit's self-promotion rules)
3. **Ongoing:**
   - LinkedIn posts and YouTube Shorts/Reels with real interview-rate numbers
   - college placement cells (free Pro for testimonials)
   - Dodo discount codes for affiliates (30% to career coaches)
4. **Every release:** update the changelog, tag, and post "what's new". Store and winget users get it automatically;
   installer users get it through auto-update.

---

## Secrets and variables used by CI (summary)

| Name | Kind | Needed for |
|---|---|---|
| `RELEASES_TOKEN` | secret | publishing releases to the public `applypilot-releases` repo (auto-update + winget) |
| `APPX_IDENTITY_NAME`, `APPX_PUBLISHER`, `APPX_PUBLISHER_DISPLAY_NAME` | variables | Store-ready `.appx` |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | secrets | optional `.pfx` signing |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (secrets) + `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` (variables) | both | optional Azure Artifact Signing, once available to you |
| `ANDROID_KEYSTORE_*`, App Store Connect API key | secrets | mobile workflows (see docs/MOBILE.md) |

Sources: Microsoft Store free individual registration ([Windows Developer Blog, Sept 2025](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/));
Azure Artifact Signing eligibility ([Microsoft Learn: code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options));
458-day certificate limit ([SSL.com](https://ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/));
Play 12-tester rule ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465));
Dodo fees ([dodopayments.com/pricing](https://dodopayments.com/pricing)); Render pricing ([render.com/pricing](https://render.com/pricing)).
