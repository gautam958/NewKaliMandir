/*
  Kali Mandir — Single Consolidated Azure Function
  =================================================
  All three previous modules (Content, Media, Analytics) merged into one
  .csx file following the pattern from the reference PratapTravels function.

  Routes (all under /api/):
    GET  /api/content          — public: return site content JSON
    POST /api/content          — admin: merge-update site content JSON
    POST /api/media            — admin: save uploaded image to disk, return path
    POST /api/analytics        — anonymous: log a page-view event
    GET  /api/analytics        — admin: return per-day view counts (last 30 days)

  Storage: all data lives as JSON files under %HOME%/data/ on the Function
  App drive — exactly the same pattern as the PratapTravels reference function.
  No Azure Blob Storage or Table Storage SDK dependencies required.

  Auth: admin endpoints require "Authorization: Bearer <Google ID token>".
  The token is verified against Google's tokeninfo endpoint and the caller's
  email is checked against ADMIN_EMAILS (env var, comma-separated).
  GOOGLE_CLIENT_ID (env var) must match the token's `aud` claim.

  Environment variables (set in Azure Portal → Function App → Configuration):
    KL_GOOGLE_CLIENT_ID   — OAuth 2.0 Client ID (the public identifier, not the secret)
    KL_ADMIN_EMAILS       — comma-separated list of authorised admin email addresses
    KL_ALLOWED_ORIGIN     — your GitHub Pages origin, e.g. https://your-name.github.io
    KL_MEDIA_MAX_BYTES    — optional, per-file upload cap in bytes (default: 5242880 = 5 MB)
*/

#r "Microsoft.Azure.WebJobs.Extensions.Http"
#r "Microsoft.AspNetCore.Http"
#r "Microsoft.AspNetCore.Mvc"   
#r "Newtonsoft.Json"

