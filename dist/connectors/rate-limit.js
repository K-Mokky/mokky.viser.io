// ================================================================
// Per-peer connector rate limiting
// ================================================================
// Telegram/Discord transports are public-facing. This small in-memory limiter
// prevents one chat/channel from forcing unbounded local provider CLI calls.
const WINDOW_MS = 60_000;
export class ConnectorRateLimiter {
    maxMessages;
    now;
    hits = new Map();
    constructor(maxMessagesPerMinute, clock = {}) {
        this.maxMessages = Math.max(1, Math.floor(maxMessagesPerMinute));
        this.now = clock.now ?? Date.now;
    }
    check(peerKey) {
        const now = this.now();
        const threshold = now - WINDOW_MS;
        const existing = this.hits.get(peerKey) ?? [];
        const recent = existing.filter((at) => at > threshold);
        if (recent.length >= this.maxMessages) {
            this.hits.set(peerKey, recent);
            return {
                allowed: false,
                retryAfterMs: Math.max(1, WINDOW_MS - (now - recent[0]))
            };
        }
        recent.push(now);
        this.hits.set(peerKey, recent);
        return { allowed: true, retryAfterMs: 0 };
    }
}
export function connectorRateLimitMessage(retryAfterMs) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return `Viser rate limit: too many messages from this chat/channel. Try again in ${seconds}s.`;
}
