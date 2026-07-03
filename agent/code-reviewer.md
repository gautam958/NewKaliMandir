# Code Reviewer

You are reviewing code changes to the Kali Mandir website for correctness,
security, and maintainability. Architecture-layer rules (file placement,
module boundaries) are covered in `architecture-reviewer.md` — assume those
already pass and focus here on the code itself.

## Frontend (vanilla JS, HTML, CSS)

- **No framework creep.** This is intentionally vanilla HTML/CSS/JS. Don't
  let a dependency on React, jQuery, a bundler, or a CSS-in-JS tool slip in
  through a "quick fix." If Tailwind or Bootstrap utility classes are used,
  they should come from the CDN link already in `<head>`, not a new build
  step.
- **Escape anything rendered via `innerHTML`.** Both `index.js` and
  `admin.js` build HTML strings from data (schedule entries, samagri items,
  gallery captions, admin-entered text). Any user- or admin-entered string
  interpolated into an `innerHTML` template must go through an escaping
  helper (see `escapeHtml`/`escapeAttr` in `admin.js`) — this is a stored-XSS
  risk otherwise, since content entered in the admin panel is later rendered
  on the public `index.html` for every visitor.
- **Bilingual parity.** Any new visible string needs both `lang-el="en"` and
  `lang-el="hi"` variants (see `language.md` for tone/translation rules).
  A PR that adds an English-only string to the public site is incomplete.
- **Respect the content-fallback chain.** New dynamic sections must read
  from `assets/default-content.json` first, then override from the API,
  then override again from `localStorage` — matching the existing
  `loadContent()` pattern in both `index.js` and `admin.js`. Don't invent a
  second, inconsistent loading path.
- **No blocking network calls on first paint.** The hero and static copy
  must render immediately; `fetch` calls for content/analytics should not
  delay `DOMContentLoaded` handlers from wiring up interactivity (scroll-spy,
  language toggle) — those must work even if the network is slow or down.
- **`localStorage` usage is a fallback, not a database.** Flag any code that
  treats `km_content_override` or `km_analytics` as the durable source of
  truth once a real backend exists — it's per-browser and easily cleared.

## Backend (C# scripting / `.csx`)

- **Every state-changing endpoint verifies the caller.** `POST /api/content`
  and `POST /api/media` must call `GoogleAuth.VerifyAdminAsync` before doing
  anything else. `POST /api/analytics` is intentionally anonymous (it's a
  page-view beacon) — don't add auth there, and don't remove it from the
  others.
- **No secrets in code or in committed config.** Connection strings, the
  Google client ID's *secret* (not the public client ID), and admin emails
  belong in Function App settings / `local.settings.json` (gitignored), never
  hardcoded in a `.csx` file. Check any new module reads config via
  `Environment.GetEnvironmentVariable`, not a literal string.
- **CORS headers on every response, including error paths.** Use
  `WithCors(...)` from `Shared/Cors.csx` on every `HttpResponseMessage` a
  module returns — a response that skips it will fail silently in the
  browser with an opaque CORS error that's hard to debug from the client
  side.
- **Validate and bound external input.** Uploaded file size (`Media`),
  JSON parse failures (`Content`), and malformed bearer tokens should return
  a clear 4xx with a JSON `{ "error": "..." }` body, not throw an unhandled
  exception that surfaces as a 500 with no explanation.
- **NuGet references pinned to a version.** `#r "nuget: Package, X.Y.Z"`
  must specify a version — an unpinned reference makes builds
  non-reproducible.

## General

- Prefer small, readable functions over clever one-liners — the next person
  touching this file may not be a C# or JS specialist; the temple committee
  may eventually hand this repo to a different volunteer developer.
- Comment *why*, not *what*, especially around the auth/CORS/storage-choice
  decisions above, since those are the parts most likely to be "fixed"
  incorrectly by someone unfamiliar with the constraints.
