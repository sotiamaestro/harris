import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalCodebaseContext } from "@harris/codebase";
import type { AgentMessage, AgentResponse, Goal } from "@harris/core";
import { GeminiAgent } from "@harris/gemini";
import { Orchestrator, type OrchestratorConfig } from "@harris/orchestrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("custom acceptance criteria validators", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-goal-validators");

  const config: OrchestratorConfig = {
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

  beforeEach(async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "index.ts"), "export const status = 'ok';\n", "utf-8");
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs custom validators after swarm completion", async () => {
    const order: string[] = [];
    const { orchestrator } = await createMockOrchestrator(async () => {
      order.push("swarm");
      return "Swarm completed.";
    });
    const goal = createGoal([
      {
        description: "Custom validation passes",
        verifiable: true,
        verified: false,
        validator: async (codebase) => {
          order.push("validator");
          const file = await codebase.read("index.ts");
          return file.content.includes("ok");
        },
      },
    ]);

    const result = await orchestrator.runGoal(goal);

    expect(order).toEqual(["swarm", "validator"]);
    expect(goal.acceptance_criteria[0]?.verified).toBe(true);
    expect(goal.acceptance_criteria[0]?.verified_by).toBe("custom-validator");
    expect(result.summary).toContain("Custom validators: 1/1 passed.");
  });

  it("marks validator failures as unverified", async () => {
    const { orchestrator } = await createMockOrchestrator();
    const goal = createGoal([
      {
        description: "Custom validation fails",
        verifiable: true,
        verified: true,
        validator: async () => false,
      },
    ]);

    const result = await orchestrator.runGoal(goal);

    expect(goal.acceptance_criteria[0]?.verified).toBe(false);
    expect(goal.acceptance_criteria[0]?.verified_by).toBe("custom-validator");
    expect(result.summary).toContain("Custom validators: 0/1 passed.");
    expect(result.summary).toContain("Failed criterion: Custom validation fails.");
  });

  it("supports a mix of agent-verified and custom-verified criteria", async () => {
    const { orchestrator } = await createMockOrchestrator();
    const goal = createGoal([
      {
        description: "Agent verified criterion",
        verifiable: true,
        verified: true,
        verified_by: "tester-001",
      },
      {
        description: "Custom verified criterion",
        verifiable: true,
        verified: false,
        validator: async () => true,
      },
    ]);

    await orchestrator.runGoal(goal);

    expect(goal.acceptance_criteria[0]).toMatchObject({
      verified: true,
      verified_by: "tester-001",
    });
    expect(goal.acceptance_criteria[1]).toMatchObject({
      verified: true,
      verified_by: "custom-validator",
    });
  });

  it("catches validator errors and reports them", async () => {
    const { orchestrator } = await createMockOrchestrator();
    const goal = createGoal([
      {
        description: "Validator throws",
        verifiable: true,
        verified: true,
        validator: async () => {
          throw new Error("npm test failed with exit code 1");
        },
      },
    ]);

    const result = await orchestrator.runGoal(goal);

    expect(goal.acceptance_criteria[0]?.verified).toBe(false);
    expect(goal.acceptance_criteria[0]?.verified_by).toBe("custom-validator");
    expect(result.summary).toContain('Validator error for "Validator throws": npm test failed with exit code 1.');
  });

  async function createMockOrchestrator(summaryFactory: () => Promise<string> | string = () => "Swarm completed.") {
    const codebase = new LocalCodebaseContext(sandboxDir);
    await codebase.initialize();
    const orchestrator = new Orchestrator(config, codebase);
    const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });

    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "architect-response",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: architect.identity,
      result: { summary: await summaryFactory() },
      next_actions: [],
      token_usage: { input: 10, output: 10, total: 20 },
      confidence: 1,
      flags: [],
    }));

    orchestrator.registerAgent(architect);
    return { orchestrator, codebase };
  }
});

function createGoal(acceptanceCriteria: Goal["acceptance_criteria"]): Goal {
  return {
    id: crypto.randomUUID(),
    description: "Run goal with custom validators",
    acceptance_criteria: acceptanceCriteria,
    status: "pending",
    budget_allocation: 100000,
    created_by: "user",
    created_at: Date.now(),
  };
}
