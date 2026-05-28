import type { AgentMessage } from "@harris/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiAgent } from "../packages/gemini/src/gemini-agent.js";
import {
  DEFAULT_GEMINI_RATE_LIMIT,
  TokenBucketRateLimiter,
} from "../packages/gemini/src/rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses the Gemini free-tier default of 60 requests per minute", () => {
    expect(DEFAULT_GEMINI_RATE_LIMIT).toEqual({ capacity: 60, refillRate: 1 });
  });

  it("lets requests within capacity proceed immediately", async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 1 });

    await expect(limiter.acquire()).resolves.toBeUndefined();
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });

  it("waits when requests exceed capacity", async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillRate: 1 });
    await limiter.acquire();

    let acquired = false;
    const pendingAcquire = limiter.acquire().then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pendingAcquire;
    expect(acquired).toBe(true);
  });

  it("refills the bucket over time using the configured refill rate", async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });
    await limiter.acquire();
    await limiter.acquire();

    let acquired = false;
    const pendingAcquire = limiter.acquire().then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pendingAcquire;
    expect(acquired).toBe(true);
  });

  it("supports configurable capacity and refill rate", async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 4 });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    let acquired = false;
    const pendingAcquire = limiter.acquire().then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pendingAcquire;
    expect(acquired).toBe(true);
  });

  it("rejects invalid rate limit settings", () => {
    expect(() => new TokenBucketRateLimiter({ capacity: 0 })).toThrow(
      "Rate limiter capacity must be greater than zero.",
    );
    expect(() => new TokenBucketRateLimiter({ refillRate: 0 })).toThrow(
      "Rate limiter refillRate must be greater than zero.",
    );
  });
});

describe("GeminiAgent rate limiting", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: JSON.stringify({
                      message_id: "gemini-response",
                      status: "complete",
                      result: { summary: "Generated response." },
                      next_actions: [],
                      confidence: 0.9,
                      flags: [],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("acquires a token before calling the Gemini API", async () => {
    let releaseToken: () => void = () => {};
    const rateLimiter = {
      acquire: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseToken = resolve;
          }),
      ),
    };
    const agent = new GeminiAgent(
      {
        id: "builder-001",
        role: "builder",
        model: "gemini-2.5-flash",
        capabilities: [],
      },
      { apiKey: "REAL_KEY", rateLimiter },
    );

    const invocation = agent.invoke(createMessage());
    await Promise.resolve();

    expect(rateLimiter.acquire).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    releaseToken();
    await invocation;

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function createMessage(): AgentMessage {
  return {
    message_id: "message-1",
    type: "task",
    from: { id: "orchestrator", role: "architect" },
    to: { id: "builder-001", role: "builder" },
    trace_id: "trace-message-1",
    action: "Implement feature",
    context: {
      goal: "Implement feature",
      relevant_files: ["src/index.ts"],
      constraints: [],
      prior_decisions: [],
      iteration: 1,
      max_iterations: 3,
    },
    budget: {
      total: 100000,
      consumed: 0,
      remaining: 100000,
      your_allocation: 10000,
      zone: "green",
      warning_threshold: 0.75,
      hard_stop: 0.95,
    },
    metadata: {
      timestamp: Date.now(),
      priority: 1,
      iteration: 1,
      max_iterations: 3,
    },
  };
}
