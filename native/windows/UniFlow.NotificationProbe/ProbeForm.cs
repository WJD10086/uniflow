using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace UniFlow.NotificationProbe;

internal sealed class ProbeForm : Form
{
    private readonly UserNotificationListener? listener;
    private readonly Label status = new() { AutoSize = true, MaximumSize = new Size(780, 0) };
    private readonly Button requestAccess = new() { Text = "请求系统授权", AutoSize = true };
    private readonly Button refreshSources = new() { Text = "发现通知来源", AutoSize = true };
    private readonly Button selectSource = new() { Text = "选为 QQ 来源", AutoSize = true };
    private readonly Button start = new() { Text = "开始仅元数据验证", AutoSize = true };
    private readonly Button stop = new() { Text = "停止", AutoSize = true, Enabled = false };
    private readonly DataGridView sources = new()
    {
        AutoGenerateColumns = false,
        AllowUserToAddRows = false,
        AllowUserToDeleteRows = false,
        MultiSelect = false,
        ReadOnly = true,
        SelectionMode = DataGridViewSelectionMode.FullRowSelect,
        Dock = DockStyle.Fill
    };
    private readonly ListBox events = new() { Dock = DockStyle.Fill };
    private readonly object baselineLock = new();
    private string? selectedAppUserModelId;
    private bool observing;
    private HashSet<uint> baselineIds = [];

    internal ProbeForm()
    {
        Text = "UniFlow Windows 通知验证器";
        MinimumSize = new Size(820, 620);
        StartPosition = FormStartPosition.CenterScreen;
        try { listener = UserNotificationListener.Current; }
        catch { listener = null; }

        sources.Columns.Add(new DataGridViewTextBoxColumn
        {
            DataPropertyName = nameof(NotificationSource.DisplayName), HeaderText = "应用", Width = 180
        });
        sources.Columns.Add(new DataGridViewTextBoxColumn
        {
            DataPropertyName = nameof(NotificationSource.AppUserModelId),
            HeaderText = "AppUserModelId（精确白名单）",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill
        });
        sources.Columns.Add(new DataGridViewTextBoxColumn
        {
            DataPropertyName = nameof(NotificationSource.CurrentNotificationCount),
            HeaderText = "当前通知数", Width = 100
        });

        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
        actions.Controls.AddRange([requestAccess, refreshSources, selectSource, start, stop]);
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(16), RowCount = 6, ColumnCount = 1
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label
        {
            Text = "只验证系统通知通道和 QQ 来源标识。本阶段不读取正文、不连接 QQ、不联网，也不写入 UniFlow。",
            AutoSize = true, MaximumSize = new Size(780, 0), Font = new Font(Font, FontStyle.Bold)
        });
        layout.Controls.Add(actions);
        layout.Controls.Add(sources);
        layout.Controls.Add(new Label { Text = "验证事件（仅时间、通知 ID 和来源标识）", AutoSize = true });
        layout.Controls.Add(events);
        layout.Controls.Add(status);
        Controls.Add(layout);

