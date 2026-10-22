using System.Text.Json;

namespace UniFlow.Windows;

internal sealed class AtomicJsonStore
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string configPath, queuePath;
    private readonly object gate = new();
    private readonly Action<string, byte[]> writeBytes;
    private QueueDocument queue;

    internal AtomicJsonStore(string root, Action<string, byte[]>? writer = null)
    {
        Directory.CreateDirectory(root);
        configPath = Path.Combine(root, "notification-config.json");
        queuePath = Path.Combine(root, "notification-queue.json");
        writeBytes = writer ?? AtomicWrite;
        queue = File.Exists(queuePath) ? JsonSerializer.Deserialize<QueueDocument>(Dpapi.Unprotect(File.ReadAllBytes(queuePath)), Options)
            ?? throw new InvalidDataException("本地通知队列无法解密，原文件已保留。") : new();
        if (queue.SchemaVersion != 1 || queue.Items is null || queue.Known is null || queue.Items.Any(x => !Valid(x)))
            throw new InvalidDataException("本地通知队列格式无效，原文件已保留。请先备份后排查。");
    }

    internal CaptureConfig LoadConfig()
    {
        lock (gate)
        {
            var config = File.Exists(configPath) ? JsonSerializer.Deserialize<CaptureConfig>(File.ReadAllText(configPath), Options) ?? new() : new();
            Normalize(config); return config;
        }
    }
    internal void SaveConfig(CaptureConfig config)
    {
        Normalize(config);
        lock (gate) writeBytes(configPath, JsonSerializer.SerializeToUtf8Bytes(config, Options));
    }
    private static void Normalize(CaptureConfig config)
    {
        config.AllowedPackages = (config.AllowedPackages ?? []).Where(x => !string.IsNullOrWhiteSpace(x) && x.Length <= 512).Distinct(StringComparer.Ordinal).Take(20).ToList();
        config.MaxRecords = NormalizeLimit(config.MaxRecords);
    }
    internal IReadOnlyList<CaptureItem> Pending(int max = 50)
    {
        lock (gate) return queue.Items.OrderBy(x => x.ReceivedAt, StringComparer.Ordinal).Take(Math.Clamp(max, 1, 50)).ToList();
    }
    internal bool Process(CaptureItem item, string key, string fingerprint, int limit, bool force = false)
    {
        if (!Valid(item)) throw new InvalidDataException("通知记录格式无效。");
        lock (gate)
        {
            var index = queue.Known.FindIndex(x => x.Key == key);
            var old = index >= 0 ? queue.Known[index] : null;
            if (old?.Muted == true) return false;
            if (old is not null && old.Fingerprint == fingerprint && !force) return false;
            var version = old is null ? 1 : checked(old.Version + 1);
            var next = Copy();
            var record = next.Items.FindIndex(x => x.Id == item.Id);
            if (record < 0 && next.Items.Count >= NormalizeLimit(limit))
                throw new IOException("待同步缓冲已满，捕获已暂停。请同步收件箱后重新开启，现有通知已保留。");
            var previous = record >= 0 ? next.Items[record] : null;
            var history = previous is null ? item.History : previous.History.Append(new CaptureHistory(previous.Version, previous.Title, previous.Content, previous.ReceivedAt)).Where(x => x.Version < version).GroupBy(x => x.Version).Select(g => g.First()).OrderByDescending(x => x.Version).Take(10).OrderBy(x => x.Version).ToList();
            var updated = item with { Version = version, History = history, FirstReceivedAt = previous?.FirstReceivedAt ?? item.FirstReceivedAt, ContentUpdatedAt = version > 1 ? DateTimeOffset.UtcNow.ToString("O") : null };
            var known = new KnownNotification(key, item.Id, item.PackageName, version, fingerprint);
            if (index >= 0) next.Known[index] = known; else next.Known.Add(known);
            next.Known = next.Known.TakeLast(5000).ToList();
            if (record >= 0) next.Items[record] = updated; else next.Items.Add(updated);
            Commit(next); return true;
        }
    }
    internal void Prime(IEnumerable<KnownNotification> current)
    {
        lock (gate)
        {
            var next = Copy();
            foreach (var item in current)
            {
                var index = next.Known.FindIndex(x => x.Key == item.Key);
                if (index < 0) next.Known.Add(item with { Version = 0 });
                else next.Known[index] = item with { Version = next.Known[index].Version, Muted = next.Known[index].Muted };
            }
            next.Known = next.Known.TakeLast(5000).ToList(); Commit(next);
        }
    }
    internal void NotificationRemoved(uint userNotificationId, IReadOnlyCollection<string> selectedAumids)
    {
        lock (gate)
        {
            var suffix = ":" + userNotificationId;
            var next = Copy();
            for (var i = 0; i < next.Known.Count; i++)
                if (next.Known[i].Key.Contains(suffix + ":", StringComparison.Ordinal) && selectedAumids.Contains(next.Known[i].PackageName, StringComparer.Ordinal))
                    next.Known[i] = next.Known[i] with { Fingerprint = "", Muted = false };
            Commit(next);
        }
    }
    internal void Acknowledge(IEnumerable<AckItem> acknowledgements)
    {
        var exact = acknowledgements.Where(x => Guid.TryParse(x.Id, out _) && x.Version > 0).GroupBy(x => x.Id, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Max(x => x.Version), StringComparer.Ordinal);
        lock (gate)
        {
            var next = Copy();
            if (next.Items.RemoveAll(x => exact.TryGetValue(x.Id, out var version) && version == x.Version) > 0) Commit(next);
        }
    }
    internal void Delete(IEnumerable<string> ids, IReadOnlyDictionary<string, int>? versions)
    {
        var selected = ids.Where(x => Guid.TryParse(x, out _)).ToHashSet(StringComparer.Ordinal);
        lock (gate)
        {
            var next = Copy();
            next.Items.RemoveAll(x => selected.Contains(x.Id) && (versions is null || !versions.TryGetValue(x.Id, out var v) || x.Version <= v));
            for (var i = 0; i < next.Known.Count; i++)
                if (selected.Contains(next.Known[i].Id) && (versions is null || !versions.TryGetValue(next.Known[i].Id, out var v) || next.Known[i].Version <= v)) next.Known[i] = next.Known[i] with { Muted = true };
            Commit(next);
        }
    }
    internal void Clear()
    {
        lock (gate) { var next = Copy(); next.Items.Clear(); next.Known = next.Known.Select(x => x with { Muted = true }).ToList(); Commit(next); }
    }
    private QueueDocument Copy() => new() { Items = queue.Items.ToList(), Known = queue.Known.ToList() };
    private void Commit(QueueDocument next)
    {
        writeBytes(queuePath, Dpapi.Protect(JsonSerializer.SerializeToUtf8Bytes(next, Options)));
        queue = next;
    }
    private static bool Valid(CaptureItem item) => item is not null && Guid.TryParseExact(item.Id, "D", out _) && item.Version > 0 && item.Version < int.MaxValue &&
        !string.IsNullOrWhiteSpace(item.PackageName) && item.PackageName.Length <= 512 && item.Title is not null && item.Content is not null && item.Content.Length <= 8000 && item.History is not null && DateTimeOffset.TryParse(item.ReceivedAt, out _);
    private static int NormalizeLimit(int value) => value is 50 or 100 or 200 ? value : 100;
    private static void AtomicWrite(string path, byte[] bytes)
    {
        var temp = path + ".tmp";
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) { stream.Write(bytes); stream.Flush(true); }
        File.Move(temp, path, true);
    }
}
