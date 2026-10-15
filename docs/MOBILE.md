# ApplyPilot mobile apps (iOS + Android)

**Goal:** the phone app does what the Windows app does, adapted to a phone:
- search every source
- run **campaigns** per role, each with its own resume
- score matches on the device
- **review queue**
- **apply inside the app with automatic form filling**, plus autopilot submit on allow-listed ATSs (with a cancel window)
- truthful tailored resume PDF
- answer bank, tracker, referrals, AI tools
- end-to-end encrypted sync with the desktop app

## Architecture

One codebase, two native apps. The UI is the React PWA in `web/client`, wrapped with **Capacitor 8**. The native projects are `web/client/android/` (Gradle) and `web/client/ios/` (Xcode). They share all features, so a bug is fixed once.

| Layer | Where | Owner |
|---|---|---|
| Screens and features (parity with desktop) | `web/client/src/pages`, `src/components`, `src/lib` (except `native*`) | mobile-features |
| Native bridge and in-app auto-fill | `web/client/src/native/**`, `web/mobile-autofill/**`, `web/client/runners/**` | mobile-native |
| Android project, signing, CI | `web/client/android/**`, `.github/workflows/android.yml` | android |
| iOS project, CI | `web/client/ios/**`, `.github/workflows/ios.yml` | ios |
| Server support for native clients (bearer auth, CORS for app origins, watchlist, push) | `web/server/**` | cloud |

Installed plugins (already in `web/client/package.json`; **don't run `npm install` there**, add requests to `web/client/DEPS-REQUESTED.md` instead):

| Purpose | Packages |
|---|---|
| Core and app lifecycle | `@capacitor/core`, `app` |
| Storage, files, device, network | `preferences`, `filesystem`, `device`, `network` |
| Notifications | `local-notifications`, `push-notifications`, `background-runner` |
| UI and feedback | `haptics`, `share`, `status-bar`, `splash-screen`, `keyboard`, `clipboard` |
| Browser and in-app browser | `browser`, `@capgo/inappbrowser` (WebView with `executeScript` + messaging) |
| Biometric unlock | `@capgo/capacitor-native-biometric` |
| Google sign-in | `@capgo/capacitor-social-login` |
| PDF generation | `pdf-lib` |
| Native projects and tooling | `@capacitor/android`, `@capacitor/ios`, `@capacitor/cli`, `@capacitor/assets` |

CapacitorHttp is enabled, so `fetch` goes through native HTTP (no CORS) inside the apps.

## Contract: `web/client/src/native/index.js` (mobile-native exports, mobile-features consumes)

Every function must be safe to call in a plain browser (PWA). It returns a no-op or browser fallback there.

```js
export const isNative: boolean;                       // Capacitor.isNativePlatform()
export const platform: 'ios' | 'android' | 'web';
export function apiBase(): string;                    // '' on web (same origin); configured cloud URL in apps
export async function authHeaders(): Promise<object>; // { Authorization: 'Bearer …' } in apps (token in secure storage); {} on web

// In-app auto-fill: opens the job's application page in an in-app WebView, injects the
// auto-fill engine, fills from the decrypted profile/answers/resume, and reports progress.
// mode 'review' never submits; 'auto' may submit ONLY on allow-listed ATSs after a cancel window
// and only if every required field is answered (same rules as the desktop engine).
export async function applyInApp({ job, profile, answers, resume /* {name, bytes:Uint8Array, mime} */,
  coverLetter, mode, onEvent /* ({type, message, data}) */ }): Promise<{ status, filledCount, unanswered, url }>;

export const notifications: { requestPermission(), notify({ title, body, data }), onTap(fn) };
export const background: { register(), lastRun(): Promise<number|null> }; // periodic campaign checks
export const biometric: { available(): Promise<boolean>, enable(dekRawBytes), unlock(): Promise<Uint8Array|null>, disable() };
export const share: { onIncoming(fn /* ({url, text}) */): unsubscribe };   // "Share to ApplyPilot" from LinkedIn/Naukri apps
export const haptics: { tap(), success(), warning() };
export async function openExternal(url): Promise<void>;
export async function saveFile({ name, bytes, mime }): Promise<void>;       // share sheet / downloads
```

## Safety rules (same as desktop, non-negotiable)

- Never auto-submit on LinkedIn, Indeed, Naukri, Glassdoor, Workday or unknown sites. Fill only.
- Never log in for the user, never touch password fields, never solve CAPTCHAs.
- Unknown required answers mean no submit; the question goes to the Answer bank.
- The scam/eligibility check runs before any data is injected into a page.
- A cancel window runs before every auto-submit.
- Keys: the DEK lives in memory. "Biometric unlock" stores it only in the platform keystore (Android Keystore / iOS Keychain) behind biometric auth. Never in Preferences or localStorage.

## Status of the contract (audited 2026-10-15, Android debug build; not yet run on a device)

| Item | State | Where | Notes |
|---|---|---|---|
| `applyInApp` | Implemented | `src/native/inapp.js`, `src/lib/applyFlow.js`, `src/native/autofill.bundle.js` | Uses the application's profile (own profile, else its campaign's, else default; a deleted profile falls back to the snapshot on the application, never to "Me"), that profile's answers and resume. Refuses to start when first name, last name, email, phone, city or country is missing. Review mode never submits. Autopilot submits only on allow-listed ATSs, after an in-page cancel window with a Cancel button, and only when every required field is answered. Nothing was exercised on a real device yet. |
| Notifications | Implemented (local) | `src/native/index.js` `notifications` | Local notifications and tap routing. Remote push (`@capacitor/push-notifications`) is installed but not used: it needs Firebase / APNs. |
| Background runner | Partial | `runners/background.js`, `vite.config.js` | Searches campaign queries and notifies; scoring happens when the app opens. The runner file was missing from the bundle before; the build now copies it to `dist/runners/`. Background results are not surfaced in the UI beyond the notification tap (`consumePending` has no caller). OS scheduling untested. |
| Biometric unlock | Partial | `src/native/secure.js` | Keystore/Keychain storage is implemented; there is no Settings toggle and no "Unlock with fingerprint/Face ID" button yet. The DEK must be exported from the passphrase unlock (`extractable: true`) to enable it. |
| Share in | Android: Implemented. iOS: Missing (URL scheme and Shortcut only) | `MainActivity.java`, `src/native/incoming.js`, `ShareReceiver` in `src/App.jsx` | A shared link is saved as a job in Applications and nothing is sent or applied. iOS needs a Share Extension target (Apple account required, see `docs/IOS.md`). |
| File save | Implemented | `saveFile` in `src/native/index.js` | Cache file plus the system share sheet; browser download on the web. |

