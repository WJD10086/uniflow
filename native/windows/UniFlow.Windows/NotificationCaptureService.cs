using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace UniFlow.Windows;

internal sealed class NotificationCaptureService : IDisposable
{
    private readonly UserNotificationListener? listener;
    private readonly AtomicJsonStore store;
    private readonly SemaphoreSlim serial = new(1, 1);
    private readonly System.Windows.Forms.Timer poll = new() { Interval = 3000 };
    private CaptureConfig config;
    private bool enabled, disposed;
    private int generation;
    private string? lastError;
    private SynchronizationContext? ui;
    internal event EventHandler? CaptureAvailable;

    internal NotificationCaptureService(AtomicJsonStore store)
    {
        this.store = store; config = store.LoadConfig();
        try { listener = UserNotificationListener.Current; } catch { listener = null; }
        poll.Tick += async (_, _) => await ReconcileAsync();
    }
    internal bool Available => listener is not null;
    internal bool Authorized { get { try { return listener?.GetAccessStatus() == UserNotificationListenerAccessStatus.Allowed; } catch { return false; } } }
    internal Task<object> StatusAsync()
    {
        var authorized = Authorized;
        if (!authorized && enabled) Disable();
        return Task.FromResult<object>(new { available = Available, authorized, enabled, connected = enabled && authorized, allowedPackages = config.AllowedPackages, maxRecords = config.MaxRecords, storageError = lastError is not null, error = lastError });
    }
    internal async Task<object> RequestAccessAsync()
    {
        if (listener is not null)
        {
            var result = await listener.RequestAccessAsync();
            if (result != UserNotificationListenerAccessStatus.Allowed) Disable();
        }
        return await StatusAsync();
    }
    internal async Task<object> SetConfigAsync(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object) throw new InvalidDataException("设置格式无效。");
        await serial.WaitAsync();
        bool restart, wasEnabled;
        bool? requestedEnabled = null;
        try
        {
            if (args.TryGetProperty("enabled", out var node)) requestedEnabled = node.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => throw new InvalidDataException("开关格式无效。") };
            var next = new CaptureConfig { AllowedPackages = config.AllowedPackages.ToList(), MaxRecords = config.MaxRecords };
            if (args.TryGetProperty("allowedPackages", out var packages))
            {
                if (packages.ValueKind != JsonValueKind.Array || packages.GetArrayLength() > 20 || packages.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String)) throw new InvalidDataException("最多选择 20 个通知来源。");
                next.AllowedPackages = packages.EnumerateArray().Select(x => x.GetString()!).Where(SourceAllowed).Distinct(StringComparer.Ordinal).ToList();
            }
            if (args.TryGetProperty("maxRecords", out var max))
            {
                if (max.ValueKind != JsonValueKind.Number || !max.TryGetInt32(out var value) || value is not (50 or 100 or 200)) throw new InvalidDataException("缓冲大小无效。");
                next.MaxRecords = value;
            }
            wasEnabled = enabled;
            restart = enabled && !config.AllowedPackages.SequenceEqual(next.AllowedPackages, StringComparer.Ordinal);
            store.SaveConfig(next); config = next;
            if (restart || requestedEnabled == false) Disable();
        }
        finally { serial.Release(); }
        if (requestedEnabled == true || (restart && wasEnabled && requestedEnabled is null)) await StartAsync();
        return await StatusAsync();
    }
    private static bool SourceAllowed(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 512 && !value.Any(char.IsControl);
    internal async Task<IReadOnlyList<NotificationSource>> ListSourcesAsync()
    {
        if (listener is null || !Authorized) return [];
        var items = await listener.GetNotificationsAsync(NotificationKinds.Toast);
        // AppInfo only: do not access Visual or text while enumerating sources.
        return items.Select(item => new { Name = SafeName(item), Aumid = item.AppInfo.AppUserModelId })
            .Where(x => SourceAllowed(x.Aumid)).GroupBy(x => x.Aumid, StringComparer.Ordinal)
            .Select(g => new NotificationSource(g.First().Name, g.Key, g.Count())).OrderBy(x => x.Name).ToList();
    }
    internal async Task StartAsync()
    {
        ui = SynchronizationContext.Current ?? ui;
        await serial.WaitAsync();
        try
        {
            if (enabled) return;
            if (listener is null || !Authorized) throw new InvalidOperationException("请先授予 Windows 通知访问权限。");
            if (config.AllowedPackages.Count == 0) throw new InvalidOperationException("请先选择通知来源。");
            generation++; enabled = true;
            listener.NotificationChanged -= OnNotificationChanged; listener.NotificationChanged += OnNotificationChanged;
            var started = DateTimeOffset.UtcNow;
            var current = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            var baseline = new List<KnownNotification>();
            foreach (var notification in current)
            {
                if (!Selected(notification)) continue;
                var item = ToCaptureItem(notification);
                if (Sensitive(item.Title + "\n" + item.Content)) continue;
                if (notification.CreationTime >= started) store.Process(item, Key(notification), Fingerprint(item), config.MaxRecords);
                else baseline.Add(new(Key(notification), item.Id, item.PackageName, 0, Fingerprint(item)));
            }
            store.Prime(baseline); lastError = null; poll.Start();
            CaptureAvailable?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception ex) { lastError = ex.Message; Disable(); throw; }
        finally { serial.Release(); }
    }
    private void Disable()
    {
        enabled = false; generation++; poll.Stop();
        if (listener is not null) listener.NotificationChanged -= OnNotificationChanged;
    }
    private bool Selected(UserNotification item) => SourceAllowed(item.AppInfo.AppUserModelId) && config.AllowedPackages.Contains(item.AppInfo.AppUserModelId, StringComparer.Ordinal);
    private void OnNotificationChanged(UserNotificationListener sender, UserNotificationChangedEventArgs args)
    {
        ui?.Post(async _ => { if (!disposed) await ReconcileAsync(); }, null);
    }
    private async Task ReconcileAsync()
    {
        var localGeneration = generation;
        // Polls may coalesce; event passes wait so the baseline race can be reconciled once.
        if (serial.CurrentCount == 0) return;
        await serial.WaitAsync();
        try
        {
            if (!enabled || disposed || generation != localGeneration) return;
            if (!Authorized || listener is null) { Disable(); CaptureAvailable?.Invoke(this, EventArgs.Empty); return; }
            var all = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            var changed = false;
            foreach (var notification in all)
            {
                if (generation != localGeneration || !enabled || !Authorized) break;
                // Critical privacy gate: only metadata is accessed before exact AUMID selection.
                if (!Selected(notification)) continue;
                var item = ToCaptureItem(notification);
                if (Sensitive(item.Title + "\n" + item.Content)) continue;
                var key = Key(notification);
                changed |= store.Process(item, key, Fingerprint(item), config.MaxRecords);
            }
            if (changed) CaptureAvailable?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception ex) { lastError = ex.Message; Disable(); CaptureAvailable?.Invoke(this, EventArgs.Empty); }
        finally { serial.Release(); }
    }
    internal IReadOnlyList<CaptureItem> Pending() => store.Pending(50);
    internal void Acknowledge(JsonElement args) => store.Acknowledge(ReadAcks(args));
    internal void Delete(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object) throw new InvalidDataException("删除格式无效。");
        var ids = args.TryGetProperty("ids", out var values) && values.ValueKind == JsonValueKind.Array ? values.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : [];
        var versions = new Dictionary<string, int>(StringComparer.Ordinal);
        if (args.TryGetProperty("versions", out var versionNode) && versionNode.ValueKind == JsonValueKind.Object)
            foreach (var p in versionNode.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number && p.Value.TryGetInt32(out var v) && v > 0) versions[p.Name] = v;
        store.Delete(ids, versions);
    }
    internal void Clear() => store.Clear();
    private static string Key(UserNotification item) => OccurrenceKey(item.AppInfo.AppUserModelId, item.Id, item.CreationTime);
    internal static string OccurrenceKey(string source, uint id, DateTimeOffset created) => source + ":" + id + ":" + created.UtcTicks;
    internal static bool Sensitive(string text) => Regex.IsMatch(text, @"(?i)(验证码|校验码|动态密码|短信验证|安全码|verification\s*code|security\s*code|one[- ]time\s*(?:password|code)|\bOTP\b)");
    private static CaptureItem ToCaptureItem(UserNotification item)
    {
        var binding = item.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);
        var texts = binding?.GetTextElements()?.Select(x => x.Text ?? "").Where(x => x.Length > 0).Take(20).ToList() ?? [];
        var title = texts.FirstOrDefault() ?? SafeName(item);
        var content = string.Join("\n", texts.Skip(1)); if (content.Length == 0) content = title;
        var received = DateTimeOffset.UtcNow.ToString("O");
        return new CaptureItem(GuidUtility.Create(GuidUtility.Namespace, Key(item)).ToString(), 1, SafeName(item), item.AppInfo.AppUserModelId,
            title[..Math.Min(80, title.Length)], content[..Math.Min(8000, content.Length)], received, item.CreationTime.ToString("O"), received, null, content.Length > 8000,
            new(title[..Math.Min(200, title.Length)], content[..Math.Min(4000, content.Length)], content[..Math.Min(4000, content.Length)], texts.Take(10).Select(x => x[..Math.Min(400, x.Length)]).ToList()), []);
    }
    private static string SafeName(UserNotification item) { try { return item.AppInfo.DisplayInfo.DisplayName?.ToString() ?? "系统通知"; } catch { return "系统通知"; } }
    private static string Fingerprint(CaptureItem item) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(item.Title + "\n" + item.Content)));
    private static IEnumerable<AckItem> ReadAcks(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 50) throw new InvalidDataException("确认格式无效。");
        return items.EnumerateArray().Select(x => new AckItem(x.GetProperty("id").GetString() ?? "", x.GetProperty("version").GetInt32())).ToList();
    }
    public void Dispose() { if (disposed) return; disposed = true; Disable(); poll.Dispose(); }
}

internal static class GuidUtility
{
    internal static readonly Guid Namespace = Guid.Parse("d3f73e11-ae51-49a6-9f4a-6d2ee8c0d2e1");
    internal static Guid Create(Guid ns, string name)
    {
        var nsBytes = ns.ToByteArray(); Array.Reverse(nsBytes, 0, 4); Array.Reverse(nsBytes, 4, 2); Array.Reverse(nsBytes, 6, 2);
        var hash = System.Security.Cryptography.SHA1.HashData(nsBytes.Concat(Encoding.UTF8.GetBytes(name)).ToArray());
        var result = hash.Take(16).ToArray(); result[6] = (byte)((result[6] & 0x0F) | 0x50); result[8] = (byte)((result[8] & 0x3F) | 0x80);
        Array.Reverse(result, 0, 4); Array.Reverse(result, 4, 2); Array.Reverse(result, 6, 2); return new Guid(result);
    }
}
