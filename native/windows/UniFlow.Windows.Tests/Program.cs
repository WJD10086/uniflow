using UniFlow.Windows;

static class Program
{
    private static int passed;
    private static void Check(bool value, string name) { if (!value) throw new Exception(name); passed++; Console.WriteLine($"PASS {name}"); }
    private static CaptureItem Item(string content, string? id = null) => new(id ?? Guid.NewGuid().ToString(), 1, "QQ", "Tencent.QQ!App", "title", content, DateTimeOffset.UtcNow.ToString("O"), null, DateTimeOffset.UtcNow.ToString("O"), null, false, new("title", content, content, []), []);
    public static int Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "uniflow-tests-" + Guid.NewGuid().ToString("N")); var failRoot = Path.Combine(Path.GetTempPath(), "uniflow-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new AtomicJsonStore(root); var first = Item("one");
            Check(store.Process(first, "qq:7:100", "A", 100), "first item is queued"); Check(store.Pending().Single().Version == 1, "first version is one");
            Check(!store.Process(first, "qq:7:100", "A", 100), "duplicate fingerprint is ignored"); Check(store.Process(first with { Content = "two" }, "qq:7:100", "B", 100), "changed fingerprint is queued");
            Check(store.Pending().Single().Version == 2 && store.Pending().Single().History.Single().Content == "one", "update increments version and preserves history");
            store.Acknowledge([new AckItem(first.Id, 1)]); Check(store.Pending().Count == 1, "old ack does not delete newer version"); store.Acknowledge([new AckItem(first.Id, 2)]); Check(store.Pending().Count == 0, "exact ack deletes pending version");
            store.Process(first, "qq:7:100", "C", 100); var restarted = new AtomicJsonStore(root); Check(restarted.Pending().Count == 1, "queue survives restart");
            restarted.Delete([first.Id], new Dictionary<string, int> { [first.Id] = 3 }); Check(restarted.Pending().Count == 0 && !restarted.Process(first with { Content = "changed after delete" }, "qq:7:100", "changed", 100), "delete tombstone suppresses all updates of same occurrence");
            restarted.Process(Item("new", first.Id), "qq:7:200", "D", 100); Check(restarted.Pending().Single().Content == "new", "reused Windows id with new occurrence is distinct");
            var failStore = new AtomicJsonStore(failRoot, (_, _) => throw new IOException("disk full")); try { failStore.Process(Item("never"), "qq:8:100", "E", 100); } catch (IOException) { }
            Check(failStore.Pending().Count == 0, "write failure does not mutate memory queue"); Check(NotificationCaptureService.Sensitive("你的验证码是 123456"), "verification code text is filtered"); Check(!NotificationCaptureService.Sensitive("课程群今天的代码评审"), "ordinary text is not filtered");
            Check(NotificationCaptureService.OccurrenceKey("qq", 7, DateTimeOffset.UnixEpoch) != NotificationCaptureService.OccurrenceKey("qq", 7, DateTimeOffset.UnixEpoch.AddSeconds(1)), "occurrence identity includes creation time");
            Check(MainForm.Trusted("https://app.uniflow.invalid/index.html") && !MainForm.Trusted("https://app.uniflow.invalid.evil.test/") && !MainForm.Trusted("http://app.uniflow.invalid/"), "bridge origin validation is exact");
            restarted.Clear(); Check(restarted.Pending().Count == 0, "clear keeps durable store valid"); Console.WriteLine($"{passed} queue and security checks passed"); return 0;
        }
        finally { try { Directory.Delete(root, true); } catch { } try { Directory.Delete(failRoot, true); } catch { } }
    }
}
