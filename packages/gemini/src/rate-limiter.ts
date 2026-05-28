export interface RateLimiter {
  acquire(): Promise<void>;
}

export interface TokenBucketRateLimiterOptions {
  capacity?: number;
  refillRate?: number;
}

export const DEFAULT_GEMINI_RATE_LIMIT = {
  capacity: 60,
  refillRate: 1,
} as const;

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillRate: number;
  private tokens: number;
  private lastRefillAt: number;

  constructor(options: TokenBucketRateLimiterOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_GEMINI_RATE_LIMIT.capacity;
    this.refillRate = options.refillRate ?? DEFAULT_GEMINI_RATE_LIMIT.refillRate;

    if (!Number.isFinite(this.capacity) || this.capacity <= 0) {
      throw new Error("Rate limiter capacity must be greater than zero.");
    }

    if (!Number.isFinite(this.refillRate) || this.refillRate <= 0) {
      throw new Error("Rate limiter refillRate must be greater than zero.");
    }

    this.tokens = this.capacity;
    this.lastRefillAt = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, this.millisecondsUntilNextToken());
    });

    return this.acquire();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, now - this.lastRefillAt) / 1000;

    if (elapsedSeconds === 0) {
      return;
    }

    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefillAt = now;
  }

  private millisecondsUntilNextToken(): number {
    const missingTokens = 1 - this.tokens;
    return Math.max(0, Math.ceil((missingTokens / this.refillRate) * 1000));
  }
}
