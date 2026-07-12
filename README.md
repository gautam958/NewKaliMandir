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
│   │   ├── function.json — HTTP trigger binding (function-level auth key)
│   │   └── run.csx       — Content, Media, and Analytics, dispatched by ?type=
│   └── local.settings.json.example — copy to local.settings.json for local dev
├── frontend/              # Static site — deploy this folder to GitHub Pages
│   ├── index.html / index.js   — public site (one JS file, only for this page)
│   ├── admin.html / admin.js   — admin CMS (one JS file, only for this page)
│   ├── styles.css              — shared design tokens + styles for both pages
│   ├── favicon.ico / favicon.svg / apple-touch-icon.png / android-chrome-*.png
│   ├── site.webmanifest        — Android/PWA home-screen icon metadata
│   └── assets/
│       ├── default-content.json — fallback content the site ships with
│       └── img/                 — bundled default photos (temple, gallery, hero)
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

Then open `http://localhost:8080`. The admin panel (`/admin.html`) requires a
real Google sign-in — see "Set up Google Sign-In" below. There is no demo/
preview login; every admin session is a real, verified Google account.

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

**Current live setup:** this site's backend runs on a **shared, multi-project
Function App** (not a dedicated one), reachable at a fixed URL that already
includes a function-level access key:

```
https://communication-fn.azurewebsites.net/api/KaliMandir?code=<key>
```

Because that URL already ends in a query string, the frontend never appends
path segments to it (`{base}/content` would be an invalid URL — the `/content`
would land inside the `code` value). Instead, every request adds a `type`
query parameter: `{base}&type=content`, `{base}&type=media`, etc. Both
`index.js` and `admin.js` build these URLs via a small `apiUrl(type, params)`
helper — if you ever change `KALI_MANDIR_API_BASE`, you don't need to touch
anything else, the helper composes the query string correctly either way
(it also works with a plain base URL with no existing `?`, for a
dedicated Function App).

Because this Function App hosts other projects too, every setting is
prefixed `KL_` to avoid colliding with their environment variables:

| Variable | Purpose |
|---|---|
| `KL_GOOGLE_CLIENT_ID` | Must match `window.KM_GOOGLE_CLIENT_ID` — verifies admin tokens were issued for this app |
| `KL_ADMIN_EMAILS` | Comma-separated list of Google emails allowed to make admin changes — the real access gate |
| `KL_ALLOWED_ORIGIN` | Your GitHub Pages origin, for CORS |
| `KL_MEDIA_MAX_BYTES` | Optional, defaults to `5242880` (5 MB) — per-file upload cap |

**Note on the `?code=` key:** this only gates whether the Function App will
execute at all (keeps random bots from running up compute costs) — it is
**not** a secret once the site is live, since it's sitting in plain sight in
`index.html`/`admin.html`'s source. The real access-control boundary for
admin actions is the Google-token + `KL_ADMIN_EMAILS` check inside the
function, not this key.

### Deploying from scratch (a new, dedicated Function App)

If you'd rather run this on its own Function App instead of a shared one,
the code supports that too — a plain base URL with no existing `?code=`
works fine with the same `apiUrl()` helper.

1. **Create the resource group and function app:**

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

   No Blob or Table Storage setup needed — all data is stored as JSON files
   on the Function App's own drive under `%HOME%/data/`.

2. **Set the app's configuration** (same `KL_`-prefixed names as above,
   regardless of whether the Function App is shared or dedicated):

   ```bash
   az functionapp config appsettings set \
     --name kalimandir-func \
     --resource-group kali-mandir-rg \
     --settings \
       KL_GOOGLE_CLIENT_ID="652232946588-qqja2g7d2qn2t930ine0p601b464obr9.apps.googleusercontent.com" \
       KL_ADMIN_EMAILS="your-admin-email@gmail.com" \
       KL_ALLOWED_ORIGIN="https://your-github-username.github.io" \
       KL_MEDIA_MAX_BYTES="5242880"
   ```

3. **Publish the function.** Run this from the `azure-functions/` folder:

   ```bash
   cd azure-functions
   func azure functionapp publish kalimandir-func
   ```

   If deployed with `"authLevel": "function"` (the current setting in
   `function.json`), Azure auto-generates a function key — copy it from
   Function App → **Functions → KaliMandir → Function Keys** and append it
   as `?code=<key>` on the base URL you set on the frontend, below. Switch
   `authLevel` to `"anonymous"` in `function.json` before publishing if you'd
   rather not use a key at all (relies solely on the Google-token check for
   admin actions, with content/media reads fully open).

