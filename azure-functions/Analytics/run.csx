#load "../Shared/Cors.csx"
#load "../Shared/GoogleAuth.csx"
#r "nuget: Azure.Data.Tables, 12.8.3"
#r "nuget: Newtonsoft.Json, 13.0.3"

using System.Net;
using System.Net.Http;
using System.Text;
using Azure.Data.Tables;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/*
  Module: Analytics
  Route:  POST /api/analytics  — anonymous. Logs one page-view event.
          GET  /api/analytics  — admin-only. Returns an aggregate for the
                                  dashboard: total views, per-day counts for
                                  the last 30 days, and top pages.

  Storage: Azure Table Storage, table "AnalyticsEvents". Table storage suits
  this better than a JSON blob because page views are frequent, independent
  writes — a table avoids the read-modify-write race a shared blob would hit
  under concurrent traffic.

  Note: this is anonymous, aggregate traffic counting (view counts per page/
  day), not personal visitor tracking — no cookies or identifiers are stored.
*/

public static async Task<HttpResponseMessage> Run(HttpRequestMessage req, ILogger log)
{
    var allowedOrigin = GetAllowedOrigin();

    if (req.Method == HttpMethod.Options)
    {
        return WithCors(new HttpResponseMessage(HttpStatusCode.NoContent), allowedOrigin);
    }

    var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage");
    var tableClient = new TableClient(connectionString, "AnalyticsEvents");
    await tableClient.CreateIfNotExistsAsync();

    if (req.Method == HttpMethod.Post)
    {
        JObject payload;
        try { payload = JObject.Parse(await req.Content.ReadAsStringAsync()); }
        catch (Exception) { payload = new JObject(); }

        string path = payload.Value<string>("path") ?? "/";
        var now = DateTimeOffset.UtcNow;
        var entity = new TableEntity(now.ToString("yyyy-MM-dd"), Guid.NewGuid().ToString("N"))
        {
            { "Path", path },
            { "Timestamp", now }
        };
        await tableClient.AddEntityAsync(entity);

        return WithCors(new HttpResponseMessage(HttpStatusCode.NoContent), allowedOrigin);
    }

    if (req.Method == HttpMethod.Get)
    {
        var authResult = await GoogleAuth.VerifyAdminAsync(req, log);
        if (!authResult.ok)
        {
            var err = new JObject { ["error"] = authResult.error };
            return WithCors(new HttpResponseMessage(HttpStatusCode.Unauthorized)
            {
                Content = new StringContent(err.ToString(Formatting.None), Encoding.UTF8, "application/json")
            }, allowedOrigin);
        }

        var since = DateTimeOffset.UtcNow.AddDays(-30).ToString("yyyy-MM-dd");
        var byDay = new JObject();
        var byPath = new Dictionary<string, int>();
        int total = 0;

        await foreach (var entity in tableClient.QueryAsync<TableEntity>(e => string.Compare(e.PartitionKey, since) >= 0))
        {
            total++;
            string day = entity.PartitionKey;
            byDay[day] = (byDay[day]?.Value<int>() ?? 0) + 1;
            string path = entity.GetString("Path") ?? "/";
            byPath[path] = byPath.TryGetValue(path, out var c) ? c + 1 : 1;
        }

        var result = new JObject
        {
            ["total"] = total,
            ["byDay"] = byDay,
            ["byPath"] = JObject.FromObject(byPath.OrderByDescending(kv => kv.Value).Take(10).ToDictionary(kv => kv.Key, kv => kv.Value))
        };

        return WithCors(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(result.ToString(Formatting.None), Encoding.UTF8, "application/json")
        }, allowedOrigin);
    }

    return WithCors(new HttpResponseMessage(HttpStatusCode.MethodNotAllowed), allowedOrigin);
}
