import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalCodebaseContext } from "@harris/codebase";
import type { AgentMessage, AgentResponse, CrossProjectGoal, Goal, NextAction } from "@harris/core";
import { GeminiAgent } from "@harris/gemini";
import { Orchestrator, SwarmBridge, type OrchestratorConfig } from "@harris/orchestrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("SwarmBridge cross-project orchestration", () => {
  const sandboxRoot = join(process.cwd(), "test-sandbox-swarm-bridge");
  const projectARoot = join(sandboxRoot, "project-a");
  const projectBRoot = join(sandboxRoot, "project-b");

  const config: OrchestratorConfig = {
    budget: {
      total: 100000,
      warning_threshold: 0.75,
      hard_stop: 0.95,
      per_agent_default: 10000,
      reserve_percentage: 0.1,
    },
    convergence: {
      max_iterations_per_task: 4,
      max_total_invocations: 10,
      loop_detection_window: 3,
    },
  };

  beforeEach(async () => {
    await mkdir(join(projectARoot, "src"), { recursive: true });
    await mkdir(join(projectBRoot, "src"), { recursive: true });
    await writeFile(join(projectARoot, "src", "api.ts"), "export interface User { id: string; }\n");
    await writeFile(
      join(projectBRoot, "src", "client.ts"),
      "import type { User } from '@project-a/api';\nexport function render(user: User) { return user.id; }\n",
    );
  });

  afterEach(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detects cross-project impact from import analysis", async () => {
    const projectA = await createCodebase(projectARoot);
    const projectB = await createCodebase(projectBRoot);
    const bridge = new SwarmBridge({
      parent: { id: "project-a", codebase: projectA, runner: { runGoal: vi.fn() } },
      children: [{ id: "project-b", codebase: projectB, runner: { runGoal: vi.fn() } }],
    });

    const impacts = await bridge.detectImpacts([
      {
        file: "src/api.ts",
        action: "modify",
        content: "export interface User { id: string; name: string; }\n",
        reasoning: "API contract now requires name.",
      },
    ]);

    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.target_project).toBe("project-b");
    expect(impacts[0]?.matched_imports).toContain("@project-a/api");
    expect(impacts[0]?.importing_files).toContain("src/client.ts");
  });

  it("spawns a child swarm, passes shared context, and waits before testing", async () => {
    const projectA = await createCodebase(projectARoot);
    const projectB = await createCodebase(projectBRoot);
    let childCompleted = false;
    let capturedGoal: CrossProjectGoal | undefined;

    const childRunner = {
      runGoal: vi.fn(async (goal: Goal) => {
        capturedGoal = goal as CrossProjectGoal;
        await Promise.resolve();
        childCompleted = true;
        return goalResult(goal.id, "complete", 1234);
      }),
    };

    const bridge = new SwarmBridge({
      parent: { id: "project-a", codebase: projectA, runner: { runGoal: vi.fn() } },
      children: [{ id: "project-b", codebase: projectB, runner: childRunner }],
    });

    const parent = new Orchestrator(config, projectA, bridge);
    registerParentAgents(parent, {
      onTesterInvoke: () => {
        expect(childCompleted).toBe(true);
      },
    });

    const result = await parent.runGoal(parentGoal());

    expect(result.status).toBe("complete");
    expect(childRunner.runGoal).toHaveBeenCalledTimes(1);
    expect(capturedGoal?.target_project).toBe("project-b");
    expect(capturedGoal?.shared_context.source_project).toBe("project-a");
    expect(capturedGoal?.shared_context.changed_files).toEqual(["src/api.ts"]);
    expect(capturedGoal?.shared_context.matched_imports).toContain("@project-a/api");
    expect(result.token_usage.total).toBe(600);
    expect(bridge.completedRuns[0]?.result.token_usage.total).toBe(1234);
  });

  it("reports child swarm failures to the parent and blocks parent testing", async () => {
    const projectA = await createCodebase(projectARoot);
    const projectB = await createCodebase(projectBRoot);
    const testerInvoked = vi.fn();

    const childRunner = {
      runGoal: vi.fn(async (goal: Goal) => goalResult(goal.id, "failed", 4321)),
    };

    const bridge = new SwarmBridge({
      parent: { id: "project-a", codebase: projectA, runner: { runGoal: vi.fn() } },
      children: [{ id: "project-b", codebase: projectB, runner: childRunner }],
    });

    const parent = new Orchestrator(config, projectA, bridge);
    registerParentAgents(parent, { onTesterInvoke: testerInvoked });

    const result = await parent.runGoal(parentGoal());

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("Child swarm failed for project-b");
    expect(testerInvoked).not.toHaveBeenCalled();
    expect(result.token_usage.total).toBe(400);
    expect(bridge.completedRuns[0]?.result.status).toBe("failed");
    expect(bridge.completedRuns[0]?.result.token_usage.total).toBe(4321);
  });
});

