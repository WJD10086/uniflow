using System.Text.Json.Serialization;

namespace UniFlow.Windows;

internal sealed record CaptureHistory(int Version, string Title, string Content, string ReceivedAt);
internal sealed record OriginalNotification(string Title, string Text, string BigText, IReadOnlyList<string> Lines);
internal sealed record CaptureItem(
    string Id, int Version, string AppName, string PackageName, string Title, string Content, string ReceivedAt,
    string? PostedAt, string FirstReceivedAt, string? ContentUpdatedAt, bool PossiblyTruncated,
    OriginalNotification OriginalNotification, IReadOnlyList<CaptureHistory> History);
internal sealed record NotificationSource(string Name, string PackageName, int CurrentNotificationCount);
internal sealed record AckItem(string Id, int Version);
internal sealed record KnownNotification(string Key, string Id, string PackageName, int Version, string Fingerprint, bool Muted = false);

internal sealed class CaptureConfig
{
    public List<string> AllowedPackages { get; set; } = [];
    public int MaxRecords { get; set; } = 100;
}

internal sealed class QueueDocument
{
    public int SchemaVersion { get; set; } = 1;
    public List<CaptureItem> Items { get; set; } = [];
    public List<KnownNotification> Known { get; set; } = [];
}

internal sealed class BridgeRequest
{
    public string Id { get; set; } = "";
    public string Command { get; set; } = "";
    public System.Text.Json.JsonElement Args { get; set; }
}
