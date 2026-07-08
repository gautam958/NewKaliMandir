/*
  Kali Mandir — Single Consolidated Azure Function
  =================================================
  All endpoints (Content, Media, Analytics) in one .csx file, dispatched by a
  `type` QUERY PARAMETER rather than the URL path.

  Why query-param dispatch: this function is deployed on a shared, multi-project
  Function App (communication-fn) behind a function-level key, so the frontend's
  base URL already ends in `?code=...`. Path segments cannot be appended after a
  query string (`{base}?code=X/content` is not a valid URL — `/content` would
  just become part of the code value). Query params compose safely instead:
  `{base}?code=X&type=content` is always valid regardless of what route Azure
  assigned to this function. This mirrors the `?type=...` dispatch pattern in
  the original PratapTravels reference function.

  Routes (all hit the same URL, distinguished by `type` + HTTP method):
    GET  ?type=content              — public: return site content JSON
    POST ?type=content              — admin:  merge-update site content JSON
    POST ?type=media                — admin:  save uploaded image to disk, return filename
    GET  ?type=media&file=<name>    — public: serve a previously uploaded image
    POST ?type=analytics            — anonymous: log a page-view event
    GET  ?type=analytics            — admin:  return per-day view counts (last 30 days)

  Storage: all data lives as JSON files under %HOME%/data/ on the Function
  App drive (same pattern as the PratapTravels reference function). No Azure
  Blob Storage or Table Storage SDK dependencies required.

  Auth: admin actions require "Authorization: Bearer <Google ID token>".
  The token is verified against Google's tokeninfo endpoint and the caller's
  email is checked against KL_ADMIN_EMAILS. KL_GOOGLE_CLIENT_ID must match
  the token's `aud` claim. This is the REAL security boundary for admin
  actions — see the note on the function-level `code` key below.

  Environment variables (set in Azure Portal → Function App → Configuration).
  Prefixed KL_ to avoid colliding with other functions/projects sharing this
  same Function App:
    KL_GOOGLE_CLIENT_ID   — OAuth 2.0 Client ID (the public identifier, not the secret)
    KL_ADMIN_EMAILS       — comma-separated list of authorised admin email addresses
    KL_ALLOWED_ORIGIN     — your GitHub Pages origin, e.g. https://your-name.github.io
    KL_MEDIA_MAX_BYTES    — optional, per-file upload cap in bytes (default: 5242880 = 5 MB)

  Note on the `?code=` function key: this gates whether the Function App will
  execute AT ALL — it stops random internet scanners from invoking the
  endpoint and running up compute costs. It is NOT a meaningful secret once
  the site is live, since it's embedded directly in index.html/admin.html's
  source (anyone can view-source and read it), exactly like the Google
  Client ID. The real access-control boundary for admin actions is the
  Google-token + KL_ADMIN_EMAILS check below, not this key.
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
    string type = req.Query["type"].FirstOrDefault() ?? "";
    log.LogInformation($"KaliMandir function triggered. Method={req.Method} type={type}");

    // ── CORS ─────────────────────────────────────────────────────────────────
    string origin = req.Headers["Origin"].FirstOrDefault() ?? "";
    string allowedOrigin = Environment.GetEnvironmentVariable("KL_ALLOWED_ORIGIN") ?? "*";

    string responseOrigin = (allowedOrigin == "*" || origin == allowedOrigin)
        ? (string.IsNullOrEmpty(origin) ? "*" : origin)
        : allowedOrigin;

    // Preflight – always allow so the browser never hits a CORS wall.
    if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
    {
        return CorsResult(new NoContentResult(), responseOrigin);
    }

    // Block non-matching origins (skip when KL_ALLOWED_ORIGIN is "*").
    if (allowedOrigin != "*" && !string.IsNullOrEmpty(origin) && origin != allowedOrigin)
    {
        log.LogWarning($"Blocked request from unauthorized origin: {origin}");
        return CorsResult(new StatusCodeResult(403), responseOrigin);
    }

    // ── File paths ───────────────────────────────────────────────────────────
    string rootPath = Environment.GetEnvironmentVariable("HOME") ?? AppContext.BaseDirectory;
    string dataDir  = Path.Combine(rootPath, "data");
    Directory.CreateDirectory(dataDir);
    Directory.CreateDirectory(Path.Combine(dataDir, "media"));

    string contentFilePath   = Path.Combine(dataDir, "content.json");
    string analyticsFilePath = Path.Combine(dataDir, "analytics.json");

    if (!File.Exists(contentFilePath))   File.WriteAllText(contentFilePath,   "{}");
    if (!File.Exists(analyticsFilePath)) File.WriteAllText(analyticsFilePath, "{}");

    bool isGet  = req.Method.Equals("GET",  StringComparison.OrdinalIgnoreCase);
    bool isPost = req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase);

    // ═════════════════════════════════════════════════════════════════════════
    // type=content, GET — public, no auth
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "content" && isGet)
    {
        string json = File.ReadAllText(contentFilePath);
        JObject content = string.IsNullOrWhiteSpace(json) ? new JObject() : JObject.Parse(json);
        return CorsResult(new OkObjectResult(content), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // type=content, POST — admin only: partial merge-update of content.json
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "content" && isPost)
    {
        var auth = await VerifyAdminAsync(req, log);
        if (!auth.ok)
            return CorsResult(new UnauthorizedObjectResult(new { error = auth.error }), responseOrigin);

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject partial;
        try   { partial = JObject.Parse(requestBody); }
        catch { return CorsResult(new BadRequestObjectResult(new { error = "Body must be valid JSON." }), responseOrigin); }

        string existing = File.ReadAllText(contentFilePath);
        JObject current = string.IsNullOrWhiteSpace(existing) ? new JObject() : JObject.Parse(existing);
        current.Merge(partial, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });
        File.WriteAllText(contentFilePath, current.ToString(Formatting.Indented));

        log.LogInformation($"Content updated by {auth.email}");
        return CorsResult(new OkObjectResult(current), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // type=media, POST — admin only: save base64-encoded image to disk.
    // Returns just the filename; the frontend builds the fetchable URL itself
    // (it already knows the base URL + code, this function does not need to
    // guess its own externally-visible address).
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "media" && isPost)
    {
        var auth = await VerifyAdminAsync(req, log);
        if (!auth.ok)
            return CorsResult(new UnauthorizedObjectResult(new { error = auth.error }), responseOrigin);

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject payload;
        try   { payload = JObject.Parse(requestBody); }
        catch { return CorsResult(new BadRequestObjectResult(new { error = "Body must be JSON with filename, contentType, dataBase64." }), responseOrigin); }

        string filename    = payload.Value<string>("filename")    ?? "upload";
        string dataBase64  = payload.Value<string>("dataBase64");

        if (string.IsNullOrEmpty(dataBase64))
            return CorsResult(new BadRequestObjectResult(new { error = "Missing dataBase64." }), responseOrigin);

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

        return CorsResult(new OkObjectResult(new { filename = safeName }), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // type=media, GET&file=<name> — public: serve a saved image file
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "media" && isGet)
    {
        string fileParam = req.Query["file"].FirstOrDefault() ?? "";

        if (string.IsNullOrEmpty(fileParam) || fileParam.Contains("..") || fileParam.Contains("/") || fileParam.Contains("\\"))
            return CorsResult(new BadRequestObjectResult(new { error = "Invalid file parameter." }), responseOrigin);

        string filePath = Path.Combine(dataDir, "media", fileParam);
        if (!File.Exists(filePath))
            return CorsResult(new NotFoundObjectResult(new { error = "File not found." }), responseOrigin);

        string ext  = Path.GetExtension(fileParam).ToLowerInvariant();
        string mime = ext switch {
            ".jpg"  => "image/jpeg",
            ".jpeg" => "image/jpeg",
            ".png"  => "image/png",
            ".gif"  => "image/gif",
            ".webp" => "image/webp",
            _       => "application/octet-stream"
        };

        byte[] fileBytes = File.ReadAllBytes(filePath);
        return new FileContentResult(fileBytes, mime);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // type=analytics, POST — anonymous: append one page-view event
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "analytics" && isPost)
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        JObject payload;
        try   { payload = JObject.Parse(requestBody); }
        catch { payload = new JObject(); }

        string pagePath = payload.Value<string>("path") ?? "/";
        string today    = DateTime.UtcNow.ToString("yyyy-MM-dd");

        string existing = File.ReadAllText(analyticsFilePath);
        JObject analytics;
        try   { analytics = string.IsNullOrWhiteSpace(existing) ? new JObject() : JObject.Parse(existing); }
        catch { analytics = new JObject(); }

        var byDay  = (JObject)(analytics["byDay"]  ?? (analytics["byDay"]  = new JObject()));
        var byPath = (JObject)(analytics["byPath"] ?? (analytics["byPath"] = new JObject()));

        byDay[today]     = (byDay[today]?.Value<int>()     ?? 0) + 1;
        byPath[pagePath] = (byPath[pagePath]?.Value<int>() ?? 0) + 1;
        analytics["lastUpdated"] = DateTime.UtcNow.ToString("o");

        File.WriteAllText(analyticsFilePath, analytics.ToString(Formatting.Indented));

        return CorsResult(new NoContentResult(), responseOrigin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // type=analytics, GET — admin only: aggregate view stats
    // ═════════════════════════════════════════════════════════════════════════
    if (type == "analytics" && isGet)
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

        var topPaths = byPath.Properties()
            .OrderByDescending(p => p.Value.Value<int>())
            .Take(10)
            .ToDictionary(p => p.Name, p => p.Value.Value<int>());

        return CorsResult(new OkObjectResult(new {
            total  = total,
            byDay  = filteredByDay,
            byPath = topPaths
        }), responseOrigin);
    }

    // ── Fallback: unknown or missing `type` ─────────────────────────────────
    return CorsResult(new OkObjectResult(new {
        service = "Kali Mandir API",
        status  = "running",
        hint    = "Pass ?type=content|media|analytics",
        routes  = new[] {
            "GET  ?type=content",
            "POST ?type=content   (admin)",
            "GET  ?type=media&file=<name>",
            "POST ?type=media     (admin)",
            "POST ?type=analytics",
            "GET  ?type=analytics (admin)"
        }
    }), responseOrigin);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS helper — wraps any IActionResult so every response path carries headers.
// ─────────────────────────────────────────────────────────────────────────────
private static IActionResult CorsResult(IActionResult result, string origin)
{
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
// Google ID token verification — the real security boundary for admin actions.
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
