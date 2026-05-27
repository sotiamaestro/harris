export type WebhookEvent =
  | "goal:start"
  | "goal:complete"
  | "goal:failed"
  | "task:complete"
  | "budget:warning";

export interface WebhookManagerOptions {
  timeout_ms?: number;
  retry_count?: number;
  fetch_impl?: typeof fetch;
}

interface WebhookRegistration {
  url: string;
  events: Set<string>;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_COUNT = 1;

export class WebhookManager {
  private readonly registrations: WebhookRegistration[] = [];
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WebhookManagerOptions = {}) {
    this.timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.retryCount = options.retry_count ?? DEFAULT_RETRY_COUNT;
    this.fetchImpl = options.fetch_impl ?? fetch;
  }

  register(url: string, events: string[]): void {
    if (!events.length) {
      return;
    }

    new URL(url);
    this.registrations.push({
      url,
      events: new Set(events),
    });
  }

  async fire(event: string, payload: unknown): Promise<void> {
    const deliveries = this.registrations.filter((registration) => registration.events.has(event));
    for (const delivery of deliveries) {
      void this.deliverWithRetry(delivery.url, event, payload);
    }
  }

  private async deliverWithRetry(url: string, event: string, payload: unknown): Promise<void> {
    let attempt = 0;
    while (attempt <= this.retryCount) {
      try {
        await this.post(url, event, payload);
        return;
      } catch {
        attempt++;
      }
    }
  }

  private async post(url: string, event: string, payload: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          event,
          payload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook POST failed with status ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
