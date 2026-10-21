# Web app ↔ browser extension bridge ("Apply in browser")

**Problem this solves.** The ApplyPilot web app (`web/client`) runs in an ordinary browser tab. A web page cannot
read or fill another site's form (same-origin policy), so in a desktop browser the web app could only send a job to
the Windows app, open the job page, or offer one-tap copy for every field. On the phone apps the in-app WebView does
the filling.

**Solution.** The ApplyPilot extension acts as the web app's "native layer" on desktop Chrome/Edge. The web app keeps
the decrypted profile, answers and resume in memory (zero-knowledge vault, nothing changes there). When you press
**Apply in browser**, the web app hands that data to the extension for this one application, the extension opens the
job's page in a new tab, injects the same auto-fill engine the phone app uses, fills the form, and reports progress
and the result back to the web app, which writes it to the tracker. Nothing goes to any server other than the job's
own site.

```
web app tab (page JS)  --window.postMessage-->  content script (web origin only)  --runtime.sendMessage-->  background (service worker)
                                                                                                                  |  opens tab, injects engine, relays events
                                                                                                           job tab (isolated world: engine + window.mobileApp shim)
```

## Transport

All page ⇄ content-script messages are `window.postMessage` objects on the **same window**, with `source` checked
(`event.source === window`) and `event.origin === location.origin`:

* page → extension: `{ apWeb: 1, dir: 'to-ext', id, type, ... }`
* extension → page: `{ apWeb: 1, dir: 'to-page', id, type, ... }`

`id` is chosen by the page for a request (for `apply` it is the application id and identifies the whole run).

### Messages (page → extension)

| type | fields | effect |
|---|---|---|
| `ping` | `id` | extension answers `pong` |
| `apply` | `id`, `cfg` (below) | open the job tab, fill, stream events, finally `result` |
| `answer` | `id`, `qid`, `answer` (string/array/null) | reply to an `ask` |
| `cancel-submit` | `id` | hold: stop a running cancel-window countdown |
| `cancel` | `id` | close the job tab and end the run (`result.status = 'needs-attention'`, message "Cancelled.") |

`cfg` (all JSON, no functions):

```js
{
  job:      { id, title, company, location, remote, ats, atsMeta, url, applyUrl, externalId },
  profile:  { ...profile values... },
  answers:  [{ question, answer }],
  resume:   { name, mime, base64 } | null,      // base64 of the PDF, name is the file name the employer sees
  coverLetter: string | null,
  mode:     'review' | 'auto',
  cancelWindowSec: number,                      // minimum 3
  canAsk:   boolean,                            // page answers `ask` messages (answer bank / AI)
  allowedSites: string[],                       // registrable hosts the data may be injected into
}
```

### Messages (extension → page)

| type | fields |
|---|---|
| `pong` | `id`, `version`, `engine` (autofill engine version), `needsPermission: false` |
| `event` | `id`, `event: { type, message, data }`. Types are the engine's: `step`, `filled`, `question`, `captcha`, `needs-user`, `fill-done`, `countdown`, `submit-cancelled`, `submit-clicked`, `submitted`, `error`, `navigating`, `opened` |
| `ask` | `id`, `qid`, `question`, `info: { type, options, required }` — page replies with `answer` |
| `result` | `id`, `result: { status, filledCount, unanswered: [{question, required, type, options}], url, message }` — exactly once per run |

`result.status` values are the same as the phone app's `applyInApp`: `submitted`, `filled-awaiting-user`,
`needs-attention`, `blocked`, `failed`.

## Rules (the same as the desktop engine and the phone app)

1. Data is injected only into a tab whose registrable host is in `allowedSites` (the job's own sites plus known ATS hosts).
   The extension decides from the tab's real URL, never from what the page claims.
2. `allowSubmit` is true only for `mode === 'auto'` on an allow-listed ATS (greenhouse, lever, ashby, workable,
   smartrecruiters, recruitee), only once per application, and the engine itself enforces the cancel window,
   "every required question answered" and "no CAPTCHA". Review mode never submits.
3. Passwords are never touched. CAPTCHAs and bot walls are never solved or bypassed.
4. Only one run per tab; a second `apply` with the same `id` while running is ignored.
5. The bridge content script runs only on origins the user listed (localhost dev ports by default, plus the
   address set in the extension options). A page on another origin never gets a `pong`.
6. The job page can never message the extension: the engine's `window.mobileApp` shim lives in the extension's
   isolated world and is not visible to page scripts.
