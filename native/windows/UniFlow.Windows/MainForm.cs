using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UniFlow.Windows;

internal sealed class MainForm : Form
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly NotificationCaptureService capture;
    private readonly Bridge bridge;
    private bool ready;
    internal MainForm()
    {
        Text = "UniFlow"; MinimumSize = new Size(960, 680); StartPosition = FormStartPosition.CenterScreen;
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UniFlow", "Notifications");
        capture = new NotificationCaptureService(new AtomicJsonStore(root)); bridge = new Bridge(capture); Controls.Add(web);
        Shown += async (_, _) => { try { await InitializeAsync(); } catch (Exception ex) { MessageBox.Show(this, "桌面界面启动失败。请确认已安装 Microsoft Edge WebView2 Runtime。\n\n" + ex.Message, "UniFlow", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); } }; FormClosed += (_, _) => capture.Dispose();
        capture.CaptureAvailable += (_, _) => { if (!IsDisposed && IsHandleCreated) BeginInvoke(() => PostEvent("captureAvailable")); };
    }
    private async Task InitializeAsync()
    {
        var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UniFlow", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, userData);
        await web.EnsureCoreWebView2Async(env);
        web.CoreWebView2.Settings.AreDevToolsEnabled = false; web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.NavigationStarting += (_, e) => { if (!Trusted(e.Uri)) e.Cancel = true; };
        web.CoreWebView2.FrameNavigationStarting += (_, e) => { if (!Trusted(e.Uri)) e.Cancel = true; };
        web.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" && MessageBox.Show(this, "在系统浏览器打开以下链接？\n\n" + uri.GetLeftPart(UriPartial.Path), "打开外部链接", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); };
        web.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        web.CoreWebView2.DownloadStarting += (_, e) => { using var save = new SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), Filter = "所有文件|*.*", OverwritePrompt = true }; if (save.ShowDialog(this) == DialogResult.OK) { e.ResultFilePath = save.FileName; e.Handled = true; } else e.Cancel = true; };
        web.CoreWebView2.WebMessageReceived += async (_, e) => { if (Trusted(e.Source)) await ReceiveAsync(e); };
        await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"(() => {
          const pending = new Map(), listeners = new Map(); let serial = 0;
          if (window.top !== window || location.origin !== 'https://app.uniflow.invalid') return;
          const call = (command, args = {}) => new Promise((resolve, reject) => { const id = `u${++serial}`; const timer = setTimeout(() => { pending.delete(id); reject(new Error('原生服务响应超时，请重试。')); }, command === 'openAccessSettings' ? 180000 : 30000); pending.set(id, {resolve, reject, timer}); chrome.webview.postMessage({id, command, args}); });
          chrome.webview.addEventListener('message', event => { const value = event.data || {}; if (value.eventName) { (listeners.get(value.eventName) || []).forEach(fn => { try { fn(value); } catch {} }); return; } const item = pending.get(value.id); if (!item) return; pending.delete(value.id); clearTimeout(item.timer); value.ok ? item.resolve(value.result) : item.reject(new Error(value.error || '原生服务失败。')); });
          window.UniFlowWindowsCapture = { getStatus: () => call('getStatus'), setConfig: value => call('setConfig', value), openAccessSettings: () => call('openAccessSettings'), listSources: () => call('listSources'), getSourceIcon: value => call('getSourceIcon', value), getPending: () => call('getPending'), acknowledge: value => call('acknowledge', value), deleteMessages: value => call('deleteMessages', value), clearCaptured: () => call('clearCaptured'), addListener: (name, fn) => { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); return Promise.resolve({ remove: () => { const rest = (listeners.get(name) || []).filter(item => item !== fn); listeners.set(name, rest); } }); } };
        })();");
        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        if (!Directory.Exists(webRoot)) webRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".."));
        if (!File.Exists(Path.Combine(webRoot, "index.html"))) throw new FileNotFoundException("缺少内置网页文件。请重新安装完整的 MSIX 安装包。");
        web.CoreWebView2.SetVirtualHostNameToFolderMapping("app.uniflow.invalid", webRoot, CoreWebView2HostResourceAccessKind.DenyCors);
        web.CoreWebView2.Navigate("https://app.uniflow.invalid/index.html#overview"); ready = true;
    }
    private async Task ReceiveAsync(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var id = "";
        try { if(e.WebMessageAsJson.Length > 64_000) throw new InvalidDataException("请求过大。"); var request = JsonSerializer.Deserialize<BridgeRequest>(e.WebMessageAsJson, JsonOptions); if (request is null || string.IsNullOrEmpty(request.Id) || request.Id.Length > 64) throw new InvalidDataException("请求无效。"); id = request.Id; var result = await bridge.HandleAsync(e.WebMessageAsJson); web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = true, result }, JsonOptions)); }
        catch (Exception ex) { web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = false, error = ex.Message }, JsonOptions)); }
    }
    private void PostEvent(string name) { if (!ready) return; web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { eventName = name }, JsonOptions)); }
    internal static bool Trusted(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "app.uniflow.invalid" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
}
