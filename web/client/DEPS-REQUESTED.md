
## From the iOS agent (2026-10-10)

- **package.json script** (no new dependency; `sharp` already ships with `@capacitor/assets`):
  ```json
  "icons:ios": "node ios/scripts/icons.mjs"
  ```
  Regenerates the iOS app icon + dark launch image from `assets/brand/png/*` (falls back to
  `build/icon.png`). Re-run after any logo change, then commit `ios/App/App/Assets.xcassets`.
