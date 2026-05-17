import { describe, it, expect } from "vitest";
import { BudgetManager, calculateZone } from "@harris/core";

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
