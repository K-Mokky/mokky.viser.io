// ================================================================
// Outbound provider call throttle
// ================================================================
// Every model answer goes through a logged-in local provider CLI. Bursting those
// CLIs (durable job queue, team/fix-loop/supervisor workflows, or a messenger
// bridge relaying many peers) can look like automated abuse to the upstream
// subscription and risk account bans. This throttle enforces a minimum spacing
// between provider invocations so a single account is never hammered.
//
// It is opt-in: a missing or non-positive interval disables it entirely, which
// keeps the default behaviour and the test suite unchanged.

export interface ThrottleClock {
  now?: () => number;
}

export class ProviderThrottle {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private nextAvailableAt = Number.NEGATIVE_INFINITY;

  constructor(minIntervalMs: number | undefined, clock: ThrottleClock = {}) {
    this.minIntervalMs = Math.max(0, Math.floor(minIntervalMs ?? 0));
    this.now = clock.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.minIntervalMs > 0;
  }

  // Reserve the next provider slot and return how many milliseconds the caller
  // must wait before invoking the provider. Reserving the future slot (rather
  // than the current time) makes rapid back-to-back callers queue deterministically
  // instead of all firing at once.
  reserve(): number {
    const now = this.now();
    if (this.minIntervalMs <= 0) {
      this.nextAvailableAt = now;
      return 0;
    }

    const startAt = Math.max(now, this.nextAvailableAt === Number.NEGATIVE_INFINITY ? now : this.nextAvailableAt);
    const wait = Math.max(0, startAt - now);
    this.nextAvailableAt = startAt + this.minIntervalMs;
    return wait;
  }
}
