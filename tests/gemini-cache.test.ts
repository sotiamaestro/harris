import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalCodebaseContext } from "@harris/codebase";
import type { AgentMessage, AgentResponse, Goal } from "@harris/core";
import { GeminiAgent } from "@harris/gemini";
import { Orchestrator, type OrchestratorConfig } from "@harris/orchestrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GeminiAgent response cache", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-gemini-cache");

  beforeEach(async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "index.ts"), "export const ok = true;\n", "utf-8");
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns cached responses for identical inputs and tracks stats", async () => {
    const agent = createAgent("builder");
    const first = await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use numbers"], "message-1"));
    const second = await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use numbers"], "message-2"));

    expect(second.result).toEqual(first.result);
    expect(second.in_response_to).toBe("message-2");
    expect(second.message_id).toBe("message-2");
    expect(agent.getCacheStats()).toEqual({ hits: 1, misses: 1, size: 1, capacity: 50 });
  });

  it("bypasses cache for different actions, files, or constraints", async () => {
    const agent = createAgent("builder");

    await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use numbers"], "message-1"));
    await agent.invoke(createMessage("builder", "Implement add", ["math.ts"], ["Use numbers"], "message-2"));
    await agent.invoke(createMessage("builder", "Implement subtract", ["calculator.ts"], ["Use numbers"], "message-3"));
    await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use strings"], "message-4"));

    expect(agent.getCacheStats()).toMatchObject({ hits: 0, misses: 4, size: 4 });
  });

  it("evicts least recently used entries after reaching capacity", async () => {
    const agent = createAgent("builder");

    for (let index = 0; index < 50; index++) {
      await agent.invoke(createMessage("builder", `Action ${index}`, ["math.ts"], ["Use numbers"], `message-${index}`));
    }
    await agent.invoke(createMessage("builder", "Action 1", ["math.ts"], ["Use numbers"], "message-refresh"));
    await agent.invoke(createMessage("builder", "Action 50", ["math.ts"], ["Use numbers"], "message-new"));
    await agent.invoke(createMessage("builder", "Action 0", ["math.ts"], ["Use numbers"], "message-evicted"));
    await agent.invoke(createMessage("builder", "Action 1", ["math.ts"], ["Use numbers"], "message-still-cached"));

    expect(agent.getCacheStats()).toMatchObject({ hits: 2, misses: 52, size: 50 });
  });

  it("resets cache and stats explicitly", async () => {
    const agent = createAgent("builder");
    await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use numbers"], "message-1"));
    await agent.invoke(createMessage("builder", "Implement subtract", ["math.ts"], ["Use numbers"], "message-2"));

    agent.resetResponseCache();

    expect(agent.getCacheStats()).toEqual({ hits: 0, misses: 0, size: 0, capacity: 50 });
  });

  it("does not persist cache across orchestrator goal runs", async () => {
    const codebase = new LocalCodebaseContext(sandboxDir);
    await codebase.initialize();
    const orchestrator = new Orchestrator(config(), codebase);
    const architect = createAgent("architect");
    const invokeSpy = vi.spyOn(architect, "invoke");
    orchestrator.registerAgent(architect);

    await orchestrator.runGoal(createGoal());
    await orchestrator.runGoal(createGoal());

    expect(invokeSpy).toHaveBeenCalledTimes(2);
    expect(architect.getCacheStats()).toMatchObject({ hits: 0, misses: 1, size: 1 });
  });
});

function createAgent(role: "architect" | "builder"): GeminiAgent {
  return new GeminiAgent({
    id: `${role}-001`,
    role,
    model: "gemini-2.5-flash",
    capabilities: [],
  });
}

function createMessage(
  role: "architect" | "builder",
  action: string,
  relevantFiles: string[],
  constraints: string[],
  messageId: string,
): AgentMessage {
  return {
    message_id: messageId,
    type: "task",
    from: { id: "orchestrator", role: "architect" },
    to: { id: `${role}-001`, role },
    trace_id: `trace-${messageId}`,
    action,
    context: {
      goal: "Implement subtract",
      relevant_files: relevantFiles,
      constraints,
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

function createGoal(): Goal {
  return {
    id: crypto.randomUUID(),
    description: "Implement subtract",
    acceptance_criteria: [],
    status: "pending",
    budget_allocation: 100000,
    created_by: "user",
    created_at: Date.now(),
  };
}

function config(): OrchestratorConfig {
  return {
    budget: {
      total: 100000,
      warning_threshold: 0.75,
      hard_stop: 0.95,
      per_agent_default: 10000,
      reserve_percentage: 0.1,
    },
    convergence: {
      max_iterations_per_task: 3,
      max_total_invocations: 5,
      loop_detection_window: 3,
    },
  };
}
