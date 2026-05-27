import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebhookManager } from "@harris/orchestrator";
import { afterEach, describe, expect, it } from "vitest";

interface ReceivedWebhook {
  event: string;
  payload: unknown;
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
    activeServer = undefined;
  }
});

describe("WebhookManager", () => {
  it("fires registered events with JSON payloads", async () => {
    const received: ReceivedWebhook[] = [];
    const url = await startServer(async (req, res) => {
      received.push(JSON.parse(await readBody(req)) as ReceivedWebhook);
      res.writeHead(204);
      res.end();
    });
    const manager = new WebhookManager();

    manager.register(url, ["goal:start"]);
    await manager.fire("goal:start", { goal_id: "goal-1" });
    await waitFor(() => received.length === 1);

    expect(received).toEqual([{ event: "goal:start", payload: { goal_id: "goal-1" } }]);
  });

  it("does not fire unregistered events", async () => {
    const received: ReceivedWebhook[] = [];
    const url = await startServer(async (req, res) => {
      received.push(JSON.parse(await readBody(req)) as ReceivedWebhook);
      res.writeHead(204);
      res.end();
    });
    const manager = new WebhookManager();

    manager.register(url, ["goal:start"]);
    await manager.fire("task:complete", { task_id: "task-1" });
    await sleep(30);

    expect(received).toHaveLength(0);
  });

  it("retries once when a webhook request fails", async () => {
    let attempts = 0;
    const received: ReceivedWebhook[] = [];
    const url = await startServer(async (req, res) => {
      attempts++;
      received.push(JSON.parse(await readBody(req)) as ReceivedWebhook);
      if (attempts === 1) {
        res.writeHead(500);
      } else {
        res.writeHead(204);
      }
      res.end();
    });
    const manager = new WebhookManager();

    manager.register(url, ["goal:complete"]);
    await manager.fire("goal:complete", { goal_id: "goal-1" });
    await waitFor(() => attempts === 2);

    expect(received).toHaveLength(2);
    expect(received[1]).toEqual({ event: "goal:complete", payload: { goal_id: "goal-1" } });
  });

  it("uses a per-request timeout before retrying", async () => {
    let attempts = 0;
    const url = await startServer(async (_req, res) => {
      attempts++;
      await sleep(100);
      res.writeHead(204);
      res.end();
    });
    const manager = new WebhookManager({ timeout_ms: 20 });

    manager.register(url, ["budget:warning"]);
    await manager.fire("budget:warning", { consumed: 950 });
    await waitFor(() => attempts === 2, 300);

    expect(attempts).toBe(2);
  });

  it("returns before network delivery completes", async () => {
    const url = await startServer(async (_req, res) => {
      await sleep(100);
      res.writeHead(204);
      res.end();
    });
    const manager = new WebhookManager();

    manager.register(url, ["goal:failed"]);
    const started = Date.now();
    await manager.fire("goal:failed", { goal_id: "goal-1" });

    expect(Date.now() - started).toBeLessThan(50);
  });
});

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<string> {
  activeServer = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve) => activeServer?.listen(0, "127.0.0.1", () => resolve()));
  const address = activeServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a local port");
  }
  return `http://127.0.0.1:${address.port}/webhook`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await sleep(5);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
