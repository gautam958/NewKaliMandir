#load "../Shared/Cors.csx"
#load "../Shared/GoogleAuth.csx"
#r "nuget: Azure.Storage.Blobs, 12.19.1"
#r "nuget: Newtonsoft.Json, 13.0.3"

using System.Net;
using System.Net.Http;
using System.Text;
using Azure.Storage.Blobs;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/*
  Module: Content
  Route:  GET|POST /api/content

  GET   -> returns the current content JSON blob (public, no auth — this is
           the same data frontend/assets/default-content.json ships as a
           fallback, so the site still works before this backend exists).
  POST  -> requires "Authorization: Bearer <Google ID token>" from a signed-in
           admin (see admin.js). Verified server-side in Shared/GoogleAuth.csx.
           Body is a partial JSON object, shallow-merged into stored content.

  Storage: one JSON blob at {CONTENT_CONTAINER}/data.json in the storage
  account referenced by AzureWebJobsStorage. No database needed for this
  data's size and update frequency.
*/

public static async Task<HttpResponseMessage> Run(HttpRequestMessage req, ILogger log)
{
    var allowedOrigin = GetAllowedOrigin();

    if (req.Method == HttpMethod.Options)
    {
        return WithCors(new HttpResponseMessage(HttpStatusCode.NoContent), allowedOrigin);
    }

    var containerName = Environment.GetEnvironmentVariable("CONTENT_CONTAINER") ?? "content";
    var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage");
    var containerClient = new BlobContainerClient(connectionString, containerName);
    await containerClient.CreateIfNotExistsAsync();
    var blobClient = containerClient.GetBlobClient("data.json");

    if (req.Method == HttpMethod.Get)
    {
        JObject current = await ReadBlobAsJson(blobClient) ?? new JObject();
        return WithCors(JsonResponse(HttpStatusCode.OK, current), allowedOrigin);
    }

    if (req.Method == HttpMethod.Post)
    {
        var authResult = await GoogleAuth.VerifyAdminAsync(req, log);
        if (!authResult.ok)
        {
            return WithCors(JsonResponse(HttpStatusCode.Unauthorized, new JObject { ["error"] = authResult.error }), allowedOrigin);
        }

        string body = await req.Content.ReadAsStringAsync();
        JObject partial;
        try
        {
            partial = JObject.Parse(body);
        }
        catch (Exception)
        {
            return WithCors(JsonResponse(HttpStatusCode.BadRequest, new JObject { ["error"] = "Body must be valid JSON." }), allowedOrigin);
        }

        JObject current = await ReadBlobAsJson(blobClient) ?? new JObject();
        current.Merge(partial, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });

        var bytes = Encoding.UTF8.GetBytes(current.ToString(Formatting.None));
        using (var stream = new MemoryStream(bytes))
        {
            await blobClient.UploadAsync(stream, overwrite: true);
        }

        log.LogInformation($"Content updated by {authResult.email}");
        return WithCors(JsonResponse(HttpStatusCode.OK, current), allowedOrigin);
    }

    return WithCors(new HttpResponseMessage(HttpStatusCode.MethodNotAllowed), allowedOrigin);
}

private static async Task<JObject> ReadBlobAsJson(BlobClient blobClient)
{
    if (!await blobClient.ExistsAsync()) return null;
    var download = await blobClient.DownloadContentAsync();
    var text = download.Value.Content.ToString();
    if (string.IsNullOrWhiteSpace(text)) return null;
    return JObject.Parse(text);
}

private static HttpResponseMessage JsonResponse(HttpStatusCode status, JObject body)
{
    return new HttpResponseMessage(status)
    {
        Content = new StringContent(body.ToString(Formatting.None), Encoding.UTF8, "application/json")
    };
}
