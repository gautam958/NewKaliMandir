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

## Backend (`azure-functions/`)

- **Use the Azure Functions Core Tools local runtime** (`func start`) for
  integration-style tests against a real (local) storage emulator (Azurite),
  rather than trying to unit-test `.csx` files in isolation — the scripting
  model isn't built for easy dependency injection/mocking.
- For each module, cover at minimum:
  - `Content`: GET with no blob yet returns `{}`, not an error. POST without
    an `Authorization` header returns 401. POST with a token whose `aud`
    doesn't match `GOOGLE_CLIENT_ID` returns 401. POST merges rather than
    replaces existing fields (post `{"hours": {...}}` twice with different
    values, confirm `schedule` from the first call survives the second).
  - `Media`: rejects a file over `MEDIA_MAX_BYTES`. Rejects malformed
    base64. Returns a URL that's actually publicly fetchable after upload.
  - `Analytics`: POST requires no auth and always succeeds with valid JSON.
    GET requires auth and returns correctly bucketed `byDay` counts across a
    day boundary (write two events on different UTC dates, confirm they land
    in different buckets).
  - Every module: OPTIONS returns 204 with CORS headers, and every response
    path (including error responses) carries `Access-Control-Allow-Origin`.
- Mock Google's tokeninfo endpoint rather than hitting the real network in
  tests — assert `GoogleAuth.VerifyAdminAsync`'s branches (missing header,
  network failure, bad audience, unverified email, email not on allowlist)
  independently.

## What not to do

- Don't add a testing framework that requires `npm run build` for the
  frontend — it must stay deployable as-is to GitHub Pages.
- Don't test third-party behavior (Google Identity Services' own button
  rendering, Azure Blob Storage's own durability) — test this repo's code
  at the boundary where it calls into those services.
