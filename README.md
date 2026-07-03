# Kali Mandir — New Kali Mandir, Belabagan, Deoghar

A bilingual (Hindi/English) website for the New Kali Mandir temple in
Belabagan, Deoghar, Jharkhand. A static frontend hosted on GitHub Pages,
backed by a serverless Azure Functions API for content that the temple
committee needs to update themselves — visiting hours, the puja calendar,
the photo gallery, and donation details — without touching code.

The site works fully on its own with no backend deployed: `frontend/assets/default-content.json`
ships as the real content, so publishing to GitHub Pages alone gets you a
complete, working site. The Azure backend is what turns the admin panel from
a local preview into a live editing tool for everyone who visits the site.

## Repository structure

```
├── agent/                # Guidance for AI coding agents working on this repo
├── azure-functions/      # Serverless backend (C# scripting / .csx)
│   ├── Content/          # GET/POST /api/content   — site copy, schedule, samagri list
│   ├── Media/             # POST /api/media          — admin photo/QR uploads
│   ├── Analytics/         # GET/POST /api/analytics  — page-view tracking + dashboard
│   ├── Shared/            # Code shared between modules via #load
│   └── host.json
├── frontend/              # Static site — deploy this folder to GitHub Pages
│   ├── index.html / index.js   — public site (one JS file, only for this page)
│   ├── admin.html / admin.js   — admin CMS (one JS file, only for this page)
│   ├── styles.css              — shared design tokens + styles for both pages
│   └── assets/
│       └── default-content.json — fallback content the site ships with
└── .github/workflows/deploy-pages.yml — publishes frontend/ to GitHub Pages
```

## Local preview

The site is plain HTML/CSS/JS — no build step. Because `index.js` fetches
`assets/default-content.json` with `fetch()`, opening `index.html` directly
as a `file://` URL will fail in most browsers (fetch of local files is
blocked under the file protocol). Serve it over local HTTP instead:

```bash
cd frontend
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080`. To preview the admin panel without any
real Google credentials, open `http://localhost:8080/admin.html` and click
**"Continue in demo mode"** — this lets you exercise every CMS tab (hours,
schedule, gallery, samagri list, donations, analytics) with changes saved to
your browser's `localStorage`, so you can see them reflected live on
`index.html` in the same browser.

## Deploy the frontend (GitHub Pages)

1. Push this repo to GitHub.
2. In the repo's **Settings → Pages**, set **Source** to **"GitHub Actions"**
   (not "Deploy from a branch" — the branch-deploy option can only serve the
   repo root or a `/docs` folder, and this project keeps the site in
   `/frontend`, so the included Actions workflow is what publishes it).
3. Push to `main`. `.github/workflows/deploy-pages.yml` builds and deploys
   the `frontend/` folder automatically on every push that touches it. Check
   the **Actions** tab for the deployment URL.

## Deploy the backend (Azure Functions)

Everything below is a one-time setup. You'll need an Azure subscription and
the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
installed locally, plus the Azure CLI (`az`).

1. **Create the resource group, storage account, and function app.**
   Storage account names must be globally unique and lowercase-alphanumeric
   only — adjust `kalimandirstore` below if it's taken.

   ```bash
   az group create --name kali-mandir-rg --location centralindia

   az storage account create \
     --name kalimandirstore \
     --resource-group kali-mandir-rg \
     --sku Standard_LRS

   az functionapp create \
     --resource-group kali-mandir-rg \
     --consumption-plan-location centralindia \
     --runtime dotnet \
     --functions-version 4 \
     --name kalimandir-func \
     --storage-account kalimandirstore
   ```

