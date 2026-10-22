namespace UniFlow.Windows;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        using var mutex = new Mutex(true, @"Local\WJD10086.UniFlow.Windows", out var first);
        if (!first)
        {
            MessageBox.Show("UniFlow 已经在运行。", "UniFlow", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        try { Application.Run(new MainForm()); }
        catch (Exception ex) { MessageBox.Show($"UniFlow 无法启动。原有通知数据已保留。\n\n{ex.Message}", "UniFlow 启动错误", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}