        requestAccess.Click += async (_, _) => await RequestAccessAsync();
        refreshSources.Click += async (_, _) => await RefreshSourcesAsync();
        selectSource.Click += (_, _) => SelectCurrentSource();
        start.Click += async (_, _) => await StartObservingAsync();
        stop.Click += (_, _) => StopObserving();
        FormClosed += (_, _) => StopObserving();
        Shown += (_, _) => RefreshStatus();
    }

    private void RefreshStatus(string? detail = null)
    {
        if (listener is null)
        {
            status.Text = "官方通知 API 当前不可用。验证器需要 MSIX 包身份及 userNotificationListener 能力；未满足时不会尝试降级抓取。";
            SetActionAvailability(false);
            return;
        }

        UserNotificationListenerAccessStatus access;
        try { access = listener.GetAccessStatus(); }
        catch
        {
            status.Text = "无法读取系统通知权限状态。验证保持关闭。";
            SetActionAvailability(false);
            return;
        }
        var allowed = access == UserNotificationListenerAccessStatus.Allowed;
        status.Text = $"系统权限：{AccessText(access)}；QQ 白名单：{selectedAppUserModelId ?? "未选择"}；验证：{(observing ? "运行中" : "已停止")}";
        if (!string.IsNullOrWhiteSpace(detail)) status.Text += Environment.NewLine + detail;
        requestAccess.Enabled = access != UserNotificationListenerAccessStatus.Allowed && !observing;
        refreshSources.Enabled = allowed && !observing;
        selectSource.Enabled = allowed && !observing;
        start.Enabled = allowed && !observing && selectedAppUserModelId is not null;
        stop.Enabled = observing;
    }

    private void SetActionAvailability(bool enabled)
    {
        requestAccess.Enabled = enabled;
        refreshSources.Enabled = enabled;
        selectSource.Enabled = enabled;
        start.Enabled = enabled;
        stop.Enabled = false;
    }

    private async Task RequestAccessAsync()
    {
        if (listener is null) return;
        try
        {
            requestAccess.Enabled = false;
            var result = await listener.RequestAccessAsync();
            RefreshStatus(result == UserNotificationListenerAccessStatus.Allowed
                ? "系统已授权。下一步只发现来源元数据。"
                : "系统未授权；验证保持关闭。若此前拒绝过，请在 Windows 设置中手动调整。");
        }
        catch (Exception ex) { RefreshStatus("请求失败：" + SafeError(ex)); }
    }

    private async Task RefreshSourcesAsync()
    {
        if (listener is null)
        {
            RefreshStatus("官方通知 API 不可用，未查询通知。");
            return;
        }

        try
        {
            if (listener.GetAccessStatus() != UserNotificationListenerAccessStatus.Allowed)
            {
                RefreshStatus("没有系统授权，未查询通知。");
                return;
            }

            refreshSources.Enabled = false;
            var notifications = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            var catalog = notifications
                .Select(item => new { Name = item.AppInfo.DisplayInfo.DisplayName, Aumid = item.AppInfo.AppUserModelId })
                .Where(item => !string.IsNullOrWhiteSpace(item.Aumid))
                .GroupBy(item => item.Aumid, StringComparer.Ordinal)
                .Select(group => new NotificationSource(
                    group.Select(item => item.Name).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)) ?? "未知应用",
                    group.Key,
                    group.Count()))
                .OrderBy(item => item.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            sources.DataSource = catalog;
            RefreshStatus(catalog.Count == 0
                ? "当前通知中心没有可用于识别来源的通知。请先让 QQ 产生一条普通系统通知，再刷新。"
                : "只读取了来源名称和 AppUserModelId；没有访问通知正文。请选择你确认属于 QQ 的一行。");
        }
        catch (Exception ex) { RefreshStatus("来源发现失败：" + SafeError(ex)); }
    }

    private void SelectCurrentSource()
    {
        selectedAppUserModelId = sources.CurrentRow?.DataBoundItem is NotificationSource item ? item.AppUserModelId : null;
        RefreshStatus(selectedAppUserModelId is null
            ? "没有选择来源，验证保持关闭。"
            : "已建立会话内精确白名单。关闭验证器后不会保留。");
    }

    private async Task StartObservingAsync()
    {
        if (listener is null) return;
        try
        {
            var allowed = listener.GetAccessStatus() == UserNotificationListenerAccessStatus.Allowed;
            if (!CaptureGate.CanStart(allowed, selectedAppUserModelId))
            {
                RefreshStatus("授权或 QQ 精确白名单不完整，未启动。");
                return;
            }

            var current = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            lock (baselineLock) baselineIds = current.Select(item => item.Id).ToHashSet();
            observing = true;
            listener.NotificationChanged += ListenerOnNotificationChanged;
            RefreshStatus($"已记录 {baselineIds.Count} 条当前通知为基线，不会把它们当作新消息。");
        }
        catch (Exception ex)
        {
            observing = false;
            RefreshStatus("启动失败：" + SafeError(ex));
        }
    }

    private async void ListenerOnNotificationChanged(UserNotificationListener sender, UserNotificationChangedEventArgs args)
    {
        try
        {
            if (!observing || sender.GetAccessStatus() != UserNotificationListenerAccessStatus.Allowed)
            {
                StopObserving();
                return;
            }

            var current = await sender.GetNotificationsAsync(NotificationKinds.Toast);
            var candidate = current.FirstOrDefault(item => item.Id == args.UserNotificationId);
            if (candidate is null) return;
            bool wasInBaseline;
            lock (baselineLock)
            {
                wasInBaseline = baselineIds.Contains(candidate.Id);
            }
            var candidateAumid = candidate.AppInfo.AppUserModelId;
            if (!CaptureGate.CanObserve(
                    sender.GetAccessStatus() == UserNotificationListenerAccessStatus.Allowed,
                    observing, selectedAppUserModelId, candidateAumid)) return;
            lock (baselineLock)
            {
                baselineIds.Add(candidate.Id);
            }
            BeginInvoke(() =>
            {
                var eventType = wasInBaseline ? "已有通知更新" : "新通知";
                events.Items.Insert(0, $"{DateTime.Now:HH:mm:ss}  {eventType}  ID {candidate.Id}  {candidateAumid}");
                while (events.Items.Count > 100) events.Items.RemoveAt(events.Items.Count - 1);
            });
        }
        catch
        {
            if (!IsDisposed) BeginInvoke(() => RefreshStatus("监听失败并已停止；事件正文未读取。"));
            StopObserving();
        }
    }

    private void StopObserving()
    {
        if (InvokeRequired)
        {
            if (!IsDisposed) BeginInvoke(StopObserving);
            return;
        }

        if (listener is not null) listener.NotificationChanged -= ListenerOnNotificationChanged;
        observing = false;
        lock (baselineLock) baselineIds.Clear();
        if (!IsDisposed) RefreshStatus("没有后台运行或自启动。");
    }

    private static string AccessText(UserNotificationListenerAccessStatus value) => value switch
    {
        UserNotificationListenerAccessStatus.Allowed => "已允许",
        UserNotificationListenerAccessStatus.Denied => "已拒绝",
        _ => "未决定"
    };

    private static string SafeError(Exception ex) => ex is UnauthorizedAccessException
        ? "系统拒绝访问；请检查应用包身份和通知权限。"
        : "未完成；事件正文未读取。";
}
