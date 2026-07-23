export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
}

interface WindowState {
  count: number;
  resetAt: number;
}

export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly clients = new Map<string, WindowState>();
  private readonly now: () => number;
  private lastCleanupAt = 0;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    this.cleanupExpiredWindows(now);
    const current = this.clients.get(key);

    if (!current || current.resetAt <= now) {
      this.clients.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (current.count >= this.options.maxRequests) {
      return { allowed: false, retryAfterMs: current.resetAt - now };
    }

    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private cleanupExpiredWindows(now: number): void {
    if (now - this.lastCleanupAt < this.options.windowMs) {
      return;
    }

    for (const [key, state] of this.clients) {
      if (state.resetAt <= now) {
        this.clients.delete(key);
      }
    }
    this.lastCleanupAt = now;
  }
}
