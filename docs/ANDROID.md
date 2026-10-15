# ApplyPilot for Android

The Android app is the React PWA in `web/client`, wrapped with **Capacitor 8**. The Gradle project lives in `web/client/android/`. See `docs/MOBILE.md` for the overall mobile architecture.

| | |
|---|---|
| Application ID | `com.applypilot.app` |
| App name | ApplyPilot |
| minSdk / targetSdk / compileSdk | 24 (Android 7.0) / 36 (Android 16) / 36, the Capacitor 8 defaults in `android/variables.gradle` |
| Toolchain | JDK 21, Android Gradle Plugin 8.13.0, Gradle 8.14.3, build-tools 35/36 |
| versionName | `version` in `web/client/package.json` |
| versionCode | `major*10000 + minor*100 + patch` (1.0.0 gives 10000). Override it with the `ANDROID_VERSION_CODE` env var or `-PversionCode=N`. CI uses the run number. |

## 1. Toolchain on Windows (user-level, no admin)

Everything goes into `%LOCALAPPDATA%\ApplyPilotBuild\`. Nothing is added to the system or user PATH, and no permanent environment variables are set.

```
%LOCALAPPDATA%\ApplyPilotBuild\
  jdk-21\          Microsoft Build of OpenJDK 21 (zip from aka.ms/download-jdk)
  android-sdk\     cmdline-tools\latest, platform-tools, platforms\android-36, build-tools\35.0.0 + 36.0.0
                   (optional) emulator, system-images\android-36\google_apis\x86_64
  gradle-home\     GRADLE_USER_HOME (wrapper distribution + dependency cache, ~2 GB after first build)
  avd\             ANDROID_AVD_HOME (only if you create the emulator)
  dl\              downloaded zips and build logs
```

One command installs it. It is safe to re-run.

```powershell
cd web\client\android
.\build-local.ps1 -Bootstrap      # JDK 21 + cmdline-tools (SHA-1 verified) + SDK packages, licenses accepted
.\build-local.ps1 -Emulator       # optional: emulator + Android 16 Google APIs x86_64 image + AVD "ApplyPilot_API36"
```

Here is what `-Bootstrap` does, if you need to do it by hand:

1. Download `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip` and extract it to `jdk-21\`.
2. Download `https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip` (SHA-1 `57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d`). Extract it so that `android-sdk\cmdline-tools\latest\bin\sdkmanager.bat` exists.
3. Set `JAVA_HOME` and `ANDROID_HOME` for the current shell only, then run:
   `sdkmanager "platform-tools" "platforms/android-36" "build-tools/35.0.0" "build-tools/36.0.0"`
   Answer `y` to the license prompts. cmdline-tools 23 takes `/` in package paths; `;` gets split by cmd.exe.

To use the toolchain in your own shell, run `.\build-local.ps1 -Shell`. It prints the `$env:` lines for that session.

**Low-memory PCs (8 GB):** `android/gradle.properties` caps the Gradle JVM at 1.5 GB, turns off the Gradle daemon and runs Kotlin in-process. `build-local.ps1` passes `--no-daemon`. A cold first build downloads about 2 GB of dependencies and took about 35 minutes on the dev PC. Incremental builds take a few minutes. Run `gradlew --stop` if you ever started a daemon by hand.

## 2. Build

```powershell
cd web\client
npm run build:android                                  # = android\build-local.ps1: npm run build -> cap sync android -> assembleDebug
# or step by step:
npm run build
npx cap sync android
cd android; .\gradlew.bat assembleDebug --no-daemon     # (with JAVA_HOME/ANDROID_HOME set)
```

| Output | Path |
|---|---|
| Debug APK | `web/client/android/app/build/outputs/apk/debug/app-debug.apk` |
| Release AAB | `web/client/android/app/build/outputs/bundle/release/app-release.aab` |
| R8 mapping (upload to Play with each release) | `web/client/android/app/build/outputs/mapping/release/mapping.txt` |

`.\build-local.ps1 -SkipWeb` re-runs Gradle only. `.\build-local.ps1 -Task "assembleDebug bundleRelease"` builds both.

To install on a phone (USB debugging on): `adb install -r app\build\outputs\apk\debug\app-debug.apk`.

### Icons and splash (`npm run icons:android`)

```powershell
cd web\client
npm run icons:android        # node android/scripts/icons.mjs
```

This regenerates every launcher icon (legacy, round and adaptive foreground/background) and every splash screen (light, night, portrait and landscape) from **`build/icon.png`**, using `@capacitor/assets` easy mode on `#0a0a0a`. Re-run it whenever the logo changes, then commit the changed files under `android/app/src/main/res/mipmap-*` and `drawable-*`.

