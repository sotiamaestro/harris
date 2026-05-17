import { describe, it, expect } from "vitest";
import { LoopDetector, IterationTracker, CircuitBreaker } from "@harris/core";

describe("Swarm Convergence Controls", () => {
  it("should detect repeated message action loops", () => {
    const detector = new LoopDetector();
    const history: any[] = [
      { from: { id: "a1" }, to: { id: "a2" }, action: "fix" },
      { from: { id: "a1" }, to: { id: "a2" }, action: "fix" },
      { from: { id: "a1" }, to: { id: "a2" }, action: "fix" },
    ];
    const incoming: any = { from: { id: "a1" }, to: { id: "a2" }, action: "fix" };
    expect(detector.detectLoop(history, incoming)).toBe(true);
  });

  it("should detect ping-pong bounces", () => {
    const detector = new LoopDetector();
    const history: any[] = [
      { from: { id: "builder", role: "builder" }, to: { id: "reviewer", role: "reviewer" }, action: "review" },
      { from: { id: "reviewer", role: "reviewer" }, to: { id: "builder", role: "builder" }, action: "fix" },
      { from: { id: "builder", role: "builder" }, to: { id: "reviewer", role: "reviewer" }, action: "review" },
      { from: { id: "reviewer", role: "reviewer" }, to: { id: "builder", role: "builder" }, action: "fix" },
    ];
    const incoming: any = { from: { id: "builder", role: "builder" }, to: { id: "reviewer", role: "reviewer" }, action: "review" };
    expect(detector.detectLoop(history, incoming)).toBe(true);
  });

  it("should increment and track iterations per task action", () => {
    const tracker = new IterationTracker();
    expect(tracker.getIteration("task-1")).toBe(1);
    tracker.increment("task-1");
    expect(tracker.getIteration("task-1")).toBe(2);
  });

  it("should handle circuit breaker consecutive failure strike limits", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.isBreached("task-2")).toBe(false);
    breaker.recordStrike("task-2");
    breaker.recordStrike("task-2");
    expect(breaker.isBreached("task-2")).toBe(false);
    breaker.recordStrike("task-2");
    expect(breaker.isBreached("task-2")).toBe(true);
  });
});
