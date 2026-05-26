import { getTemplate, templates } from "@harris/orchestrator";
import { describe, expect, it } from "vitest";

describe("goal templates", () => {
  it("produces valid Goal objects from built-in templates", () => {
    const goal = getTemplate("refactor", {
      target: "auth middleware",
      pattern: "async/await",
    });

    expect(goal.id).toBeTruthy();
    expect(goal.description).toBe("Refactor auth middleware to use async/await");
    expect(goal.status).toBe("pending");
    expect(goal.budget_allocation).toBe(0);
    expect(goal.created_by).toBe("template");
    expect(goal.created_at).toBeGreaterThan(0);
    expect(goal.acceptance_criteria).toEqual([
      { description: "Behavior preserved", verifiable: true, verified: false },
      { description: "Tests pass", verifiable: true, verified: false },
      { description: "No new dependencies", verifiable: true, verified: false },
    ]);
  });

  it("substitutes variables in each built-in template", () => {
    expect(getTemplate("add-tests", { target: "payment service" }).description).toBe(
      "Add comprehensive tests for payment service",
    );
    expect(getTemplate("fix-bug", { target: "login flow", symptom: "redirect loops" }).description).toBe(
      "Find and fix the bug in login flow causing redirect loops",
    );
    expect(getTemplate("add-feature", { target: "dashboard", feature: "saved filters" }).description).toBe(
      "Implement saved filters in dashboard",
    );
  });

  it("throws a descriptive error for unknown templates", () => {
    expect(() => getTemplate("unknown-template", {})).toThrow(
      /Unknown goal template "unknown-template"/,
    );
  });

  it("throws a descriptive error when a required variable is missing", () => {
    expect(() => getTemplate("refactor", { target: "auth" })).toThrow(
      /Missing value for template variable "pattern"/,
    );
  });

  it("allows templates to be customized before use", () => {
    templates["custom-docs"] = {
      goal: "Document {target}",
      criteria: ["{target} has examples", "Review complete"],
      budget_allocation: 12345,
      created_by: "test-suite",
    };

    const goal = getTemplate("custom-docs", { target: "plugin API" });

    expect(goal.description).toBe("Document plugin API");
    expect(goal.budget_allocation).toBe(12345);
    expect(goal.created_by).toBe("test-suite");
    expect(goal.acceptance_criteria.map((criterion) => criterion.description)).toEqual([
      "plugin API has examples",
      "Review complete",
    ]);
  });
});
