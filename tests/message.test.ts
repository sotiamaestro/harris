import { describe, it, expect } from "vitest";
import { createMessage, validateMessage } from "@harris/core";

describe("Swarm Message System", () => {
  it("should correctly build and validate tasks", () => {
    const msg = createMessage(
      "task",
      { id: "test-agent", role: "architect" },
      { id: "peer-1", role: "builder" },
      "test_action",
      {
        goal: "Test high-level objective",
        relevant_files: ["src/index.ts"],
        constraints: [],
        prior_decisions: [],
        iteration: 1,
        max_iterations: 3,
      },
      {
        total: 1000000,
        consumed: 100000,
        remaining: 900000,
        your_allocation: 100000,
        warning_threshold: 0.8,
        hard_stop: 0.95,
      },
    );

    expect(msg.from.id).toBe("test-agent");
    expect(msg.action).toBe("test_action");
    expect(msg.context.iteration).toBe(1);

    expect(validateMessage(msg)).toBe(true);
  });
});