Options (environment variables):
- `ICON_SRC=path\to\logo-1024.png` uses a different source (1024 px or larger is best)
- `ICON_BG=#0a0a0a`
- `SPLASH_SCALE=0.3`

On Android 12+, the system splash uses `windowSplashScreenBackground=#0a0a0a`, with the adaptive foreground as the icon (`res/values/styles.xml`).

## 3. What the Android project configures

| Area | Where | What |
|---|---|---|
| Theme | `res/values/styles.xml`, `colors.xml` | Always dark (`Theme.AppCompat.NoActionBar`, force-dark off). Status bar, navigation bar and window background are `#0a0a0a`, accent `#818cf8`. Launch theme is `Theme.SplashScreen`, then `AppTheme.NoActionBar`. |
| Permissions | `AndroidManifest.xml` | Kept: `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `USE_BIOMETRIC`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` (background checks through WorkManager and notification rescheduling). Removed with `tools:node="remove"` although plugins declare them: all **location** permissions (background-runner), `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `CAMERA` (inappbrowser), `USE_CREDENTIALS`, storage, `AD_ID`. |
| Share target | `MainActivity.java` + `ACTION_SEND text/plain` filter | "Share to ApplyPilot" from LinkedIn, Naukri or a browser. See the share contract below. |
| Deep links | manifest | `applypilot://…` (custom scheme). Verified `https://app.applypilot.app/{open,job,share}…` App Links (`autoVerify`). Change the host with `-Papplypilot.appLinkHost=…`. |
| Network security | `res/xml/network_security_config.xml` | HTTPS only, system CAs only, `usesCleartextTraffic=false`. |
| Debug-only cleartext | `app/src/debug/res/xml/network_security_config.xml` | Debug builds also allow cleartext to `localhost`, `127.0.0.1` and `10.0.2.2` (the host PC seen from the emulator), and trust user CAs. Release builds never include this file. |
| Backups | `data_extraction_rules.xml`, `allowBackup=false` | No cloud backup and no device-to-device transfer. Session tokens must not migrate. Vault data re-syncs (E2E encrypted) after sign-in. |
| R8 | `app/proguard-rules.pro` | Release: `minifyEnabled` + `shrinkResources`. Keeps Capacitor and plugin classes, `@JavascriptInterface` members, background-runner JNI, WorkManager workers, biometric, Credential Manager and inappbrowser classes. |
| background-runner | `app/build.gradle` | Adds `node_modules/@capacitor/background-runner/android/src/main/libs` to `flatDir` (needed for its JS-engine `.aar`). |
| Runner file | `vite.config.js` | The build copies `runners/background.js` to `dist/runners/` (the plugin loads `public/runners/background.js`), so run a web build before `cap sync`; `build-local.ps1` does. Check: `android/app/src/main/assets/public/runners/background.js` exists. |
| Signing | `app/build.gradle` | Release signing reads env vars or Gradle properties only (see §4). With no keystore, the release output is **unsigned** and Gradle prints a warning. |

### Share contract (for `src/native` `share.onIncoming`)

Android delivers a share as `ACTION_SEND` + `EXTRA_TEXT`. Capacitor's App plugin forwards only `ACTION_VIEW` to JS. So `MainActivity` rewrites the share into a deep link, with no extra plugin:

```
applypilot://share?url=<first http(s) URL in the text>&text=<shared text, max 4000 chars>&subject=<EXTRA_SUBJECT>
```

The JS side reads it with the standard App APIs:

```js
import { App } from '@capacitor/app';
const handle = (u) => { const x = new URL(u); if (x.protocol === 'applypilot:' && x.host === 'share')
  fn({ url: x.searchParams.get('url') || '', text: x.searchParams.get('text') || '' }); };
const launch = await App.getLaunchUrl(); if (launch?.url) handle(launch.url);         // cold start
const sub = await App.addListener('appUrlOpen', (e) => handle(e.url));               // app already running
```

Test it with:

```
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Check this https://www.linkedin.com/jobs/view/123" com.applypilot.app
```

### App Links (`https://app.applypilot.app/...`)

Serve `https://app.applypilot.app/.well-known/assetlinks.json` (from `web/server`). It must list the **Play App Signing** SHA-256 and the upload or debug SHA-256 values:

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.applypilot.app",
               "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>", "<UPLOAD_SHA256>"] } }]
```

Until that file is served, `https://` links open in the browser and `applypilot://` links still work.

### Push notifications

