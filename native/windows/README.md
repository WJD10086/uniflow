# UniFlow Windows 通知接入

这套桌面壳使用 Windows 官方 `UserNotificationListener`，目标是以尽量低的 QQ 账号风险接收系统通知。它不登录 QQ、不调用 QQ 协议、不模拟操作、不注入进程、不读取聊天数据库，也不发送消息。

## 安全边界

- Windows 的通知访问授权是全局权限，不支持在授权弹窗中只选 QQ。
- UniFlow 先读取通知的应用元数据，只有 AUMID 与用户所选来源完全一致时才读取正文。
- 每次启动捕获默认关闭；必须重新手动打开，退出应用后立即停止。
- 开启前已经存在于通知中心的消息只作为基线，不导入。
- 验证码、动态密码等关键词在本地过滤，但无法保证识别所有敏感内容。
- 原生待同步队列使用当前 Windows 用户的 DPAPI 加密。收件箱仍存储在 WebView2 的本地应用数据中。
- AI 只在用户点击“AI 整理”时调用，自动捕获本身不上传内容，也不自动创建任务。
- QQ 自绘弹窗不是 Windows Toast 时无法捕获；项目没有高风险后备方案。

## 构建

从仓库根目录运行：

```powershell
.\native\windows\Build-MSIX.ps1
```

脚本会执行自包含 x64 发布并打包网页资源，默认输出未签名包用于结构检查。`-Sign` 会在当前用户证书存储中生成不可导出的临时自签名代码签名密钥，签名 MSIX、导出公钥 `.cer`，然后删除个人存储中的证书和私钥；若当前机器不允许创建签名密钥，脚本会失败而不会伪装成已签名。输出位于 `artifacts\windows`。构建机需要仓库同级 `.tools` 中的固定 .NET SDK、NuGet 缓存和 Windows SDK BuildTools；也可用 `-PublishDir` 指定一个已经验证的自包含发布目录。未签名包不能直接安装。

## 安装与首次测试

1. 核对 README 中记录的 SHA-256，或重新运行 `Get-FileHash <msix>`。
2. 打开同一构建目录的 `UniFlow-dev.cer`，由用户自行将证书安装到“本地计算机/受信任人”或合适的测试证书存储。不要把测试证书用于生产发布。
3. 双击 MSIX 安装。安装程序显示的发布者应为 `CN=UniFlow`。
4. 启动 UniFlow，打开“偏好设置 → 管理通知捕获”，点击系统授权并由用户确认。
5. 让 QQ 产生一条普通、非敏感通知，并保留在 Windows 通知中心；再打开来源列表，核对显示名称和完整来源 ID 后勾选。
6. 开启自动捕获，再让 QQ 产生一条测试通知。确认收件箱只出现所选来源，另一个未选应用的通知不应出现。
7. 更新同一个系统通知时应生成新版并保留最近历史；删除后同一系统通知不会再次导入，新的通知发生时间会形成新记录。

真实 QQ 客户端版本、通知样式和 AUMID 必须在目标电脑上验证。成功构建或未授权界面测试不代表 QQ 一定提供可读取的 Toast。

## 数据位置与卸载

- 加密原生队列：`%LOCALAPPDATA%\UniFlow\Notifications`
- WebView2 收件箱和设置：`%LOCALAPPDATA%\UniFlow\WebView2`

卸载应用不会承诺删除上述用户数据。需要彻底清理时，应先在应用内导出所需数据、卸载 UniFlow，然后由用户手动删除这两个明确目录及测试证书。不要删除整个 `%LOCALAPPDATA%`。

## 已验证项目

- .NET 队列与安全检查覆盖：去重、版本更新、旧版确认、重启持久化、删除墓碑、Windows ID 重用、写盘失败回滚、验证码过滤、来源发生标识、桥接来源校验。
- Node 检查覆盖：Windows AUMID 适配、前端合并、更新时保留人工状态、删除墓碑及 Android 格式隔离。
- MSIX 构建脚本会拒绝缺少 `UniFlow.Windows.exe` 或 `coreclr.dll` 的发布目录，并在签名后输出 SHA-256。

尚未自动执行：信任证书、安装 MSIX、授予通知访问、读取真实 QQ 通知。这些步骤有明确的用户授权或外部客户端依赖。

## 参考

- Microsoft notification listener: https://learn.microsoft.com/windows/apps/develop/notifications/app-notifications/notification-listener
- Microsoft documentation source: https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/apps/develop/notifications/app-notifications/notification-listener.md

调研过 `jys17853678262/windows-notification`，但其公开说明中存在未知应用名/空 AUMID 的情况，无法在读取正文前实施严格来源白名单，因此没有采用。
