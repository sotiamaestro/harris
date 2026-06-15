import { describe, it, expect, vi } from "vitest";
import { Orchestrator, type OrchestratorConfig } from "@harris/orchestrator";
import { GeminiAgent } from "@harris/gemini";
import { LocalCodebaseContext } from "@harris/codebase";
import type { AgentMessage, AgentResponse, Goal } from "@harris/core";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("Swarm Non-Happy-Path Orchestration", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-failures");

  const buildConfig = (warning = 0.5, hard = 0.9): OrchestratorConfig => ({
    budget: {
      total: 100000,
      warning_threshold: warning,
      hard_stop: hard,
      per_agent_default: 10000,
      reserve_percentage: 0.1,
    },
    convergence: {
      max_iterations_per_task: 4,
      max_total_invocations: 10,
      loop_detection_window: 3,
    },
  });

  const setupCodebase = async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "greet.ts"), "export function greet() { return 'hello'; }\n");
    const codebase = new LocalCodebaseContext(sandboxDir);
    await codebase.initialize();
    return codebase;
  };

  const cleanupCodebase = async () => {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  };

  it("should handle (a) Reviewer feedback loop and Builder correction", async () => {
    const codebase = await setupCodebase();
    const config = buildConfig();
    const orchestrator = new Orchestrator(config, codebase);

    // Mock Agents
    const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });
    const builder = new GeminiAgent({ id: "builder-001", role: "builder", model: "gemini-2.5-flash", capabilities: [] });
    const reviewer = new GeminiAgent({ id: "reviewer-001", role: "reviewer", model: "gemini-2.5-flash", capabilities: [] });

    // Mock Architect: immediately delegates to Builder
    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "arch-resp-1",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: architect.identity,
      result: { summary: "Decomposed" },
      next_actions: [{ invoke: "builder", action: "Write code", context: {}, priority: 1, estimated_tokens: 1000 }],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 1.0,
      flags: [],
    }));

    // Mock Builder:
    // First call: writes basic code, delegates to Reviewer
    // Second call: reads feedback, corrects it, delegates to Reviewer
    let builderCalls = 0;
    vi.spyOn(builder, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      builderCalls++;
      if (builderCalls === 1) {
        return {
          message_id: "builder-resp-1",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "complete",
          agent: builder.identity,
          result: {
            summary: "Initial draft written",
            changes: [{ file: "greet.ts", action: "modify", content: "export function greet(name: any) { return 'hello ' + name; }", reasoning: "Basic greet" }],
          },
          next_actions: [{ invoke: "reviewer", action: "Review code", context: {}, priority: 1, estimated_tokens: 1000 }],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 0.9,
          flags: [],
        };
      } else {
        return {
          message_id: "builder-resp-2",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "complete",
          agent: builder.identity,
          result: {
            summary: "Fixed greet based on review comments",
            changes: [{ file: "greet.ts", action: "modify", content: "export function greet(name: string): string { return 'hello ' + name; }", reasoning: "Typed greet" }],
          },
          next_actions: [],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 1.0,
          flags: [],
        };
      }
    });

    // Mock Reviewer:
    // First call: Rejects and gives feedback, invokes Builder again
    // Second call: Accepts
    let reviewerCalls = 0;
    vi.spyOn(reviewer, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      reviewerCalls++;
      if (reviewerCalls === 1) {
        return {
          message_id: "reviewer-resp-1",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "needs_peer",
          agent: reviewer.identity,
          result: {
            summary: "Review failed: 'any' type used.",
            feedback: [{ severity: "blocking", file: "greet.ts", location: "name: any", issue: "Avoid any type", reasoning: "Needs strict types", suggestion: "Use string type" }],
          },
          next_actions: [{ invoke: "builder", action: "Fix types based on feedback", context: { constraints: ["Use strict types only"] }, priority: 1, estimated_tokens: 1000 }],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 0.95,
          flags: [],
        };
      } else {
        return {
          message_id: "reviewer-resp-2",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "complete",
          agent: reviewer.identity,
          result: { summary: "Code is clean!" },
          next_actions: [],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 1.0,
          flags: [],
        };
      }
    });

    orchestrator.registerAgent(architect);
    orchestrator.registerAgent(builder);
    orchestrator.registerAgent(reviewer);

    const goal: Goal = {
      id: "goal-1",
      description: "Implement strictly typed greet function",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    const result = await orchestrator.runGoal(goal);
    expect(result.status).toBe("complete");
    expect(builderCalls).toBe(2);
    expect(reviewerCalls).toBe(2);
    expect(result.changes.length).toBe(2);
    expect(result.changes[1].content).toContain("name: string");

    await cleanupCodebase();
  });

  it("should handle (b) Tester debug loop with Debugger and Builder", async () => {
    const codebase = await setupCodebase();
    const config = buildConfig();
    const orchestrator = new Orchestrator(config, codebase);

    const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });
    const tester = new GeminiAgent({ id: "tester-001", role: "tester", model: "gemini-2.5-flash", capabilities: [] });
    const debugAgent = new GeminiAgent({ id: "debugger-001", role: "debugger", model: "gemini-2.5-flash", capabilities: [] });
    const builder = new GeminiAgent({ id: "builder-001", role: "builder", model: "gemini-2.5-flash", capabilities: [] });

    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "arch-1",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: architect.identity,
      result: { summary: "Goal started" },
      next_actions: [{ invoke: "tester", action: "Run tests", context: {}, priority: 1, estimated_tokens: 1000 }],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 1.0,
      flags: [],
    }));

    let testerCalls = 0;
    vi.spyOn(tester, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      testerCalls++;
      if (testerCalls === 1) {
        return {
          message_id: "tester-resp-1",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "needs_peer",
          agent: tester.identity,
          result: {
            summary: "Tests failed",
            test_results: {
              total: 1,
              passed: 0,
              failed: 1,
              failures: [{ test_name: "should return hello", expected: "hello", actual: "undefined", file: "greet.ts", analysis: "Function is empty" }],
              coverage_summary: "0%",
            },
          },
          next_actions: [{ invoke: "debugger", action: "Diagnose failures", context: {}, priority: 1, estimated_tokens: 1000 }],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 0.9,
          flags: [],
        };
      } else {
        return {
          message_id: "tester-resp-2",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "complete",
          agent: tester.identity,
          result: { summary: "Tests passing cleanly" },
          next_actions: [],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 1.0,
          flags: [],
        };
      }
    });

    vi.spyOn(debugAgent, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "debug-resp-1",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: debugAgent.identity,
      result: {
        summary: "Diagnosis done",
        diagnosis: { symptom: "Undefined result", root_cause: "Missing return keyword", location: "greet.ts", mechanism: "syntax", fix_guidance: "Add return 'hello'", risk_assessment: "none", prevention: "check types" },
      },
      next_actions: [{ invoke: "builder", action: "Apply fix", context: {}, priority: 1, estimated_tokens: 1000 }],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 0.95,
      flags: [],
    }));

    vi.spyOn(builder, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "builder-resp-1",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: builder.identity,
      result: {
        summary: "Fix applied",
        changes: [{ file: "greet.ts", action: "modify", content: "export function greet() { return 'hello'; }", reasoning: "Return added" }],
      },
      next_actions: [],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 1.0,
      flags: [],
    }));

    orchestrator.registerAgent(architect);
    orchestrator.registerAgent(tester);
    orchestrator.registerAgent(debugAgent);
    orchestrator.registerAgent(builder);

    const goal: Goal = {
      id: "goal-2",
      description: "Fix greeting file and verify tests pass",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    const result = await orchestrator.runGoal(goal);
    expect(result.status).toBe("complete");
    expect(testerCalls).toBe(2);
    expect(result.changes.length).toBe(1);

    await cleanupCodebase();
  });

  it("should handle (c) loop detection and escalation to Architect", async () => {
    const codebase = await setupCodebase();
    const config = buildConfig();
    const orchestrator = new Orchestrator(config, codebase);

    const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });
    const builder = new GeminiAgent({ id: "builder-001", role: "builder", model: "gemini-2.5-flash", capabilities: [] });

    // Mock Architect:
    // First call: Decomposes goal into builder write
    // Escalation call: Identifies loop and gracefully shuts down the execution
    let archCalls = 0;
    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      archCalls++;
      if (msg.type === "escalation") {
        return {
          message_id: "arch-escalate-resp",
          in_response_to: msg.message_id,
          trace_id: msg.trace_id,
          status: "complete",
          agent: architect.identity,
          result: { summary: "Loop resolved by Architect" },
          next_actions: [],
          token_usage: { input: 100, output: 100, total: 200 },
          confidence: 1.0,
          flags: [],
        };
      }
      return {
        message_id: "arch-resp-1",
        in_response_to: msg.message_id,
        trace_id: msg.trace_id,
        status: "complete",
        agent: architect.identity,
        result: { summary: "Initial goal decompose" },
        next_actions: [{ invoke: "builder", action: "reusable_action", context: {}, priority: 1, estimated_tokens: 1000 }],
        token_usage: { input: 100, output: 100, total: 200 },
        confidence: 1.0,
        flags: [],
      };
    });

    // Mock Builder:
    // Repeatedly spawns identical invocations of itself doing the same action
    vi.spyOn(builder, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "builder-resp-loop",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: builder.identity,
      result: { summary: "Working on loop" },
      next_actions: [{ invoke: "builder", action: "reusable_action", context: {}, priority: 1, estimated_tokens: 1000 }],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 1.0,
      flags: [],
    }));

    orchestrator.registerAgent(architect);
    orchestrator.registerAgent(builder);

    const goal: Goal = {
      id: "goal-3",
      description: "Trigger loop detection",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    const result = await orchestrator.runGoal(goal);
    expect(result.status).toBe("complete");
    expect(archCalls).toBe(2); // Initial + Escalation resolving loop

    await cleanupCodebase();
  });

  it("should handle (d) budget hit orange warning threshold constraint injection", async () => {
    const codebase = await setupCodebase();
    // Warning threshold = 0.5 (50,000 tokens out of 100,000 total budget)
    const config = buildConfig(0.5, 0.95);
    const orchestrator = new Orchestrator(config, codebase);

    const architect = new GeminiAgent({ id: "architect-001", role: "architect", model: "gemini-2.5-flash", capabilities: [] });
    const builder = new GeminiAgent({ id: "builder-001", role: "builder", model: "gemini-2.5-flash", capabilities: [] });

    vi.spyOn(architect, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => ({
      message_id: "arch-1",
      in_response_to: msg.message_id,
      trace_id: msg.trace_id,
      status: "complete",
      agent: architect.identity,
      result: { summary: "Decomposed" },
      next_actions: [{ invoke: "builder", action: "Build module", context: {}, priority: 1, estimated_tokens: 1000 }],
      token_usage: { input: 100, output: 100, total: 200 },
      confidence: 1.0,
      flags: [],
    }));

    // Mock Builder: consumes 60,000 tokens (immediately triggers 60% budget usage, past warning threshold of 50%)
    let builderMsgReceived: AgentMessage | null = null;
    vi.spyOn(builder, "invoke").mockImplementation(async (msg: AgentMessage): Promise<AgentResponse> => {
      builderMsgReceived = msg;
      return {
        message_id: "builder-resp-1",
        in_response_to: msg.message_id,
        trace_id: msg.trace_id,
        status: "complete",
        agent: builder.identity,
        result: { summary: "Wrote initial code" },
        next_actions: [{ invoke: "builder", action: "Polish module", context: {}, priority: 1, estimated_tokens: 1000 }],
        token_usage: { input: 30000, output: 30000, total: 60000 },
        confidence: 1.0,
        flags: [],
      };
    });

    orchestrator.registerAgent(architect);
    orchestrator.registerAgent(builder);

    const goal: Goal = {
      id: "goal-4",
      description: "Trigger budget warning zone limits",
      acceptance_criteria: [],
      status: "pending",
      budget_allocation: 10000,
      created_by: "user",
      created_at: Date.now(),
    };

    await orchestrator.runGoal(goal);

    // The second invocation received by builder must contain the budget warning injected constraint!
    expect(builderMsgReceived).not.toBeNull();
    expect(builderMsgReceived!.context.constraints).toContain(
      "BUDGET WARNING: Safety threshold exceeded. Tighten scope, avoid starting new work."
    );

    await cleanupCodebase();
  });
});
