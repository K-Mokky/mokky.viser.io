// ================================================================
// Per-peer connector rate limiting
// ================================================================
// Telegram/Discord transports are public-facing. This small in-memory limiter
// prevents one chat/channel from forcing unbounded local provider CLI calls.

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiterClock {
  now?: () => number;
}

const WINDOW_MS = 60_000;

export class ConnectorRateLimiter {
  private readonly maxMessages: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxMessagesPerMinute: number, clock: RateLimiterClock = {}) {
    this.maxMessages = Math.max(1, Math.floor(maxMessagesPerMinute));
    this.now = clock.now ?? Date.now;
  }

  check(peerKey: string): RateLimitDecision {
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

export function connectorRateLimitMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Viser rate limit: too many messages from this chat/channel. Try again in ${seconds}s.`;
}
