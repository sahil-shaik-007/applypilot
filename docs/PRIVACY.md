# ApplyPilot Privacy Policy

_Last updated: 15 October 2026_

ApplyPilot has two parts. The **Windows app** runs on your computer and needs no account. The optional **phone and
web portal** (ApplyPilot Cloud) needs a Google sign-in and a small server. This policy covers both, and says clearly
which data goes where.

## The Windows app (no account needed)

**What we collect: nothing.** The Windows app has no analytics and no telemetry. We do not operate a server that
receives your profile, resumes, applications, answers or API keys when you use the app on its own.

**Where your data lives.** Your profile, resumes, job matches, applications, saved answers and settings are stored
in your Windows user folder (`%APPDATA%\ApplyPilot`). API keys are encrypted with Windows DPAPI. The app keeps
automatic backups of your data files in `%APPDATA%\ApplyPilot\backups` (the newest ten). "Delete all my data"
removes the data, the backups, resumes and the app's browser profile.

**The browser extension** talks only to the app on your own PC (`127.0.0.1`), after you pair it with a code. It
never sends your data anywhere else.

## The phone and web portal (optional)

**Sign-in.** We receive your Google name, email address and picture so you can sign in. You choose the name shown
in the portal; it is not your email address.

**Your data is encrypted before it leaves your device.** Your profile, resumes, applications, answers and settings
are encrypted on your device with a key derived from your vault passphrase (AES-256-GCM). The server stores only
ciphertext, which it cannot read, plus hashes of session tokens. If you lose both your passphrase and your recovery
key, your data cannot be recovered by us.

**What the server can see.**
- Your account (Google name, email, picture, the display name you chose) and when you signed in.
- The size and timing of your encrypted records and files.
- **Job searches.** The portal searches job boards through our server, so the search words and place you type are
  sent to it to fetch listings. We do not store them unless you save a search (below).
- **Saved searches ("watchlist"), only if you opt in.** The words and place of each saved search are stored in
  readable form so the server can re-run them and tell you about new matches. You can remove them at any time; they
  are deleted with your account.
- **Notifications, only if you turn them on.** The address or token your phone or browser gives us to send a
  notification. Notifications say that there are new matches; they contain no job details.

**Deleting your data.** "Delete account" in Settings removes your account, encrypted records, files, saved
searches and notification addresses from the server.

## Who ApplyPilot talks to, and only when you use the feature

- **Job sources** (for example Greenhouse, Lever, Ashby, Workable, Himalayas, Remote OK, Adzuna). Search terms and
  location are sent to fetch listings (from your PC in the Windows app, from our server for the portal).
- **Employers' application forms.** When you apply, ApplyPilot fills the employer's form with the profile details
  and resume you chose. The employer's privacy policy then applies.
- **Anthropic (Claude)**, if you add your own API key. Your resume text, profile summary and the job description
  are sent to generate cover letters, tailoring or answers, under Anthropic's commercial terms. If you use a local
  model instead, data goes only to the address you enter.
- **Google**, for sign-in.
- **Dodo Payments**, if you buy a license. Activation sends your license key and a device name. Payment details
  are handled by Dodo Payments, never by ApplyPilot.

## Several profiles

If you create profiles for other people (for example a family member), you are responsible for having their
permission. Each profile's details, resumes and answers are kept separately.

## Children

ApplyPilot is not intended for anyone under 16.

## Contact

support@applypilot.app

_This policy describes how the software behaves. Before you publish the portal, have it reviewed for the countries
you operate in and host it at a public address (app stores require a link)._
