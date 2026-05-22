import { BudgetManager, CostTracker, calculateZone } from "@harris/core";
import { describe, expect, it } from "vitest";

describe("Swarm Budget Management", () => {
  it("should calculate budget zones accurately", () => {
    expect(calculateZone(100, 1000)).toBe("green");
    expect(calculateZone(600, 1000)).toBe("yellow");
    expect(calculateZone(800, 1000)).toBe("orange");
    expect(calculateZone(950, 1000)).toBe("red");
  });

  it("should correctly record and check allocations", () => {
    const manager = new BudgetManager({
      total: 100000,
      warning_threshold: 0.75,
      hard_stop: 0.95,
      per_agent_default: 20000,
      reserve_percentage: 0.1,
    });

    const snapshot = manager.getBudgetSnapshot("agent-1");
    expect(snapshot.total).toBe(100000);
    expect(snapshot.your_allocation).toBe(20000);

    manager.recordUsage("agent-1", 5000);
    const updated = manager.getBudgetSnapshot("agent-1");
    expect(updated.consumed).toBe(5000);
    expect(updated.remaining).toBe(95000);
  });
});

describe("USD Cost Tracking", () => {
  it("calculates Gemini model input and output costs separately", () => {
    const tracker = new CostTracker();

    const entry = tracker.trackCost("gemini-2.5-pro", 1_000_000, 500_000, "architect");

    expect(entry.inputCost).toBe(1.25);
    expect(entry.outputCost).toBe(5);
    expect(entry.totalCost).toBe(6.25);
    expect(tracker.getTotalCost()).toBe(6.25);
  });

  it("attributes costs by agent and model", () => {
    const tracker = new CostTracker();

    tracker.trackCost("gemini-2.5-pro", 1_000_000, 100_000, "architect");
    tracker.trackCost("gemini-2.5-flash", 2_000_000, 1_000_000, "builder");
    tracker.trackCost("gemini-2.5-flash", 1_000_000, 500_000, "builder");

    const byAgent = tracker.getCostByAgent();
    expect(byAgent.architect).toBeCloseTo(2.25);
    expect(byAgent.builder).toBeCloseTo(1.35);

    const breakdown = tracker.getCostBreakdown();
    expect(breakdown.input_cost).toBeCloseTo(1.7);
    expect(breakdown.output_cost).toBeCloseTo(1.9);
    expect(breakdown.total).toBeCloseTo(3.6);
    expect(breakdown.by_model["gemini-2.5-pro"]).toBeCloseTo(2.25);
    expect(breakdown.by_model["gemini-2.5-flash"]).toBeCloseTo(1.35);
  });

  it("rejects negative token counts", () => {
    const tracker = new CostTracker();

    expect(() => tracker.trackCost("gemini-2.5-flash", -1, 0)).toThrow(
      "Token counts cannot be negative.",
    );
  });
});