async function createCodebase(root: string): Promise<LocalCodebaseContext> {
  const codebase = new LocalCodebaseContext(root);
  await codebase.initialize();
  return codebase;
}

function parentGoal(): Goal {
  return {
    id: "parent-goal",
    description: "Change the Project A API contract.",
    acceptance_criteria: [{ description: "Project B updates its client contract.", verifiable: true, verified: false }],
    status: "pending",
    budget_allocation: 100000,
    created_by: "user",
    created_at: Date.now(),
  };
}

function goalResult(goalId: string, status: "complete" | "failed", totalTokens: number) {
  return {
    goal_id: goalId,
    status,
    summary: status === "complete" ? "Child swarm updated Project B." : "Child swarm failed.",
    changes: [],
    token_usage: { total: totalTokens, by_agent: { "child-builder": totalTokens } },
    duration_ms: 1,
    audit_trail: [],
  };
}

function registerParentAgents(orchestrator: Orchestrator, options: { onTesterInvoke: () => void }): void {
  const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });
  const builder = new GeminiAgent({ id: "builder-001", role: "builder", model: "gemini-2.5-flash", capabilities: [] });
  const tester = new GeminiAgent({ id: "tester-001", role: "tester", model: "gemini-2.5-flash", capabilities: [] });

  vi.spyOn(architect, "invoke").mockImplementation(async (msg) =>
    response(msg, architect, "Architect delegated API work.", [
      { invoke: "builder", action: "Update Project A API", context: {}, priority: 1, estimated_tokens: 1000 },
    ]),
  );

  vi.spyOn(builder, "invoke").mockImplementation(async (msg) =>
    response(
      msg,
      builder,
      "Updated Project A API.",
      [{ invoke: "tester", action: "Test Project A", context: {}, priority: 1, estimated_tokens: 1000 }],
      [
        {
          file: "src/api.ts",
          action: "modify",
          content: "export interface User { id: string; name: string; }\n",
          reasoning: "API contract now requires name.",
        },
      ],
    ),
  );

  vi.spyOn(tester, "invoke").mockImplementation(async (msg) => {
    options.onTesterInvoke();
    return response(msg, tester, "Parent tests passed.");
  });

  orchestrator.registerAgent(architect);
  orchestrator.registerAgent(builder);
  orchestrator.registerAgent(tester);
}

function response(
  msg: AgentMessage,
  agent: GeminiAgent,
  summary: string,
  nextActions: NextAction[] = [],
  changes: AgentResponse["result"]["changes"] = [],
): AgentResponse {
  return {
    message_id: crypto.randomUUID(),
    in_response_to: msg.message_id,
    trace_id: msg.trace_id,
    status: "complete",
    agent: agent.identity,
    result: { summary, changes },
    next_actions: nextActions,
    token_usage: { input: 100, output: 100, total: 200 },
    confidence: 1,
    flags: [],
  };
}
