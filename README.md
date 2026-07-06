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
│   ├── KaliMandir/       # Single consolidated function
│   │   ├── function.json — HTTP trigger binding (catches all /api/* routes)
│   │   └── run.csx       — Content, Media, and Analytics endpoints in one file
│   └── local.settings.json.example — copy to local.settings.json for local dev
├── frontend/              # Static site — deploy this folder to GitHub Pages
│   ├── index.html / index.js   — public site (one JS file, only for this page)
│   ├── admin.html / admin.js   — admin CMS (one JS file, only for this page)
│   ├── styles.css              — shared design tokens + styles for both pages
│   └── assets/
│       └── default-content.json — fallback content the site ships with
└── .github/workflows/deploy.yml — publishes frontend/ to GitHub Pages
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
3. Push to `main`. `.github/workflows/deploy.yml` builds and deploys
   the `frontend/` folder automatically on every push. Check
   the **Actions** tab for the deployment URL.

## Deploy the backend (Azure Functions)

Everything below is a one-time setup. You'll need an Azure subscription and
the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
installed locally, plus the Azure CLI (`az`).

1. **Create the resource group and function app.**

   ```bash
   az group create --name kali-mandir-rg --location centralindia

   az functionapp create \
     --resource-group kali-mandir-rg \
     --consumption-plan-location centralindia \
     --runtime dotnet \
     --functions-version 4 \
     --name kalimandir-func \
     --storage-account <any-storage-account-in-your-subscription>
   ```

   Unlike the previous version, the backend no longer uses Azure Blob or Table
   Storage for content or analytics — all data is stored as JSON files on the
   Function App's own drive under `%HOME%/data/`. This means no extra storage
   account configuration is needed beyond what Azure creates by default.

2. **Set the app's configuration** (replace the placeholder values):

   ```bash
   az functionapp config appsettings set \
     --name kalimandir-func \
     --resource-group kali-mandir-rg \
     --settings \
       GOOGLE_CLIENT_ID="652232946588-qqja2g7d2qn2t930ine0p601b464obr9.apps.googleusercontent.com" \
       ADMIN_EMAILS="your-admin-email@gmail.com" \
       ALLOWED_ORIGIN="https://your-github-username.github.io" \
       MEDIA_MAX_BYTES="5242880"
   ```

   `ADMIN_EMAILS` is the real security gate — the backend rejects requests
   from any signed-in Google account not on this list, regardless of what the
   client-side check in admin.html says.

3. **Publish the function.** Run this from the `azure-functions/` folder:

   ```bash
   cd azure-functions
   func azure functionapp publish kalimandir-func
   ```

4. **Enable CORS in the Azure Portal.** Go to your Function App →
   **API → CORS**, add your GitHub Pages origin (e.g.
   `https://your-username.github.io`), and save. This is separate from the
   CORS headers the function adds itself — Azure's own CORS layer must also
   allow the origin.

5. **Point the frontend at it.** In `frontend/index.html` and
   `frontend/admin.html`, set:

   ```js
   window.KALI_MANDIR_API_BASE =
     "https://communication-fn.azurewebsites.net/api/KaliMandir?code=ybuYDQDF-EC2Fn0ez0UoT9bA0NCDprTb-rsvlb1GNHmVAzFuzGUvPw==";
   ```

   Commit and push — the GitHub Pages deploy picks it up automatically.

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

## Themes

The site ships with four selectable color themes, switched via the small
circular swatch button next to the language toggle (top right on the public
site; top bar on the admin panel): **Kali Night** (dark maroon, the
original default), **Dusk** (a lighter deep plum), **Marigold** (light warm
ivory), and **Sandstone** (light terracotta/sand). The choice is saved per
browser in `localStorage` — each visitor keeps their own preference.

Every color in `styles.css` is a CSS custom property scoped under
`html[data-theme="..."]`, so adding a fifth theme is just adding one more
block with the same set of variable names (copy an existing block and
adjust the hex values) — see the comment at the top of `styles.css` for the
full token list, and `agent/architecture-reviewer.md` for the rule about
never hardcoding a color outside those blocks.

To change the **default** theme new visitors see (currently "dark"), edit
the fallback value in the `initTheme()` function in both `index.js` and
`admin.js`:

```js
const theme = THEMES.includes(saved) ? saved : "dark"; // change "dark" to e.g. "marigold"
```

## How content editing works

- The Samagri tab supports any number of separate, named lists (Daily, Kali
  Puja Special, Navratri, etc.) — each renders on the public site as its own
  collapsible table with Download (.txt) and Print buttons. Add or remove
  whole lists, or individual items within a list, from the admin panel.
- Gallery photos open in a full-screen lightbox on click, with Previous/Next
  navigation and Escape-to-close.
- The Contact Us section shows two temple-committee photos (Priest, Trustee,
  or whatever roles you set) — edit names, roles, and photos from the
  Donations & Contact tab.
- Visiting Hours has a separate, highlighted schedule for the temple's
  biggest-turnout days (Saturday & Tuesday by default) alongside the
  standard hours for every other day — both editable from the Hours tab.
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

| Variable                      | Where it's set                                               | Purpose                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`            | Azure Function App setting                                   | Must match `window.KM_GOOGLE_CLIENT_ID`; used to verify admin tokens were issued for this app. Already set to the real Client ID. |
| `ADMIN_EMAILS`                | Azure Function App setting                                   | Comma-separated list of Google account emails allowed to make admin changes — the real server-side access gate                    |
| `ALLOWED_ORIGIN`              | Azure Function App setting                                   | Your GitHub Pages origin for CORS, e.g. `https://your-name.github.io`                                                             |
| `MEDIA_MAX_BYTES`             | Azure Function App setting (optional, defaults to `5242880`) | Per-file upload size cap in bytes (5 MB default)                                                                                  |
| `window.KALI_MANDIR_API_BASE` | `frontend/index.html` + `frontend/admin.html`                | Base URL of the deployed Azure Functions API                                                                                      |
| `window.KM_GOOGLE_CLIENT_ID`  | `frontend/admin.html`                                        | Google OAuth Client ID (public value, already set)                                                                                |
| `window.KM_ADMIN_EMAILS`      | `frontend/admin.html` (optional)                             | Convenience-only allowlist for a friendlier sign-in error message                                                                 |

> **Note on storage:** The previous version used Azure Blob Storage for content
> and Azure Table Storage for analytics. The consolidated backend now stores
> everything as JSON files on the Function App's own drive (`%HOME%/data/`),
> following the same pattern as the PratapTravels reference function. This
> removes the need for separate storage account containers or Table Storage
> configuration — the only Azure resource needed is the Function App itself.

## AI agent guidance

`agent/` holds constraint documents for AI coding agents (Claude Code and
similar) working on this repo — architecture rules, code review checklist,
documentation style, testing approach, and bilingual-content rules. Point an
agent at the relevant file in that folder before asking it to make changes.
