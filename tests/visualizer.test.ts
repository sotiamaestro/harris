import type { AgentMessage, AgentResponse, Goal, TokenBudget } from "@harris/core";
import { SwarmVisualizer } from "@harris/orchestrator";
import { describe, expect, it, vi } from "vitest";

describe("SwarmVisualizer", () => {
  it("renders pending, active, and completed agent states with budget stats", () => {
    const budget = createBudget();
    const visualizer = new SwarmVisualizer({ enabled: false });

    visualizer.startGoal(createGoal(), budget, ["architect", "builder", "reviewer"]);

    let frame = stripAnsi(visualizer.renderFrame());
    expect(frame).toContain("Goal: Refactor auth to async/await");
    expect(frame).toContain("Budget:");
    expect(frame).toContain("0% (0 / 2,000,000)");
    expect(frame).toContain("○ Architect");
    expect(frame).toContain("○ Builder");

    visualizer.reportTaskStarted(createMessage("builder", "implement_change"), budget);
    frame = stripAnsi(visualizer.renderFrame());
    expect(frame).toContain("⟳ Builder");
    expect(frame).toContain("implement_change");

    budget.consumed = 1_040_000;
    visualizer.reportResponseReceived(createResponse("builder", "complete", 7186), budget, 2300);
    frame = stripAnsi(visualizer.renderFrame());
    expect(frame).toContain("52% (1,040,000 / 2,000,000)");
    expect(frame).toContain("✓ Builder");
    expect(frame).toContain("7,186 tokens");
    expect(frame).toContain("2.3s");
    expect(frame).toContain("○ Reviewer");
  });

  it("updates in place using ANSI cursor positioning after first render", () => {
    const writes: string[] = [];
    const stream = { write: vi.fn((chunk: string) => writes.push(chunk)) } as unknown as NodeJS.WriteStream;
    const visualizer = new SwarmVisualizer({ enabled: true, stream });
    const budget = createBudget();

    visualizer.startGoal(createGoal(), budget, ["architect"]);
    visualizer.reportTaskStarted(createMessage("architect", "decompose_goal"), budget);
    visualizer.finish("partial", budget);

    expect(stream.write).toHaveBeenCalled();
    const output = writes.join("");
    const esc = String.fromCharCode(27);
    expect(output).toContain(`${esc}[`);
    expect(output).toContain(`A${esc}[0J`);
  });
});

function createGoal(): Goal {
  return {
    id: "goal-visualizer",
    description: "Refactor auth to async/await",
    acceptance_criteria: [],
    status: "pending",
    budget_allocation: 2_000_000,
    created_by: "user",
    created_at: Date.now(),
  };
}

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  let output = "";
  for (let index = 0; index < value.length; index++) {
    if (value[index] === esc && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index++;
      }
      continue;
    }
    output += value[index];
  }
  return output;
}

function createBudget(): TokenBudget {
  return {
    total: 2_000_000,
    consumed: 0,
    per_agent: new Map(),
    allocations: new Map(),
    warning_threshold: 0.75,
    hard_stop: 0.95,
  };
}

function createMessage(role: "architect" | "builder", action: string): AgentMessage {
  return {
    message_id: `${role}-message`,
    type: "task",
    from: { id: "orchestrator", role: "architect" },
    to: { id: `${role}-001`, role },
    trace_id: "trace-visualizer",
    action,
    context: {
      goal: "Refactor auth to async/await",
      relevant_files: [],
      constraints: [],
      prior_decisions: [],
      iteration: 1,
      max_iterations: 3,
    },
    budget: {
      total: 2_000_000,
      consumed: 0,
      remaining: 2_000_000,
      your_allocation: 100_000,
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

function createResponse(role: "builder", status: AgentResponse["status"], tokens: number): AgentResponse {
  return {
    message_id: `${role}-response`,
    in_response_to: `${role}-message`,
    trace_id: "trace-visualizer",
    status,
    agent: { id: `${role}-001`, role },
    result: { summary: "done" },
    next_actions: [],
    token_usage: { input: tokens / 2, output: tokens / 2, total: tokens },
    confidence: 1,
    flags: [],
  };
}
