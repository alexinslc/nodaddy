export interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export class RateLimiter {
  private timestamps: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    // Remove timestamps outside the current window
    this.timestamps = this.timestamps.filter(
      (t) => now - t < this.config.windowMs,
    );

    if (this.timestamps.length >= this.config.requests) {
      // Wait until the oldest request in the window expires
      const oldest = this.timestamps[0]!;
      const waitMs = this.config.windowMs - (now - oldest) + 50; // 50ms buffer
      await sleep(waitMs);
      return this.acquire();
    }

    this.timestamps.push(now);
  }

  get remaining(): number {
    const now = Date.now();
    const active = this.timestamps.filter(
      (t) => now - t < this.config.windowMs,
    );
    return Math.max(0, this.config.requests - active.length);
  }

  get limit(): number {
    return this.config.requests;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pre-configured rate limiters for both APIs
export const godaddyRateLimiter = new RateLimiter({
  requests: 55, // 60/min with buffer
  windowMs: 60_000,
});

export const cloudflareRateLimiter = new RateLimiter({
  requests: 1100, // 1200/5min with buffer
  windowMs: 300_000,
});
