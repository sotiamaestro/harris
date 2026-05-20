import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHarris, registerPlugin, listPlugins } from "@harris/orchestrator";
import { GeminiAgent } from "@harris/gemini";
import { buildSystemPrompt } from "../packages/gemini/src/prompt-builder.js";
import type { AgentMessage, AgentResponse, Goal } from "@harris/core";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

describe("Harris Swarm Plugin System", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-plugins");

  beforeAll(async () => {
    await mkdir(sandboxDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  });

  it("should register and list plugins correctly", () => {
    const originalCount = listPlugins().length;

    registerPlugin({
      name: "test-plugin-list",
      version: "1.2.3",
    });

    const plugins = listPlugins();
    expect(plugins.length).toBe(originalCount + 1);
    expect(plugins.some((p) => p.name === "test-plugin-list" && p.version === "1.2.3")).toBe(true);
  });

  it("should fail when registering a plugin with a duplicate name", () => {
    registerPlugin({
      name: "duplicate-plugin",
      version: "1.0.0",
    });

    expect(() => {
      registerPlugin({
        name: "duplicate-plugin",
        version: "2.0.0",
      });
    }).toThrow(/already registered/);
  });

  it("should integrate custom agents from plugins in createHarris", async () => {
    registerPlugin({
      name: "custom-agent-plugin",
      version: "1.0.0",
      agents: [
        {
          id: "custom-builder-002",
          role: "builder",
          model: "gemini-2.5-flash",
          capabilities: ["advanced_plugin_capabilities"],
          temperature: 0.1,
        },
      ],
    });

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
    });

    // Check if the plugin agent is registered in the orchestrator
    const registeredAgent = (harris.orchestrator as any).agents.get("custom-builder-002");
    expect(registeredAgent).toBeDefined();
    expect(registeredAgent.identity.id).toBe("custom-builder-002");
    expect(registeredAgent.identity.role).toBe("builder");
  });

  it("should load custom prompts from plugins", () => {
    registerPlugin({
      name: "custom-prompt-plugin",
      version: "1.0.0",
      prompts: {
        "custom-agent-prompt-test": () => "Instruction from custom-agent-prompt-test",
        reviewer: () => "Extra instructions for reviewer role",
      },
    });

    // 1. Role-specific prompt test
    const reviewerConfig = {
      id: "reviewer-test-01",
      role: "reviewer" as any,
      model: "gemini-2.5-flash" as any,
      capabilities: [],
    };
    const reviewerPrompt = buildSystemPrompt(reviewerConfig, []);
    expect(reviewerPrompt).toContain("Extra instructions for reviewer role");

    // 2. Agent ID-specific prompt test
    const agentConfig = {
      id: "custom-agent-prompt-test",
      role: "builder" as any,
      model: "gemini-2.5-flash" as any,
      capabilities: [],
    };
    const agentPrompt = buildSystemPrompt(agentConfig, []);
    expect(agentPrompt).toContain("Instruction from custom-agent-prompt-test");
  });

  it("should execute hooks in load order at correct lifecycle points", async () => {
    const hookOrder: string[] = [];

    registerPlugin({
      name: "hook-plugin-1",
      version: "1.0.0",
      hooks: {
        beforeInvoke: (msg) => {
          hookOrder.push("plugin1-before");
          msg.action = msg.action + "_1";
          return msg;
        },
        afterInvoke: (res) => {
          hookOrder.push("plugin1-after");
          res.result.summary = res.result.summary + "_1";
          return res;
        },
      },
    });

    registerPlugin({
      name: "hook-plugin-2",
      version: "1.0.0",
      hooks: {
        beforeInvoke: (msg) => {
          hookOrder.push("plugin2-before");
          msg.action = msg.action + "_2";
          return msg;
        },
        afterInvoke: (res) => {
          hookOrder.push("plugin2-after");
          res.result.summary = res.result.summary + "_2";
          return res;
        },
      },
    });

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
    });

    // Get an agent to spy on or mock
    const architect = (harris.orchestrator as any).agents.get("architect-001") as GeminiAgent;
    expect(architect).toBeDefined();

    let finalAction = "";
    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      finalAction = msg.action;
      return {
        message_id: "resp-1",
        in_response_to: msg.message_id,
        trace_id: msg.trace_id,
        status: "complete",
        agent: architect.identity,
        result: { summary: "Success" },
        next_actions: [],
        token_usage: { input: 10, output: 10, total: 20 },
        confidence: 1.0,
        flags: [],
      };
    });

    const goal: Goal = {
      id: "goal-plugin-hooks",
      description: "Test hook flows",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    const result = await harris.orchestrator.runGoal(goal);

    // Verify correct sequence of hooks: beforeInvoke hooks (1 then 2) -> agent invoke -> afterInvoke hooks (1 then 2)
    expect(hookOrder).toEqual([
      "plugin1-before",
      "plugin2-before",
      "plugin1-after",
      "plugin2-after",
    ]);

    // Verify hooks modified messages and responses correctly
    expect(finalAction).toBe("decompose_goal_1_2");
    expect(result.summary).toBe("Success_1_2");
  });

  it("should trigger onError hooks when an agent invocation fails", async () => {
    let errorCaught: Error | null = null;
    let msgPassed: AgentMessage | null = null;

    registerPlugin({
      name: "error-handling-plugin",
      version: "1.0.0",
      hooks: {
        onError: (err, msg) => {
          errorCaught = err;
          msgPassed = msg;
        },
      },
    });

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
    });

    const architect = (harris.orchestrator as any).agents.get("architect-001") as GeminiAgent;
    vi.spyOn(architect, "invoke").mockImplementation(async () => {
      throw new Error("Simulated agent failure");
    });

    const goal: Goal = {
      id: "goal-plugin-error",
      description: "Test error handling hooks",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    await harris.orchestrator.runGoal(goal);

    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toBe("Simulated agent failure");
    expect(msgPassed).not.toBeNull();
    expect(msgPassed!.action).toContain("decompose_goal");
  });
});