4. **Enable CORS in the Azure Portal.** Function App → **API → CORS**, add
   your GitHub Pages origin, and save. This is separate from the CORS
   headers the function adds itself — Azure's own CORS layer must also
   allow the origin.

5. **Point the frontend at it.** In `frontend/index.html` and
   `frontend/admin.html`, set:

   ```js
   window.KALI_MANDIR_API_BASE = "https://kalimandir-func.azurewebsites.net/api/KaliMandir?code=<key>";
   // or, with authLevel "anonymous" and no key:
   window.KALI_MANDIR_API_BASE = "https://kalimandir-func.azurewebsites.net/api/KaliMandir";
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
3. Copy the generated **Client ID** into `frontend/admin.html` (already done
   for this deployment):

   ```js
   window.KM_GOOGLE_CLIENT_ID = "652232946588-qqja2g7d2qn2t930ine0p601b464obr9.apps.googleusercontent.com";
   ```

4. Set the **same** client ID as the `KL_GOOGLE_CLIENT_ID` app setting on the
   Function App — the backend checks that tokens were issued for this exact
   client ID.
5. Add each authorized admin's Google account email to `KL_ADMIN_EMAILS` on
   the Function App. This server-side list is the real security boundary.
   `window.KM_ADMIN_EMAILS` in `admin.html` is optional and only produces a
   friendlier in-browser error message — it does not grant or restrict
   access by itself.

There is no demo/bypass login — `admin.html` only ever shows the real Google
Sign-In button (once `KM_GOOGLE_CLIENT_ID` is set) with no fallback path.

**Session expiry:** Google ID tokens last about an hour. `admin.js` checks
the token's own `exp` claim on every load (so a refresh after it's expired
goes straight back to the login screen, not a half-working admin app), and
also catches a 401/403 from the backend if the token expires while the tab
is already open — either way, the person sees a clear "Your session
expired, please sign in again" message rather than silently-failing saves.

## Themes

The site ships with six selectable color themes, switched via the small
circular swatch button next to the language toggle (top right on the public
site; top bar on the admin panel):

| Theme | Mood |
|---|---|
| **Kali Night** | Dark maroon-black, the original default |
| **Dusk** | A lighter, deep plum |
| **Royal Purple** | Dark indigo-purple, regal |
| **Marigold** | Light warm ivory/cream |
| **Sandstone** | Light terracotta/sand |
| **Lotus** | Light soft blush-pink |

The choice is saved per browser in `localStorage` — each visitor keeps their
own preference.

Every color in `styles.css` is a CSS custom property scoped under
`html[data-theme="..."]`, so adding a seventh theme is just adding one more
block with the same set of variable names (copy an existing block and
adjust the hex values), then adding a matching button in the `.theme-menu`
markup in both `index.html` and `admin.html`, and the theme's key to the
`THEMES` array in both `index.js` and `admin.js` — see the comment at the
top of `styles.css` for the full token list, and
`agent/architecture-reviewer.md` for the rule about never hardcoding a
color outside those blocks. Every new theme's tokens should be checked
against WCAG AA contrast (4.5:1 for body text) before shipping — a couple
of the existing light themes needed their gold/muted tones darkened a
noticeable amount from a first pass to actually clear that bar on a light
background.

To change the **default** theme new visitors see (currently "dark"), edit
the fallback value in the `initTheme()` function in both `index.js` and
`admin.js`:
```js
const theme = THEMES.includes(saved) ? saved : "dark"; // change "dark" to e.g. "marigold"
```

## Visitor analytics

`index.html` (only — never `admin.html`) sends a `track_visitor` beacon on
every page load, which does two things server-side:

1. Increments simple page-view counters (same as before — total views,
   views by day, views by page).
2. Records an anonymous visitor: a random ID is generated in the visitor's
   browser on first visit (`localStorage`, no cookies), and the *first* time
   the backend sees that ID it resolves the visitor's approximate country,
   state, and city from their IP address via [ip-api.com](http://ip-api.com)'s
   free GeoIP API. Every later visit from the same browser just increments a
   visit counter and reuses the cached location — it doesn't re-query GeoIP
   or track anything beyond that counter and timestamp.

The admin Analytics tab shows: total/new/repeat visitor counts, top
countries/states/cities, a recent-visitors table (IP, location, visit count,
last seen), and the existing page-view chart. Visitor/location data only
appears once the Azure backend is connected — it can't be simulated in local
preview, since geo-IP lookup has to happen server-side.

**Worth knowing:** this stores visitor IP addresses and approximate location
in `%HOME%/data/visitors.json`. That's completely standard practice (every
major analytics tool does the same), but if the temple's site draws visitors
from places with stricter privacy rules (the EU, for instance), a short
privacy note on the site mentioning that visits are logged anonymously would
be a reasonable, low-effort thing to add — this repo doesn't currently
include one.

## Performance & mobile reliability

- **Every backend `fetch()` call has a hard timeout** (`fetchWithTimeout()` in
  both `index.js` and `admin.js`, 4–20 seconds depending on the call). Plain
  `fetch()` has no built-in timeout — on a flaky mobile connection, an
  unreachable or slow backend can hang far longer than any visitor will
  wait, and since the hero photo, gallery, and every other dynamic section
  only render *after* `loadContent()` resolves, a hung fetch stalls the
  entire page, not just the network call. If you add a new `fetch()` call
  anywhere in either file, wrap it in `fetchWithTimeout()` rather than
  calling `fetch()` directly, or you'll reintroduce this failure mode.
- **Gallery photos are lazy-loaded** (`<img loading="lazy" decoding="async">`,
  with an opacity fade-in tied to the real `onload` event, not just the `src`
  attribute being set). CSS `background-image` — used for the hero and
  slider, deliberately — is *not* natively lazy-loadable by browsers, which
  is why the gallery specifically uses real `<img>` tags: 11 photos loading
  eagerly on page load was a meaningful chunk of avoidable weight low down
  the page most visitors haven't scrolled to yet.
- **The hero photo is preloaded** (`<link rel="preload" as="image">` in
  `index.html`, pointed at the default hero image) since, unlike the
  gallery, it's above the fold and should load with priority, not be
  deferred.
- Default photos are compressed to ~900px on the long edge / quality 74 —
  intentionally modest, since the hero gets a gradient overlay and gallery
  photos display at small grid-cell sizes, so little of a higher-fidelity
  source would actually be visible. If you add new photos via the CMS, they
  aren't run through this same compression (the admin upload path stores
  whatever the browser produces from the selected file) — keep uploads
  reasonably sized for the same mobile-friendliness.

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

| Variable | Where it's set | Purpose |
|---|---|---|
| `KL_GOOGLE_CLIENT_ID` | Azure Function App setting | Must match `window.KM_GOOGLE_CLIENT_ID`; used to verify admin tokens were issued for this app. Already set to the real Client ID. |
| `KL_ADMIN_EMAILS` | Azure Function App setting | Comma-separated list of Google account emails allowed to make admin changes — the real server-side access gate |
| `KL_ALLOWED_ORIGIN` | Azure Function App setting | Your GitHub Pages origin for CORS, e.g. `https://your-name.github.io` |
| `KL_MEDIA_MAX_BYTES` | Azure Function App setting (optional, defaults to `5242880`) | Per-file upload size cap in bytes (5 MB default) |
| `window.KALI_MANDIR_API_BASE` | `frontend/index.html` + `frontend/admin.html` | Base URL of the deployed Azure Functions API — may already include `?code=...` if using function-level auth on a shared Function App |
| `window.KM_GOOGLE_CLIENT_ID` | `frontend/admin.html` | Google OAuth Client ID (public value, already set) |
| `window.KM_ADMIN_EMAILS` | `frontend/admin.html` (optional) | Convenience-only allowlist for a friendlier sign-in error message |

The `KL_` prefix (rather than plain `GOOGLE_CLIENT_ID`, etc.) exists because
this backend may run on a Function App shared with other, unrelated
projects — the prefix avoids clashing with their environment variables.

> **Note on storage:** all content, analytics, visitor records, and uploaded
> images are stored as JSON/binary files on the Function App's own drive
> (`%HOME%/data/content.json`, `analytics.json`, `visitors.json`, `media/`),
> following the PratapTravels reference pattern — no Blob or Table Storage
> needed. The Function App drive persists within a deployment but isn't
> backed up automatically; back up periodically via `GET ?type=content` if
> you redeploy or scale beyond a single instance.

## AI agent guidance

`agent/` holds constraint documents for AI coding agents (Claude Code and
similar) working on this repo — architecture rules, code review checklist,
documentation style, testing approach, and bilingual-content rules. Point an
agent at the relevant file in that folder before asking it to make changes.
