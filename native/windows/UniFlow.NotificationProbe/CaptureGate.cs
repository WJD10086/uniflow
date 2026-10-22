namespace UniFlow.NotificationProbe;

internal static class CaptureGate
{
    internal static bool CanStart(bool accessAllowed, string? selectedAppUserModelId)
    {
        return accessAllowed && !string.IsNullOrWhiteSpace(selectedAppUserModelId);
    }

    internal static bool CanObserve(bool accessAllowed, bool explicitlyEnabled, string? selectedAppUserModelId, string? candidateAppUserModelId)
    {
        return accessAllowed && explicitlyEnabled && !string.IsNullOrWhiteSpace(selectedAppUserModelId)
            && string.Equals(selectedAppUserModelId, candidateAppUserModelId, StringComparison.Ordinal);
    }
}
