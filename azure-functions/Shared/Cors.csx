using System.Net;
using System.Net.Http;

/* Shared across modules with:  #load "../Shared/Cors.csx"
   Set ALLOWED_ORIGIN in Function App settings to your GitHub Pages origin,
   e.g. https://your-username.github.io — avoid leaving this as "*" once
   POST endpoints carry real admin actions. */

public static HttpResponseMessage WithCors(HttpResponseMessage res, string allowedOrigin)
{
    res.Headers.Add("Access-Control-Allow-Origin", string.IsNullOrEmpty(allowedOrigin) ? "*" : allowedOrigin);
    res.Headers.Add("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return res;
}

public static string GetAllowedOrigin()
{
    return Environment.GetEnvironmentVariable("ALLOWED_ORIGIN") ?? "*";
}
