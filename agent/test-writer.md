# Test Writer

You are writing or extending tests for the Kali Mandir website. This is a
static-frontend-plus-serverless-backend project with no existing test
framework wired in — set up the lightest tool that actually fits each half,
rather than reaching for a heavy default.

## Frontend (`frontend/`)

There's no build step and no bundler by design (see
`architecture-reviewer.md`), so pick tools that respect that:

- **Prefer Playwright or plain `node:test` + `jsdom`** for anything that
  needs a DOM, over introducing Jest + a full transpile pipeline this repo
  doesn't otherwise need.
- Test the things most likely to silently break on a static site like this:
  - Language toggle actually hides/shows the right `lang-el` nodes and
    persists the choice across reload (`localStorage.km_lang`).
  - Scroll-spy nav marks the correct section `.active` at realistic scroll
    positions.
  - `loadContent()` in both `index.js` and `admin.js` falls back correctly
    at each layer: JSON asset missing → emergency fallback; API unreachable
    → JSON asset; `localStorage` override present → override wins. Test
    each layer failing independently, not just the happy path.
  - The samagri checklist persists checked state across reload.
  - `apiUrl(type, params)` in both `index.js` and `admin.js` composes URLs
    correctly whether `KALI_MANDIR_API_BASE` already contains a query string
    (e.g. `...?code=xyz`, from a shared Function App's key) or not. Test both
    shapes explicitly — `apiUrl("media", {file: "x.jpg"})` must produce a
    valid, parseable URL (`new URL(...)` shouldn't throw) in either case.
    This one is easy to silently break: appending `/content` after an
    existing `?code=...` produces a URL that still *looks* plausible in a
    diff but is actually broken, since a path segment can't follow a query
    string.
  - Any function that builds HTML via template strings, when given input
    containing `<`, `>`, `"`, or `&` — confirm it's escaped (this doubles as
    an XSS regression test, see `code-reviewer.md`).
- Don't write tests that assert on exact pixel values or animation timing —
  assert on class presence (`in-view`, `active`) and DOM structure instead,
  which is what the app logic actually controls.
- Visual/responsive checks (does the diya-nav collapse to a bottom bar under
  860px) are better done with a couple of Playwright viewport snapshots than
  with unit tests — don't force a DOM assertion to cover what's really a
  layout question.

## Backend (`azure-functions/KaliMandir/run.csx`)

- **Use the Azure Functions Core Tools local runtime** (`func start`) for
  integration-style tests, rather than trying to unit-test the `.csx` file
  in isolation — the scripting model isn't built for easy dependency
  injection/mocking. Point `HOME` at a temp directory locally so tests don't
  read/write real data files.
- Every endpoint is dispatched by a `type` query parameter plus HTTP method,
  not by URL path — write tests as `(method, type, query/body) → expected
  response`, covering at minimum:
  - `type=content`, GET: no `content.json` yet → returns `{}`, not an error.
  - `type=content`, POST: missing `Authorization` header → 401. Token whose
    `aud` doesn't match `KL_GOOGLE_CLIENT_ID` → 401. Merges rather than
    replaces existing fields (post `{"hours": {...}}` twice with different
    values, confirm `schedule` from the first call survives the second).
  - `type=media`, POST: rejects a file over `KL_MEDIA_MAX_BYTES`. Rejects
    malformed base64. Returns `{filename: "..."}` — confirm it does **not**
    try to return a constructed URL (that's the frontend's job, via
    `apiUrl()`, since the function doesn't know its own externally-visible
    base URL or function key).
  - `type=media`, GET with `file=<name>`: rejects any value containing `..`,
    `/`, or `\` (path traversal). 404s for a name that was never uploaded.
  - `type=analytics`, POST: no auth required, always succeeds with valid
    JSON body. GET: requires auth, returns correctly bucketed `byDay` counts
    across a day boundary (write two events on different UTC dates, confirm
    they land in different buckets).
  - Missing or unrecognized `type` → falls through to the status/routes
    fallback response, not an error.
  - OPTIONS returns 204 with CORS headers, and every response path
    (including error responses, via `CorsResult`) carries
    `Access-Control-Allow-Origin`.
- Mock Google's tokeninfo endpoint rather than hitting the real network in
  tests — assert `VerifyAdminAsync`'s branches (missing header, network
  failure, bad audience, unverified email, email not on `KL_ADMIN_EMAILS`
  allowlist) independently.
- This function may be deployed on a **shared Function App** alongside
  unrelated projects, with `authLevel: "function"` (a key required for every
  invocation). Don't assume `authLevel: "anonymous"` in tests — read it from
  the actual `function.json` rather than hardcoding an assumption.

## What not to do

- Don't add a testing framework that requires `npm run build` for the
  frontend — it must stay deployable as-is to GitHub Pages.
- Don't test third-party behavior (Google Identity Services' own button
  rendering, the Function App drive's own durability) — test this repo's
  code at the boundary where it calls into those services.