`@capacitor/push-notifications` needs Firebase. Put `google-services.json` in `web/client/android/app/` (the Gradle build applies the plugin only when the file exists). Without it, `PushNotifications.register()` fails, so the JS layer must call it only when push is configured. Local notifications and background-runner work without Firebase.

## 4. Release signing

**Never commit a keystore or passwords.** `.gitignore` already ignores `*.jks`, `*.keystore` and `keystore.properties`.

Create the upload key once and store it **outside the repo**, for example in a password manager plus an offline backup:

```powershell
& "$env:LOCALAPPDATA\ApplyPilotBuild\jdk-21\bin\keytool.exe" -genkeypair -v -keystore "$HOME\keys\applypilot-upload.jks" `
  -alias applypilot-upload -keyalg RSA -keysize 4096 -validity 10000
```

Provide the values to Gradle in **one** of these ways:

| Env var (CI, one-off shells) | Gradle property (`%USERPROFILE%\.gradle\gradle.properties`, never the repo) |
|---|---|
| `ANDROID_KEYSTORE_PATH` | `applypilot.keystore.path` |
| `ANDROID_KEYSTORE_PASSWORD` | `applypilot.keystore.password` |
| `ANDROID_KEY_ALIAS` | `applypilot.key.alias` |
| `ANDROID_KEY_PASSWORD` | `applypilot.key.password` |

Then run `.\build-local.ps1 -Task bundleRelease` and verify the signature with `jarsigner -verify app\build\outputs\bundle\release\app-release.aab`.

**CI** (`.github/workflows/android.yml`):
- Every push to `main` that touches `web/**` (and PRs touching `web/client`) builds the web client, runs `cap sync`, then `assembleDebug`. The APK is uploaded as artifact `applypilot-debug-apk`.
- When all four secrets exist, the workflow also builds a **signed release AAB** plus `mapping.txt` (artifact `applypilot-release-aab`). The secrets are `ANDROID_KEYSTORE_BASE64` (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("applypilot-upload.jks"))`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. versionCode is the CI run number.

## 5. Testing

- **Emulator** (optional, needs about 3 GB of free RAM): run `.\build-local.ps1 -Emulator`. Then:
  ```powershell
  $env:ANDROID_AVD_HOME="$env:LOCALAPPDATA\ApplyPilotBuild\avd"
  & "$env:LOCALAPPDATA\ApplyPilotBuild\android-sdk\emulator\emulator.exe" -avd ApplyPilot_API36 -memory 2048 -no-snapshot
  ```
  WHPX (Windows Hypervisor Platform) acceleration is available on the dev PC.
- **Local server from the emulator:** start the server with `AP_DEV_LOGIN=1` (see `docs/CLOUD.md`). In the app's server URL setting, use `http://10.0.2.2:<port>`. Only debug builds allow that cleartext.
- **Screenshots:** `adb exec-out screencap -p > docs\screenshots\android-<name>.png`
- **Smoke checklist:**
  - The app launches with a dark splash and no white flash.
  - The landing page renders.
  - Dev login works against 10.0.2.2.
  - Bottom navigation works.
  - Back button behaviour is correct.
  - The share intent from the `adb` command above opens ApplyPilot with the job URL.
  - `applypilot://open` opens the app.
  - Notification permission is requested on Android 13+.

## 6. Google Play publishing checklist

1. **Developer account:** Google Play Console, $25 one-time. New personal accounts must run a closed test with at least 12 testers for 14 days before production access.
2. **Create the app:**
   - Name: ApplyPilot
   - Default language: en-US
   - App, Free (or paid if licensing is sold in-app; Play billing rules apply to digital goods sold *inside* the app)
3. **Play App Signing:** enroll (the default). Upload the first AAB signed with the upload key. Copy the **App signing key certificate** SHA-1 and SHA-256 from *Setup → App integrity*.
4. **Google Sign-In** (`@capgo/capacitor-social-login`, Credential Manager):
   - In Google Cloud Console → Credentials, use the **same project** as the server's Web client ID.
   - Create **Android** OAuth clients for package `com.applypilot.app`, one per certificate:
     - debug keystore SHA-1, from `cd web\client\android; .\gradlew.bat signingReport --no-daemon` (debug variant), or `keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -storepass android`
     - upload key SHA-1, from `keytool -list -v -keystore applypilot-upload.jks`
     - **Play App Signing** SHA-1 (step 3). Builds installed from Play are signed with this key.
   - Pass the **Web** client ID (not the Android one) as `webClientId` to `SocialLogin.initialize()`.
5. **Privacy policy URL:** host `docs/PRIVACY.md` publicly (for example `https://app.applypilot.app/privacy`). It must cover the mobile app and ApplyPilot Cloud: Google account email, name and picture; encrypted vault; job search queries; direct calls to Anthropic with the user's own key; employer forms; account deletion. The current `docs/PRIVACY.md` describes only the desktop app ("we collect nothing"), so **update it before submitting**.
6. **Data safety form** (based on `docs/PRIVACY.md` and `docs/CLOUD.md`):
   - Data collected or shared: **Yes, collected.**
     - *Personal info → Name, Email address:* collected (Google Sign-In identity). Purpose: Account management. Not shared. Required for cloud sync.
     - *Personal info → User IDs:* collected (account id). Purpose: Account management.
     - *Photos → (profile picture URL from Google):* declare it under Personal info → Other, or leave it out if the server stops storing `picture`.
     - *Files and docs (resumes), Personal info (profile, employment history), App activity (applications):* stored on the server **only end-to-end encrypted**. Google's guidance: data that is E2E encrypted so the developer cannot read it is **not "collected"**. Note this in the form explanation.
     - *App activity → Other user-generated content / In-app search history:* job **search queries** reach the server (used only to fetch public listings, cached 15 min). Declare as collected, purpose App functionality, not shared, ephemeral.
     - *App info and performance → Crash logs / Diagnostics:* **No** (no analytics, no crash SDK). Revisit if Firebase Crashlytics is ever added.
     - *Device or other IDs:* **No** (AD_ID permission removed; no advertising SDKs).
     - *Location, Financial info, Health, Contacts, Messages, Photos/Videos, Audio, Calendar:* **No.**
   - Data shared with third parties: **No.** Data the user sends to Anthropic with their own API key, or types into employer forms, is user-initiated transfer to a service the user chose. Google classes this as not "sharing", but say so in the explanation.
   - Data encrypted in transit: **Yes** (HTTPS only; cleartext is disabled in release builds).
   - Users can request deletion: **Yes.** In-app *Delete account* hard-deletes immediately. Also provide a **web deletion URL** (Play requires one), for example `https://app.applypilot.app/delete-account` or a support email flow.
   - Independent security review: No (optional).
7. **Content rating (IARC questionnaire):** category Utility / Productivity. No violence, sexual content, profanity, drugs, gambling or user-to-user communication. No sharing of location. Expected rating: **Everyone / PEGI 3**. Target audience: 18+ (job seekers). Not designed for children; the privacy policy says 16+.
8. **App access:** reviewers need to sign in. Provide a test Google account, or a demo mode, with instructions for creating a vault passphrase.
9. **Other declarations:**
   - Ads: none.
   - Government app: no.
   - Financial features: none.
   - Health: no.
   - News: no.
   - Background location: not requested (removed).
   - Exact alarms: not requested.
   - Foreground service: none.
   - Credential Manager / Sign-In: standard.
   - The in-app WebView auto-fill touches third-party sites. Describe it in the review notes: it fills only the user's own data, never passwords or CAPTCHAs, and the user stays in control (`docs/MOBILE.md` safety rules).
10. **Store listing:**
    - 512×512 icon (`build/icon.png` upscaled, or the new logo)
    - 1024×500 feature graphic
    - at least 2 phone screenshots (`docs/screenshots/android-*.png`)
    - short description (80 chars) and full description
    - contact email `support@applypilot.app`
11. **Release:** upload `app-release.aab` and `mapping.txt` to *Internal testing*, then Closed, then Production. Bump `version` in `web/client/package.json` for every release; CI bumps versionCode automatically.

## 7. Troubleshooting

- *`SDK location not found`:* `ANDROID_HOME` isn't set in this shell. Use `build-local.ps1`, or create `android/local.properties` with `sdk.dir=C:\\Users\\<you>\\AppData\\Local\\ApplyPilotBuild\\android-sdk` (gitignored).
- *Out-of-memory or very slow builds:* close other apps. Keep `--no-daemon`. Use `.\gradlew.bat --stop` to kill stray daemons.
- *`Package build-tools not found` from sdkmanager:* use `/` instead of `;` in package paths (cmdline-tools 23+ on cmd.exe).
- *Google Sign-In `[28444] Developer console is not set up correctly`:* the SHA-1 or package isn't registered for the certificate that signed the installed build (see §6.4).
- *CI "Process completed with exit code 126" at `./gradlew`:* `gradlew` was committed from Windows without the executable bit. The workflow runs `chmod +x gradlew` first; to fix it at the source run `git update-index --chmod=+x web/client/android/gradlew`.
