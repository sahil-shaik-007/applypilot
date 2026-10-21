# Browser extension

The ApplyPilot extension fills job application forms in your own Chrome or Edge, using the profile and resume
you keep in ApplyPilot. It is the quickest way to apply from your laptop browser.

## What it does

- Reads the form on the page and shows a check: what it will fill, what the page already holds, and what is
  missing.
- You type any missing answers in the popup; they are saved to the answer bank for that profile.
- It fills only after you confirm. It never presses submit, and it attaches the resume only when you tick it.
- It uses the profile of the tracked application for that job (so a job queued for your brother is filled with
  his details), or your main profile for a job that isn't tracked.

## Install and pair

The Windows app ships the extension. Open **Settings → Browser extension**.

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the extension folder (the **Open extension folder** button opens it).
3. Pin the ApplyPilot icon, open it and enter the six-digit pairing code shown in the app.
4. On a job application page, click the icon, review the check, and confirm.

## Use with the web app

The extension can also do the filling for the ApplyPilot web app on a desktop browser.

1. Open the extension's options and, under **Web app**, add the address your web app is served from
   (for example `https://applypilot.example.com`; `http://localhost` works for local use). Reload the web app tab.
2. In the web app, press **Apply in browser** on a job. The job's page opens in a new tab and is filled with the
   profile, answers and resume the web app sends for that one application; progress and the result show up in the web
   app.

It works like the phone apps: it fills only on the job's own site and the known application systems, never touches
passwords, never solves CAPTCHAs, and submits only in Autopilot mode on supported sites (after the cancel window).
In review mode you always press Submit yourself. This needs no pairing with the Windows app; protocol details are in
`docs/WEB-BRIDGE.md`.

## Security

- The connection is local: the app listens on `127.0.0.1` only (ports 47823-47833).
- Only a browser extension can talk to it; a web page is refused even though it is on the same machine.
- Pairing uses a code that lasts ten minutes and works once. After pairing, the extension holds a random token;
  the app stores only a hash of it. **Unpair** in Settings revokes it immediately.
- Your resume file is only sent to the extension when you ask it to attach the resume.
- Web app: only the address you add in the options (plus local development ports) can talk to the extension, and a
  job page can never reach it. The extension asks for access to all `https://` sites so it can fill the employer's
  site, but it injects anything only when you press Apply in browser, and only on that application's own sites.

## Troubleshooting

- "Not running" in Settings: restart ApplyPilot. Another program may be using the ports above.
- The popup says it is not paired: open Settings → Browser extension, get a new code, and pair again.
- Fields left blank: the check lists them as missing; type a value in the popup or in the form.
