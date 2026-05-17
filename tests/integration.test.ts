import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GeminiAgent } from "@harris/gemini";
import { createHarris } from "@harris/orchestrator";
import type { AgentMessage, FileChange } from "@harris/core";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("Live Gemini API Integration", () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const skipTest = !apiKey;

  if (skipTest) {
    it.skip("Skipping live integration tests (GEMINI_API_KEY not set)", () => {});
    return;
  }

  const sandboxDir = join(process.cwd(), "test-sandbox-integration");

  beforeAll(async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "index.ts"), "import { add } from './math.js';\nconsole.log(add(2, 3));\n");
    await writeFile(join(sandboxDir, "math.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    await writeFile(join(sandboxDir, "auth.ts"), "export function checkUser() { return true; }\n");
  });

  afterAll(async () => {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  });

  it("should support Architect decomposing a goal into next actions", async () => {
    const agent = new GeminiAgent(
      {
        id: "architect-test",
        role: "architect",
        model: "gemini-2.5-flash",
        capabilities: ["decomposition", "delegation"],
        temperature: 0.1,
      },
      { apiKey },
    );

    const message: AgentMessage = {
      message_id: "arch-msg-id",
      trace_id: "arch-trace-id",
      type: "task",
      from: { id: "orchestrator", role: "architect" },
      to: { id: "architect-test", role: "architect" },
      action: "decompose_goal",
      context: {
        goal: "Refactor math.ts to add a subtract function and verify it works in index.ts.",
        relevant_files: ["math.ts", "index.ts"],
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
        warning_threshold: 0.8,
        hard_stop: 0.95,
      },
      metadata: {
        timestamp: Date.now(),
        priority: 1,
        iteration: 1,
        max_iterations: 3,
      },
    };

    const response = await agent.invoke(message);
    expect(response.status).toBe("complete");
    expect(response.next_actions.length).toBeGreaterThan(0);
    expect(response.result.summary).toBeDefined();
  });

  it("should support Builder writing code from a spec", async () => {
    const agent = new GeminiAgent(
      {
        id: "builder-test",
        role: "builder",
        model: "gemini-2.5-flash",
        capabilities: ["code_writing"],
        temperature: 0.1,
      },
      { apiKey },
    );

    const message: AgentMessage = {
      message_id: "build-msg-id",
      trace_id: "build-trace-id",
      type: "task",
      from: { id: "architect-001", role: "architect" },
      to: { id: "builder-test", role: "builder" },
      action: "Implement subtract function",
      context: {
        goal: "Implement a subtract function inside math.ts",
        relevant_files: ["math.ts"],
        constraints: ["Must export subtract(a: number, b: number): number"],
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
        warning_threshold: 0.8,
        hard_stop: 0.95,
      },
      metadata: {
        timestamp: Date.now(),
        priority: 1,
        iteration: 1,
        max_iterations: 3,
      },
    };

    const response = await agent.invoke(message);
    expect(response.status).toBe("complete");
    expect(response.result.changes).toBeDefined();
    expect(response.result.changes!.length).toBeGreaterThan(0);
    const change = response.result.changes![0];
    expect(change.file).toBe("math.ts");
    expect(change.content).toContain("subtract");
  });

  it("should support Reviewer providing code review feedback", async () => {
    const agent = new GeminiAgent(
      {
        id: "reviewer-test",
        role: "reviewer",
        model: "gemini-2.5-flash",
        capabilities: ["code_review"],
        temperature: 0.1,
      },
      { apiKey },
    );

    const changes: FileChange[] = [
      {
        file: "math.ts",
        action: "modify",
        content: "export function subtract(a: any, b: any) { return a - b; }",
        reasoning: "Quick subtract implementation",
      },
    ];

    const message: AgentMessage = {
      message_id: "review-msg-id",
      trace_id: "review-trace-id",
      type: "task",
      from: { id: "builder-001", role: "builder" },
      to: { id: "reviewer-test", role: "reviewer" },
      action: "Review subtract modifications",
      context: {
        goal: "Check subtract implementation has proper types.",
        relevant_files: ["math.ts"],
        constraints: ["Ensure strict typing"],
        prior_decisions: [],
        iteration: 1,
        max_iterations: 3,
      },
      payload: { changes },
      budget: {
        total: 100000,
        consumed: 0,
        remaining: 100000,
        your_allocation: 10000,
        zone: "green",
        warning_threshold: 0.8,
        hard_stop: 0.95,
      },
      metadata: {
        timestamp: Date.now(),
        priority: 1,
        iteration: 1,
        max_iterations: 3,
      },
    };

    const response = await agent.invoke(message);
    expect(response.status).toBeDefined();
    expect(response.result).toBeDefined();
  });

  it("should execute a full live swarm run against the 3-file codebase", async () => {
    const harris = await createHarris({
      gemini_api_key: apiKey!,
      codebase_path: sandboxDir,
      budget: {
        total: 1_000_000,
      },
    });

    const result = await harris.run(
      "Add a multiply function to math.ts and export it, then print its result in index.ts.",
      ["Verify multiply is exported", "Verify index.ts is updated"],
    );

    expect(result.status).toBeDefined();
    expect(result.token_usage.total).toBeGreaterThan(0);
    expect(result.audit_trail.length).toBeGreaterThan(0);
  });
});
