using System.ComponentModel;
using System.Runtime.InteropServices;

namespace UniFlow.Windows;

internal static class Dpapi
{
    private static readonly byte[] Entropy = "WJD10086.UniFlow.NotificationQueue.v1"u8.ToArray();

    internal static byte[] Protect(byte[] data) => Transform(data, protect: true);
    internal static byte[] Unprotect(byte[] data) => Transform(data, protect: false);

    private static byte[] Transform(byte[] data, bool protect)
    {
        var inputPtr = Marshal.AllocHGlobal(data.Length);
        var entropyPtr = Marshal.AllocHGlobal(Entropy.Length);
        Marshal.Copy(data, 0, inputPtr, data.Length);
        Marshal.Copy(Entropy, 0, entropyPtr, Entropy.Length);
        var input = new Blob { Size = data.Length, Data = inputPtr };
        var entropy = new Blob { Size = Entropy.Length, Data = entropyPtr };
        Blob output;
        try
        {
            var success = protect
                ? CryptProtectData(ref input, null, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref input, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "通知队列加密数据不可用。");
            var result = new byte[output.Size];
            Marshal.Copy(output.Data, result, 0, output.Size);
            LocalFree(output.Data);
            return result;
        }
        finally
        {
            Marshal.Copy(new byte[data.Length], 0, inputPtr, data.Length);
            Marshal.FreeHGlobal(inputPtr);
            Marshal.FreeHGlobal(entropyPtr);
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Blob { internal int Size; internal IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptProtectData(ref Blob input, string? description, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
