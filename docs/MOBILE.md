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

## Build and run

- Web build: `cd web/client && npm run build`, then `npx cap sync`.
- Android: `npx cap open android`, or `cd android && gradlew assembleDebug`. CI: `.github/workflows/android.yml`.
- iOS: on a Mac, `npx cap open ios`. CI: `.github/workflows/ios.yml` (macOS runner; simulator build; signed IPA once Apple secrets are added).
- Store publishing needs:
  - Android: a Google Play developer account ($25 one-time) and a release keystore
  - iOS: an Apple Developer Program membership ($99/yr)
  - Google Sign-In: OAuth client IDs for each platform (Android needs the signing certificate's SHA-1)

  See `docs/PUBLISHING.md`.
