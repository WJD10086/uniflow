using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace UniFlow.Windows;

internal sealed class Bridge
{
    private readonly NotificationCaptureService capture;
    internal Bridge(NotificationCaptureService capture) => this.capture = capture;
    internal async Task<object?> HandleAsync(string json)
    {
        if (json.Length > 64_000) throw new InvalidDataException("请求过大。");
        var request = JsonSerializer.Deserialize<BridgeRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new InvalidDataException("请求无效。");
        return request.Command switch
        {
            "getStatus" => await capture.StatusAsync(),
            "setConfig" => await capture.SetConfigAsync(request.Args),
            "openAccessSettings" => await capture.RequestAccessAsync(),
            "listSources" => new { items = await capture.ListSourcesAsync() },
            "getPending" => new { items = capture.Pending() },
            "getSourceIcon" => new { dataUrl = "" },
            "acknowledge" => Ack(request.Args),
            "deleteMessages" => Delete(request.Args),
            "clearCaptured" => Clear(),
            _ => throw new InvalidOperationException("不支持的原生命令。")
        };
    }
    private object Ack(JsonElement a) { capture.Acknowledge(a); return new { ok = true }; }
    private object Delete(JsonElement a) { capture.Delete(a); return new { ok = true }; }
    private object Clear() { capture.Clear(); return new { ok = true }; }
}