using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
public static async Task<IActionResult> Run(HttpRequest req, ILogger log)
{
    log.LogInformation($"KaliMandir function triggered. Method={req.Method} Path={req.Path}");

    // ── CORS ─────────────────────────────────────────────────────────────────
    string origin = req.Headers["Origin"].FirstOrDefault() ?? "";
    string allowedOrigin = Environment.GetEnvironmentVariable("KL_ALLOWED_ORIGIN") ?? "*";

    // If the client's origin matches, echo it back; otherwise allow the
    // configured ALLOWED_ORIGIN (or * for open access during local dev).
    string responseOrigin = (allowedOrigin == "*" || origin == allowedOrigin)
        ? (string.IsNullOrEmpty(origin) ? "*" : origin)
        : allowedOrigin;

    // Preflight – always allow so the browser never hits a CORS wall.
    if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
    {
        return CorsResult(new NoContentResult(), responseOrigin);
    }

    // Block non-matching origins (skip when ALLOWED_ORIGIN is "*").
    if (allowedOrigin != "*" && !string.IsNullOrEmpty(origin) && origin != allowedOrigin)
    {
        log.LogWarning($"Blocked request from unauthorized origin: {origin}");
        return CorsResult(new StatusCodeResult(403), responseOrigin);
    }

    // ── File paths ───────────────────────────────────────────────────────────
    string rootPath = Environment.GetEnvironmentVariable("HOME") ?? AppContext.BaseDirectory;
    string dataDir  = Path.Combine(rootPath, "data");
    Directory.CreateDirectory(dataDir);
    Directory.CreateDirectory(Path.Combine(dataDir, "media")); // sub-folder for image files

    string contentFilePath   = Path.Combine(dataDir, "content.json");
    string analyticsFilePath = Path.Combine(dataDir, "analytics.json");

    // Seed empty files if they don't exist yet.
    if (!File.Exists(contentFilePath))   File.WriteAllText(contentFilePath,   "{}");
    if (!File.Exists(analyticsFilePath)) File.WriteAllText(analyticsFilePath, "{}");

    // ── Route: which endpoint? ────────────────────────────────────────────────
    string path = req.Path.Value?.TrimEnd('/').ToLowerInvariant() ?? "";

    // Strip the /api prefix that Azure Functions adds automatically.
    if (path.StartsWith("/api")) path = path.Substring(4);

    // ═════════════════════════════════════════════════════════════════════════
    // GET /content — public, no auth
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/content" && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
    {
        string json = File.ReadAllText(contentFilePath);
        JObject content = string.IsNullOrWhiteSpace(json) ? new JObject() : JObject.Parse(json);
        return CorsResult(new OkObjectResult(content), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // POST /content — admin only: partial merge-update of content.json
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/content" && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
    {
        var auth = await VerifyAdminAsync(req, log);
        if (!auth.ok)
            return CorsResult(new UnauthorizedObjectResult(new { error = auth.error }), responseOrigin);

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject partial;
        try   { partial = JObject.Parse(requestBody); }
        catch { return CorsResult(new BadRequestObjectResult(new { error = "Body must be valid JSON." }), responseOrigin); }

        // Read → merge → write back.  MergeArrayHandling.Replace means that
        // when the admin saves a gallery array the old one is fully replaced,
        // not appended to — matching the behaviour of the previous blob-based
        // implementation and what admin.js expects.
        string existing = File.ReadAllText(contentFilePath);
        JObject current = string.IsNullOrWhiteSpace(existing) ? new JObject() : JObject.Parse(existing);
        current.Merge(partial, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });
        File.WriteAllText(contentFilePath, current.ToString(Formatting.Indented));

        log.LogInformation($"Content updated by {auth.email}");
        return CorsResult(new OkObjectResult(current), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // POST /media — admin only: save base64-encoded image to disk
    // Returns a URL path the frontend can use to fetch the image via the
    // GET /media?file=<name> endpoint below.
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/media" && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
    {
        var auth = await VerifyAdminAsync(req, log);
        if (!auth.ok)
            return CorsResult(new UnauthorizedObjectResult(new { error = auth.error }), responseOrigin);

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject payload;
        try   { payload = JObject.Parse(requestBody); }
        catch { return CorsResult(new BadRequestObjectResult(new { error = "Body must be JSON with filename, contentType, dataBase64." }), responseOrigin); }

        string filename    = payload.Value<string>("filename")    ?? "upload";
        string contentType = payload.Value<string>("contentType") ?? "image/jpeg";
        string dataBase64  = payload.Value<string>("dataBase64");

        if (string.IsNullOrEmpty(dataBase64))
            return CorsResult(new BadRequestObjectResult(new { error = "Missing dataBase64." }), responseOrigin);

        // Accept both raw base64 and full data: URLs (from FileReader.readAsDataURL).
        string base64Part = dataBase64.Contains(",")
            ? dataBase64.Substring(dataBase64.IndexOf(',') + 1)
            : dataBase64;

        byte[] bytes;
        try   { bytes = Convert.FromBase64String(base64Part); }
        catch { return CorsResult(new BadRequestObjectResult(new { error = "dataBase64 could not be decoded." }), responseOrigin); }

        long maxBytes = long.TryParse(Environment.GetEnvironmentVariable("KL_MEDIA_MAX_BYTES"), out long cfg) ? cfg : 5 * 1024 * 1024;
        if (bytes.LongLength > maxBytes)
            return CorsResult(new ObjectResult(new { error = $"File exceeds {maxBytes / (1024 * 1024)} MB limit." }) { StatusCode = 413 }, responseOrigin);

        string ext      = Path.GetExtension(filename);
        string safeName = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}{ext}";
        string savePath = Path.Combine(dataDir, "media", safeName);
        File.WriteAllBytes(savePath, bytes);

        log.LogInformation($"Media saved by {auth.email}: {safeName} ({bytes.Length} bytes)");

        // The frontend fetches images via GET /api/media?file=<safeName>
        return CorsResult(new OkObjectResult(new { filename = safeName, url = $"/api/media?file={safeName}" }), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GET /media?file=<name> — public: serve a saved image file
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/media" && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
    {
        string fileParam = req.Query["file"].FirstOrDefault() ?? "";

        // Security: only allow simple filenames — no path traversal.
        if (string.IsNullOrEmpty(fileParam) || fileParam.Contains("..") || fileParam.Contains("/") || fileParam.Contains("\\"))
            return CorsResult(new BadRequestObjectResult(new { error = "Invalid file parameter." }), responseOrigin);

        string filePath = Path.Combine(dataDir, "media", fileParam);
        if (!File.Exists(filePath))
            return CorsResult(new NotFoundObjectResult(new { error = "File not found." }), responseOrigin);

        // Determine MIME type from extension.
        string ext  = Path.GetExtension(fileParam).ToLowerInvariant();
        string mime = ext switch {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png"            => "image/png",
            ".gif"            => "image/gif",
            ".webp"           => "image/webp",
            _                 => "application/octet-stream"
        };

        byte[] fileBytes = File.ReadAllBytes(filePath);
        return new FileContentResult(fileBytes, mime);
        // NOTE: FileContentResult doesn't go through CorsResult — add CORS header manually.
        // The browser doesn't need CORS on image requests (they use <img> tags, not fetch).
    }

    // ═════════════════════════════════════════════════════════════════════════
    // POST /analytics — anonymous: append one page-view event to analytics.json
    // Uses an in-place JSON file with a per-day counter dict — simpler than
    // Table Storage and sufficient for the temple site's traffic volume.
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/analytics" && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject payload;
        try   { payload = JObject.Parse(requestBody); }
        catch { payload = new JObject(); }

        string pagePath = payload.Value<string>("path") ?? "/";
        string today    = DateTime.UtcNow.ToString("yyyy-MM-dd");

        // analytics.json structure: { "byDay": {"2026-07-04": 12, ...}, "byPath": {"/": 42, ...} }
        string existing = File.ReadAllText(analyticsFilePath);
        JObject analytics;
        try   { analytics = string.IsNullOrWhiteSpace(existing) ? new JObject() : JObject.Parse(existing); }
        catch { analytics = new JObject(); }

        var byDay  = (JObject)(analytics["byDay"]  ?? (analytics["byDay"]  = new JObject()));
        var byPath = (JObject)(analytics["byPath"] ?? (analytics["byPath"] = new JObject()));

        byDay[today]    = (byDay[today]?.Value<int>()    ?? 0) + 1;
        byPath[pagePath] = (byPath[pagePath]?.Value<int>() ?? 0) + 1;
        analytics["lastUpdated"] = DateTime.UtcNow.ToString("o");

        File.WriteAllText(analyticsFilePath, analytics.ToString(Formatting.Indented));

        return CorsResult(new NoContentResult(), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GET /analytics — admin only: return aggregate view stats
    // ═════════════════════════════════════════════════════════════════════════
    if (path == "/analytics" && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
    {
        var auth = await VerifyAdminAsync(req, log);
        if (!auth.ok)
            return CorsResult(new UnauthorizedObjectResult(new { error = auth.error }), responseOrigin);

        string existing = File.ReadAllText(analyticsFilePath);
        JObject analytics;
        try   { analytics = string.IsNullOrWhiteSpace(existing) ? new JObject() : JObject.Parse(existing); }
        catch { analytics = new JObject(); }

        var byDay  = (JObject)(analytics["byDay"]  ?? new JObject());
        var byPath = (JObject)(analytics["byPath"] ?? new JObject());

        // Filter to last 30 days only.
        string cutoff = DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-dd");
        var filteredByDay = new JObject();
        int total = 0;
        foreach (var prop in byDay.Properties())
        {
            if (string.Compare(prop.Name, cutoff) >= 0)
            {
                filteredByDay[prop.Name] = prop.Value;
                total += prop.Value.Value<int>();
            }
        }

        // Top 10 pages by view count.
        var topPaths = byPath.Properties()
            .OrderByDescending(p => p.Value.Value<int>())
            .Take(10)
            .ToDictionary(p => p.Name, p => p.Value.Value<int>());

        return CorsResult(new OkObjectResult(new {
            total    = total,
            byDay    = filteredByDay,
            byPath   = topPaths
        }), responseOrigin);
    }

    // ── Fallback ─────────────────────────────────────────────────────────────
    return CorsResult(new OkObjectResult(new {
        service = "Kali Mandir API",
        status  = "running",
        routes  = new[] {
            "GET  /api/content",
            "POST /api/content   (admin)",
            "GET  /api/media?file=<name>",
            "POST /api/media     (admin)",
            "POST /api/analytics",
            "GET  /api/analytics (admin)"
        }
    }), responseOrigin);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS helper
// Wraps any IActionResult in CORS headers so every response path carries them.
// ─────────────────────────────────────────────────────────────────────────────
private static IActionResult CorsResult(IActionResult result, string origin)
{
    // We can't mutate the response headers from a plain IActionResult without
    // middleware, so we wrap in a small decorator that adds the headers.
    return new CorsWrappedResult(result, origin);
}

private class CorsWrappedResult : IActionResult
{
    private readonly IActionResult _inner;
    private readonly string _origin;

    public CorsWrappedResult(IActionResult inner, string origin)
    {
        _inner  = inner;
        _origin = origin;
    }

    public async Task ExecuteResultAsync(ActionContext context)
    {
        context.HttpContext.Response.Headers["Access-Control-Allow-Origin"]  = _origin;
        context.HttpContext.Response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        context.HttpContext.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        await _inner.ExecuteResultAsync(context);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google ID token verification
// ─────────────────────────────────────────────────────────────────────────────
// Verifies the bearer token is a real, current Google ID token (via Google's
// tokeninfo endpoint), that it was issued for THIS app (aud check), and that
// the email is on the ADMIN_EMAILS allowlist. Reject on any failure.
//
// This is the ONLY real security boundary — the client-side check in admin.js
// is convenience UX only and can always be bypassed.
// ─────────────────────────────────────────────────────────────────────────────
private static readonly HttpClient _httpClient = new HttpClient();

private static async Task<(bool ok, string error, string email)> VerifyAdminAsync(HttpRequest req, ILogger log)
{
    string authHeader = req.Headers["Authorization"].FirstOrDefault() ?? "";
    if (!authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        return (false, "Missing or malformed Authorization header.", null);

    string token = authHeader.Substring("Bearer ".Length).Trim();
    if (string.IsNullOrEmpty(token))
        return (false, "Empty bearer token.", null);

    string expectedAudience = Environment.GetEnvironmentVariable("KL_GOOGLE_CLIENT_ID") ?? "";
    string adminEmailsRaw   = Environment.GetEnvironmentVariable("KL_ADMIN_EMAILS")     ?? "";
    var adminEmails = adminEmailsRaw
        .Split(',')
        .Select(e => e.Trim().ToLowerInvariant())
        .Where(e => e.Length > 0)
        .ToHashSet();

    HttpResponseMessage tokenInfoResponse;
    try
    {
        tokenInfoResponse = await _httpClient.GetAsync(
            $"https://oauth2.googleapis.com/tokeninfo?id_token={Uri.EscapeDataString(token)}");
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Failed to reach Google tokeninfo endpoint.");
        return (false, "Could not verify sign-in token right now. Try again shortly.", null);
    }

    if (!tokenInfoResponse.IsSuccessStatusCode)
        return (false, "Invalid or expired sign-in token. Please sign in again.", null);

    JObject info;
    try   { info = JObject.Parse(await tokenInfoResponse.Content.ReadAsStringAsync()); }
    catch { return (false, "Could not parse tokeninfo response.", null); }

    string aud           = info.Value<string>("aud")            ?? "";
    string email         = info.Value<string>("email")          ?? "";
    string emailVerified = info.Value<string>("email_verified") ?? "";

    if (string.IsNullOrEmpty(expectedAudience) || aud != expectedAudience)
        return (false, "Token was not issued for this application.", null);

    if (emailVerified != "true")
        return (false, "Google account email is not verified.", null);

    if (adminEmails.Count > 0 && !adminEmails.Contains(email.ToLowerInvariant()))
        return (false, $"{email} is not on the temple admin list.", email);

    return (true, null, email);
}
