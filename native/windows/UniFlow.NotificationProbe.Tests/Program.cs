using UniFlow.NotificationProbe;

var failures = new List<string>();

Check("未授权时不能启动", false, CaptureGate.CanStart(false, "QQ.App"));
Check("空白名单时不能启动", false, CaptureGate.CanStart(true, null));
Check("授权且选定来源后可启动", true, CaptureGate.CanStart(true, "QQ.App"));
Check("拒绝未授权事件", false, CaptureGate.CanObserve(false, true, "QQ.App", "QQ.App"));
Check("拒绝未显式启用", false, CaptureGate.CanObserve(true, false, "QQ.App", "QQ.App"));
Check("拒绝空白名单", false, CaptureGate.CanObserve(true, true, null, "QQ.App"));
Check("拒绝其他应用", false, CaptureGate.CanObserve(true, true, "QQ.App", "Mail.App"));
Check("来源标识区分大小写", false, CaptureGate.CanObserve(true, true, "QQ.App", "qq.app"));
Check("允许精确匹配", true, CaptureGate.CanObserve(true, true, "QQ.App", "QQ.App"));

if (failures.Count > 0)
{
    Console.Error.WriteLine(string.Join(Environment.NewLine, failures));
    return 1;
}

Console.WriteLine("9/9 safety gate checks passed.");
return 0;

void Check(string name, bool expected, bool actual)
{
    if (expected != actual) failures.Add($"{name}: expected {expected}, actual {actual}");
}
