#load "../Shared/Cors.csx"
#load "../Shared/GoogleAuth.csx"
#r "nuget: Azure.Storage.Blobs, 12.19.1"
#r "nuget: Newtonsoft.Json, 13.0.3"

using System.Net;
using System.Net.Http;
using System.Text;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

/*
  Module: Media
  Route:  POST /api/media   (admin-only — see Shared/GoogleAuth.csx)

  Body:   { "filename": "aarti.jpg", "contentType": "image/jpeg", "dataBase64": "..." }
  Reply:  { "url": "https://<account>.blob.core.windows.net/media/<generated-name>" }

  Used by admin.js for the Gallery and Donation-QR uploaders once
  KALI_MANDIR_API_BASE is set — replaces the browser-only localStorage
  data-URL storage used in local preview mode with real, shareable URLs
  that index.js can render for every visitor.

  A 5 MB per-file cap is enforced here; raise MEDIA_MAX_BYTES if the
  temple committee needs larger uploads (e.g. short videos).
*/

private const long DefaultMaxBytes = 5 * 1024 * 1024;

public static async Task<HttpResponseMessage> Run(HttpRequestMessage req, ILogger log)
{
    var allowedOrigin = GetAllowedOrigin();

    if (req.Method == HttpMethod.Options)
    {
        return WithCors(new HttpResponseMessage(HttpStatusCode.NoContent), allowedOrigin);
    }

    var authResult = await GoogleAuth.VerifyAdminAsync(req, log);
    if (!authResult.ok)
    {
        return WithCors(ErrorResponse(HttpStatusCode.Unauthorized, authResult.error), allowedOrigin);
    }

    JObject payload;
    try
    {
        payload = JObject.Parse(await req.Content.ReadAsStringAsync());
    }
    catch (Exception)
    {
        return WithCors(ErrorResponse(HttpStatusCode.BadRequest, "Body must be JSON with filename, contentType, dataBase64."), allowedOrigin);
    }

    string filename = payload.Value<string>("filename") ?? "upload";
    string contentType = payload.Value<string>("contentType") ?? "application/octet-stream";
    string dataBase64 = payload.Value<string>("dataBase64");

    if (string.IsNullOrEmpty(dataBase64))
    {
        return WithCors(ErrorResponse(HttpStatusCode.BadRequest, "Missing dataBase64."), allowedOrigin);
    }

    byte[] bytes;
    try
    {
        // Accept both raw base64 and full data: URLs from FileReader.readAsDataURL.
        var base64Part = dataBase64.Contains(",") ? dataBase64.Substring(dataBase64.IndexOf(',') + 1) : dataBase64;
        bytes = Convert.FromBase64String(base64Part);
    }
    catch (Exception)
    {
        return WithCors(ErrorResponse(HttpStatusCode.BadRequest, "dataBase64 could not be decoded."), allowedOrigin);
    }

    long maxBytes = long.TryParse(Environment.GetEnvironmentVariable("MEDIA_MAX_BYTES"), out var configured) ? configured : DefaultMaxBytes;
    if (bytes.LongLength > maxBytes)
    {
        return WithCors(ErrorResponse(HttpStatusCode.RequestEntityTooLarge, $"File exceeds {maxBytes / (1024 * 1024)} MB limit."), allowedOrigin);
    }

    var containerName = Environment.GetEnvironmentVariable("MEDIA_CONTAINER") ?? "media";
    var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage");
    var containerClient = new BlobContainerClient(connectionString, containerName);
    // Public read access: gallery images are meant to be visible to every visitor.
    await containerClient.CreateIfNotExistsAsync(PublicAccessType.Blob);

    string safeExtension = System.IO.Path.GetExtension(filename);
    string blobName = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}{safeExtension}";
    var blobClient = containerClient.GetBlobClient(blobName);

    using (var stream = new MemoryStream(bytes))
    {
        await blobClient.UploadAsync(stream, new BlobHttpHeaders { ContentType = contentType });
    }

    log.LogInformation($"Media uploaded by {authResult.email}: {blobName}");

    var result = new JObject { ["url"] = blobClient.Uri.ToString(), ["filename"] = blobName };
    return WithCors(new HttpResponseMessage(HttpStatusCode.OK)
    {
        Content = new StringContent(result.ToString(Formatting.None), Encoding.UTF8, "application/json")
    }, allowedOrigin);
}

private static HttpResponseMessage ErrorResponse(HttpStatusCode status, string message)
{
    var body = new JObject { ["error"] = message };
    return new HttpResponseMessage(status)
    {
        Content = new StringContent(body.ToString(Formatting.None), Encoding.UTF8, "application/json")
    };
}
