export function formatResetIn(seconds) {
    if (seconds <= 0)
        return "now";
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.ceil((seconds % 3_600) / 60);
    if (days > 0)
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0)
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return minutes > 0 ? `${minutes}m` : "less than 1m";
}
export function formatDuration(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
