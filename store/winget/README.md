# winget (Windows Package Manager)

Package id: **`ApplyPilot.ApplyPilot`**. Users install with `winget install ApplyPilot.ApplyPilot`.

`templates/` holds the three manifests (version, installer, default locale, schema 1.10.0) with `{{PLACEHOLDERS}}`.
`npm run release:winget` fills them from the built installer:

| Placeholder | Value |
|---|---|
| `{{VERSION}}` | `package.json` version |
| `{{INSTALLER_URL}}` | `https://github.com/<build.publish.owner>/<build.publish.repo>/releases/download/v<version>/ApplyPilot-Setup-<version>.exe` |
| `{{INSTALLER_SHA256}}` | SHA-256 of `release/ApplyPilot-Setup-<version>.exe` |
| `{{RELEASE_DATE}}`, `{{RELEASE_NOTES_URL}}` | today, the GitHub release page |

The installer URL must be **publicly downloadable**, so winget only works once releases go to the public
`applypilot-releases` repo (see docs/PUBLISHING.md). The hash must match the exact file uploaded to that release:
render the manifests from the same build you uploaded (CI does this; the `applypilot-windows` artifact has a `winget/` folder).

## First submission

```powershell
winget install Microsoft.WingetCreate
npm run release:winget                       # writes release/winget/<version>/
winget validate --manifest release\winget\<version>
winget install --manifest release\winget\<version>   # needs: winget settings --enable LocalManifestFiles (admin)
wingetcreate submit release\winget\<version>  # opens a PR on microsoft/winget-pkgs (asks for a GitHub token)
```

A bot validates the PR (installs it in a sandbox). Moderators usually merge within a few days.
Unsigned installers are accepted, but SmartScreen/Defender flags can delay review.

## Every later version

```powershell
wingetcreate update ApplyPilot.ApplyPilot --version <x.y.z> `
  --urls https://github.com/sahil-shaik-007/applypilot-releases/releases/download/v<x.y.z>/ApplyPilot-Setup-<x.y.z>.exe `
  --submit
```

Notes:
- `ProductCode` is the uninstall key electron-builder derives from `appId` (`com.applypilot.desktop`); it never changes
  unless `appId` does, so winget can detect and upgrade existing installs.
- `Scope: user` matches `build.nsis.perMachine = false`. `/S` is the silent switch.
- `PublisherSupportUrl`, `PrivacyUrl` and `LicenseUrl` in the locale template point at applypilot.app pages; they must
  be live before you submit.
