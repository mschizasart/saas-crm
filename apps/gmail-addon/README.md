# AppoinlyCRM — Gmail Add-on

A Google Workspace Add-on (Apps Script + CardService) that mirrors the Outlook
add-in. When you open an email in Gmail it looks up the sender in AppoinlyCRM
and lets you:

- See the matched CRM record (name, company, email, phone, type) and recent activity.
- **Log this email** to the CRM timeline.
- **Create a lead** from the sender when there is no match.

It is a **thin client**: everything runs against the already-deployed backend
REST API at `https://www.appoinlycrm.net/api/v1`. There is no server component
to deploy for this add-on — it runs entirely on Google's Apps Script platform.

## Files

| File | Purpose |
| --- | --- |
| `appsscript.json` | Add-on manifest (V8 runtime, OAuth scopes, Gmail contextual + homepage triggers). |
| `Code.gs` | All add-on logic (CardService UI, auth, API calls). |
| `README.md` | This file. |

## How auth works

- The user signs in **inside the add-on** with their CRM email + password.
- `POST /auth/login` returns a JWT; we store `accessToken` (and `refreshToken`
  if present) in `PropertiesService.getUserProperties()` — per-user, per-script
  storage on Google's side.
- The **password is never stored** — it is only sent once to obtain the token.
- API calls send `Authorization: Bearer <accessToken>`.
- On a `401`, the add-on tries `POST /auth/refresh` **once**; if that fails (or
  the response shape differs from `{ accessToken }`), it clears tokens and shows
  the sign-in card again.

## CardService flow

```
onGmailMessage(e)
  ├─ setCurrentMessageAccessToken(e.gmail.accessToken)   // grants metadata read
  ├─ read sender + subject via GmailApp.getMessageById(e.gmail.messageId)
  ├─ no stored token ─────────────► buildLoginCard()  → doLogin → context card
  └─ POST /addin/context
        ├─ found      ► buildContextCard (record + activity + "Log this email" + "Open in CRM")
        └─ not found  ► create-lead form ("Create lead from sender")

Actions:
  doLogin    → POST /auth/login          (stores tokens, rebuilds context card)
  logEmail   → POST /addin/log-email     (then refreshes context card)
  createLead → POST /addin/create-lead   (rebuilds card as the new lead)
  doLogout   → clears stored tokens
```

## Prerequisites

- Node.js (for `clasp`).
- A Google account that can create Apps Script projects.
- (For publishing) a Google Cloud project with the OAuth consent screen
  configured — see "Publishing" below.

## Deploy with clasp

Apps Script deploys on **Google's platform**, not our servers. Use
[`clasp`](https://github.com/google/clasp) to push these source files.

```bash
# 1. Install clasp
npm i -g @google/clasp

# 2. Authenticate with your Google account
clasp login

# 3. From this directory, create a new standalone script (first time only)
cd apps/gmail-addon
clasp create --type standalone --title "AppoinlyCRM Gmail Add-on"
#   This writes a .clasp.json with the new scriptId. (Do NOT commit real
#   credentials.) To push into an EXISTING script instead, create a .clasp.json
#   yourself:  { "scriptId": "<YOUR_SCRIPT_ID>", "rootDir": "." }

# 4. Push the source (appsscript.json + Code.gs)
clasp push
```

> `clasp create --type standalone` may add a default `appsscript.json`. Keep the
> one in this repo (it has the required scopes + triggers) — let `clasp push`
> overwrite Google's default, or run `clasp push -f`.

## Test the add-on

1. Open the script: `clasp open` (or via
   [script.google.com](https://script.google.com)).
2. **Deploy → Test deployments → Install** (installs the add-on for your own
   account for testing).
3. Open Gmail, open any email, and click the **AppoinlyCRM** icon in the
   right-hand add-on sidebar.
4. Sign in with your CRM email + password. The card should show the sender's CRM
   context (or a create-lead form).

## OAuth scopes requested

Declared in `appsscript.json`:

- `gmail.addons.current.message.readonly` — read the open message's metadata
  (sender, subject).
- `gmail.addons.execute` — run the add-on inside Gmail.
- `script.external_request` — allow `UrlFetchApp` to call the CRM API.

The first time you install/test, Google will ask you to grant these scopes.
Because the add-on is not verified yet, you will see an **"unverified app"**
warning — click *Advanced → Go to (unsafe)* to proceed while testing.

## Publishing (optional, later)

To distribute beyond your own account (e.g. Workspace Marketplace or to other
users), you must:

1. Associate the script with a **Google Cloud project** (Apps Script → Project
   Settings → Google Cloud Platform project).
2. Configure the **OAuth consent screen** in that Cloud project.
3. Enable the **Google Workspace Marketplace SDK** and complete the listing.
4. Submit for **OAuth verification** (required to remove the unverified warning
   for external users).

Until verification, only accounts you add as test users can install it.

## Notes / assumptions

- **Endpoints** match the deployed backend contract used by the Outlook add-in:
  `/auth/login`, `/auth/refresh`, `/addin/context`, `/addin/log-email`,
  `/addin/create-lead`.
- **`/auth/refresh` shape** is assumed to be `{ refreshToken } → { accessToken }`.
  If it differs, refresh silently fails and the user is asked to sign in again —
  no crash.
- CardService has **no masked password input**; the password field shows text
  while typing. It is used transiently and never stored.
- **Deployment is a manual clasp / Apps Script step you must perform** — this
  repo contains source only. We cannot deploy to Google's platform from here.
