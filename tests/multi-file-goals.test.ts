import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalCodebaseContext } from "@harris/codebase";
import type { AgentMessage, AgentResponse, Goal, NextAction } from "@harris/core";
import { GeminiAgent } from "@harris/gemini";
import { Orchestrator, type OrchestratorConfig } from "@harris/orchestrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("multi-file goal orchestration", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-multi-file-goals");

  beforeEach(async () => {
    await mkdir(join(sandboxDir, "auth"), { recursive: true });
    await mkdir(join(sandboxDir, "billing"), { recursive: true });
    await mkdir(join(sandboxDir, "shared"), { recursive: true });
    await writeFile(join(sandboxDir, "auth", "login.ts"), "export const login = true;\n");
    await writeFile(join(sandboxDir, "auth", "session.ts"), "export const session = true;\n");
    await writeFile(join(sandboxDir, "billing", "invoice.ts"), "export const invoice = true;\n");
    await writeFile(join(sandboxDir, "billing", "tax.ts"), "export const tax = true;\n");
    await writeFile(join(sandboxDir, "billing", "payment.ts"), "export const payment = true;\n");
    await writeFile(join(sandboxDir, "shared", "types.ts"), "export interface Shared {}\n");
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("groups 5+ files by directory, runs builders in parallel, reviews each group, and tests once", async () => {
    const codebase = new LocalCodebaseContext(sandboxDir);
    await codebase.initialize();
    const orchestrator = new Orchestrator(config(), codebase);
    const architect = agent("architect");
    const builder = agent("builder");
    const reviewer = agent("reviewer");
    const tester = agent("tester");

    vi.spyOn(architect, "invoke").mockImplementation(async (msg) =>
      response(msg, architect, "Grouped by module.", [
        { invoke: "builder", action: "Implement multi-file refactor", context: {}, priority: 1, estimated_tokens: 6000 },
      ]),
    );

    const builderMessages: AgentMessage[] = [];
    let releaseBuilders!: () => void;
    const allBuildersStarted = new Promise<void>((resolve) => {
      releaseBuilders = resolve;
    });

    vi.spyOn(builder, "invoke").mockImplementation(async (msg) => {
      builderMessages.push(msg);
      if (builderMessages.length === 3) {
        releaseBuilders();
      }
      await allBuildersStarted;
      return response(
        msg,
        builder,
        `Built ${msg.context.relevant_files.join(", ")}`,
        [{ invoke: "reviewer", action: "Review group", context: { relevant_files: msg.context.relevant_files }, priority: 1, estimated_tokens: 500 }],
        msg.context.relevant_files.map((file) => ({
          file,
          action: "modify" as const,
          content: `// updated ${file}\n`,
          reasoning: "Multi-file group update",
        })),
      );
    });

    const reviewedGroups: string[][] = [];
    vi.spyOn(reviewer, "invoke").mockImplementation(async (msg) => {
      reviewedGroups.push(msg.context.relevant_files);
      return response(msg, reviewer, `Reviewed ${msg.context.relevant_files.join(", ")}`);
    });

    const testerMessages: AgentMessage[] = [];
    vi.spyOn(tester, "invoke").mockImplementation(async (msg) => {
      testerMessages.push(msg);
      expect(reviewedGroups).toHaveLength(3);
      return response(msg, tester, "Full suite passed.");
    });

    orchestrator.registerAgent(architect);
    orchestrator.registerAgent(builder);
    orchestrator.registerAgent(reviewer);
    orchestrator.registerAgent(tester);

    const result = await orchestrator.runGoal(goal());

    expect(result.status).toBe("complete");
    expect(builderMessages).toHaveLength(3);
    expect(builderMessages.map((msg) => [...msg.context.relevant_files].sort()).sort(byFirstFile)).toEqual([
      ["auth/login.ts", "auth/session.ts"],
      ["billing/invoice.ts", "billing/payment.ts", "billing/tax.ts"],
      ["shared/types.ts"],
    ]);
    expect(builderMessages.map((msg) => msg.metadata.estimated_tokens).sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual([
      1000,
      2000,
      3000,
    ]);
    expect(builderMessages.every((msg) => msg.context.constraints.some((constraint) => constraint.startsWith("MULTI-FILE GROUP:")))).toBe(true);
    expect(reviewedGroups).toHaveLength(3);
    expect(testerMessages).toHaveLength(1);
    expect(testerMessages[0]?.action).toBe("Run full test suite after multi-file groups");
    expect(testerMessages[0]?.context.relevant_files).toHaveLength(6);
    expect(result.changes).toHaveLength(6);
  });
});

function agent(role: "architect" | "builder" | "reviewer" | "tester"): GeminiAgent {
  return new GeminiAgent({ id: `${role}-001`, role, model: "gemini-2.5-flash", capabilities: [] });
}

function response(
  msg: AgentMessage,
  agentInstance: GeminiAgent,
  summary: string,
  nextActions: NextAction[] = [],
  changes: AgentResponse["result"]["changes"] = [],
): AgentResponse {
  return {
    message_id: crypto.randomUUID(),
    in_response_to: msg.message_id,
    trace_id: msg.trace_id,
    status: "complete",
    agent: agentInstance.identity,
    result: { summary, changes },
    next_actions: nextActions,
    token_usage: { input: 100, output: 100, total: 200 },
    confidence: 1,
    flags: [],
  };
}

function byFirstFile(left: string[], right: string[]): number {
  return (left[0] ?? "").localeCompare(right[0] ?? "");
}

function goal(): Goal {
  return {
    id: "multi-file-goal",
    description: "Refactor all modules",
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
      max_iterations_per_task: 4,
      max_total_invocations: 20,
      loop_detection_window: 3,
    },
  };
}