## Build and run

- Web build: `cd web/client && npm run build`, then `npx cap sync`.
- Android: `cd web/client/android && .\build-local.ps1` (Windows, see `docs/ANDROID.md`), or `npx cap open android`. CI: `.github/workflows/android.yml`.
- iOS: on a Mac, `npx cap open ios`. CI: `.github/workflows/ios.yml` (macOS runner; simulator build; signed IPA once Apple secrets are added).

## Still needed from you for a store release

Nothing below can be done from this repo; none of it exists yet.

- [ ] **Google Play developer account** ($25 one-time). New personal accounts need a closed test (12 testers, 14 days) before production.
- [ ] **Android upload keystore**, then the four GitHub secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (`docs/ANDROID.md` section 4). Keep a backup of the keystore.
- [ ] **Apple Developer Program** ($99/yr), an App ID `com.applypilot.app`, then the secrets `APPLE_TEAM_ID`, `BUILD_CERTIFICATE_BASE64`, `P12_PASSWORD`, `BUILD_PROVISION_PROFILE_BASE64` and the App Store Connect API key secrets (`docs/IOS.md`). A Mac is only needed for the Share Extension and for debugging.
- [ ] **Google sign-in client IDs**: a Web client, an Android client per signing certificate SHA-1 (debug, upload, Play App Signing) and an iOS client (its reversed ID goes in the `GOOGLE_IOS_REVERSED_CLIENT_ID` build setting).
- [ ] **A public host for the cloud server** (`https://app.applypilot.app` is the default base URL), with `/.well-known/assetlinks.json` (Android App Links) and `apple-app-site-association` (iOS universal links) served from it.
- [ ] **Privacy policy URL**: `docs/PRIVACY.md` still describes only the desktop app ("we collect nothing"). Update it for the mobile app and ApplyPilot Cloud, then host it. Both stores require the URL.
- [ ] **Account deletion web URL** (Play requires one; the in-app delete already works).
- [ ] **Store listing**: icon, feature graphic, screenshots (`docs/screenshots/`), descriptions, support email, content-rating and data-safety / App Privacy answers (drafts are in `docs/ANDROID.md` section 6 and `docs/IOS.md`).
- [ ] **A test account** for the store reviewers.
- [ ] **Firebase `google-services.json` and an APNs key**, only if remote push is wanted.
