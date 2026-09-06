// ================================================================
// Text helpers
// ================================================================
/** Keep session-derived filenames safe without losing human-readable clues. */
export function safeId(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "default";
}
/** Discord and Telegram both have message-size limits, so replies are chunked. */
export function chunkText(text, maxLength) {
    if (text.length <= maxLength)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLength) {
        const slice = remaining.slice(0, maxLength);
        const breakAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
        const cut = breakAt > Math.floor(maxLength * 0.6) ? breakAt : maxLength;
        chunks.push(remaining.slice(0, cut).trimEnd());
        remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0)
        chunks.push(remaining);
    return chunks;
}
export function nowIso() {
    return new Date().toISOString();
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
