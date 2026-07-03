#r "nuget: Newtonsoft.Json, 13.0.3"

using System.Net.Http;
using Newtonsoft.Json.Linq;

/* Shared across modules with:  #load "../Shared/GoogleAuth.csx"

   Verifies a Google ID token server-side via Google's tokeninfo endpoint
   and checks the caller's email against the ADMIN_EMAILS allowlist.
   This is the ONLY real security boundary for admin actions — the
   client-side allowlist check in admin.js is convenience UX, not security,
   since anything client-side can be bypassed by calling the API directly. */

public static class GoogleAuth
{
    private static readonly HttpClient http = new HttpClient();

    public static async Task<(bool ok, string error, string email)> VerifyAdminAsync(HttpRequestMessage req, ILogger log)
    {
        var authHeader = req.Headers.Authorization;
        if (authHeader == null || string.IsNullOrWhiteSpace(authHeader.Parameter))
        {
            return (false, "Missing Authorization header.", null);
        }

        string token = authHeader.Parameter;
        string expectedAudience = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID");
        string adminEmailsRaw = Environment.GetEnvironmentVariable("ADMIN_EMAILS") ?? "";
        var adminEmails = adminEmailsRaw.Split(',')
            .Select(e => e.Trim().ToLowerInvariant())
            .Where(e => e.Length > 0)
            .ToHashSet();

        HttpResponseMessage tokenInfoResponse;
        try
        {
            tokenInfoResponse = await http.GetAsync(
                $"https://oauth2.googleapis.com/tokeninfo?id_token={Uri.EscapeDataString(token)}");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to reach Google tokeninfo endpoint.");
            return (false, "Could not verify token right now. Try again shortly.", null);
        }

        if (!tokenInfoResponse.IsSuccessStatusCode)
        {
            return (false, "Invalid or expired sign-in token. Please sign in again.", null);
        }

        var info = JObject.Parse(await tokenInfoResponse.Content.ReadAsStringAsync());
        string aud = info.Value<string>("aud");
        string email = info.Value<string>("email");
        string emailVerified = info.Value<string>("email_verified");

        if (string.IsNullOrEmpty(expectedAudience) || aud != expectedAudience)
        {
            return (false, "Token was not issued for this app.", null);
        }
        if (emailVerified != "true")
        {
            return (false, "Google account email is not verified.", null);
        }
        if (adminEmails.Count > 0 && !adminEmails.Contains((email ?? "").ToLowerInvariant()))
        {
            return (false, $"{email} is not on the temple's admin list.", email);
        }

        return (true, null, email);
    }
}