2. **Set the app's configuration.** These correspond to the values in
   `azure-functions/local.settings.json.example` — see the
   [Environment variables](#environment-variables) table below for what
   each one does.

   ```bash
   az functionapp config appsettings set \
     --name kalimandir-func \
     --resource-group kali-mandir-rg \
     --settings \
       GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
       ADMIN_EMAILS="priest@example.com,secretary@example.com" \
       ALLOWED_ORIGIN="https://your-github-username.github.io" \
       CONTENT_CONTAINER="content" \
       MEDIA_CONTAINER="media"
   ```

3. **Publish the functions.** Run this from the `azure-functions/` folder.

   ```bash
   cd azure-functions
   func azure functionapp publish kalimandir-func
   ```

4. **Point the frontend at it.** In `frontend/index.html` and
   `frontend/admin.html`, set:

   ```js
   window.KALI_MANDIR_API_BASE = "https://kalimandir-func.azurewebsites.net/api";
   ```

   Commit and push — the GitHub Pages deploy picks it up automatically.

Azure CLI flags occasionally change between versions — if a command above
errors, check `az functionapp create --help` for the current flag names
before assuming the resource group or account setup itself failed.

## Set up Google Sign-In (admin authentication)

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   select) a project, then go to **APIs & Services → Credentials → Create
   Credentials → OAuth client ID**, application type **Web application**.
2. Under **Authorized JavaScript origins**, add both your live site and your
   local preview origin, e.g.:
   - `https://your-github-username.github.io`
   - `http://localhost:8080`
3. Copy the generated **Client ID** (looks like
   `123...apps.googleusercontent.com`) into `frontend/admin.html`:

   ```js
   window.KM_GOOGLE_CLIENT_ID = "123...apps.googleusercontent.com";
   ```

4. Set the **same** client ID as the `GOOGLE_CLIENT_ID` app setting on the
   Function App (step 2 of the backend deployment above) — the backend
   checks that tokens were issued for this exact client ID.
5. Add each authorized admin's Google account email to `ADMIN_EMAILS` on the
   Function App. This server-side list is the real security boundary.
   `window.KM_ADMIN_EMAILS` in `admin.html` is optional and only produces a
   friendlier in-browser error message — it does not grant or restrict
   access by itself.

## How content editing works

- The public site (`index.html`) always renders from
  `assets/default-content.json`, then overlays whatever the Azure `Content`
  API returns (if configured and reachable), then overlays any local
  `localStorage` override in that same browser (used for local preview).
- The admin panel (`admin.html`) edits are saved the same way: written to
  `localStorage` immediately (so you always see your own edits), and also
  sent to the Azure `Content`/`Media` API if `KALI_MANDIR_API_BASE` is set
  — which is what makes an edit visible to every visitor, not just your own
  browser.
- Photos uploaded in the Gallery or Donations tab go to Blob Storage via the
  `Media` function once the backend is connected; before that, they're held
  as in-browser data URLs for preview only and are not visible to other
  visitors.
- Visiting-hours changes, the yearly puja schedule, and the samagri
  checklist are all edited the same way, each on its own tab.

## Environment variables

| Variable | Where it's set | Purpose |
|---|---|---|
| `AzureWebJobsStorage` | Function App (set automatically by `az functionapp create`) | Connection string for Blob + Table Storage |
| `GOOGLE_CLIENT_ID` | Function App setting | Must match `window.KM_GOOGLE_CLIENT_ID`; used to verify admin tokens were issued for this app |
| `ADMIN_EMAILS` | Function App setting | Comma-separated list of Google account emails allowed to make admin changes — the real access-control list |
| `ALLOWED_ORIGIN` | Function App setting | Your GitHub Pages origin, for CORS |
| `CONTENT_CONTAINER` | Function App setting (optional, defaults to `content`) | Blob container name for the content JSON |
| `MEDIA_CONTAINER` | Function App setting (optional, defaults to `media`) | Blob container name for uploaded photos |
| `MEDIA_MAX_BYTES` | Function App setting (optional, defaults to 5 MB) | Per-file upload size cap |
| `window.KALI_MANDIR_API_BASE` | `frontend/index.html` + `frontend/admin.html` | Base URL of the deployed Azure Functions API |
| `window.KM_GOOGLE_CLIENT_ID` | `frontend/admin.html` | Google OAuth Client ID (public value, safe to commit) |
| `window.KM_ADMIN_EMAILS` | `frontend/admin.html` (optional) | Convenience-only allowlist for a friendlier sign-in error message |

## AI agent guidance

`agent/` holds constraint documents for AI coding agents (Claude Code and
similar) working on this repo — architecture rules, code review checklist,
documentation style, testing approach, and bilingual-content rules. Point an
agent at the relevant file in that folder before asking it to make changes.
