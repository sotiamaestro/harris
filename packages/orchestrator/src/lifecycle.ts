import type { AgentMessage, AgentResponse } from "@harris/core";
import { LoopDetector, IterationTracker, CircuitBreaker } from "@harris/core";

export class SwarmLifecycleManager {
  private loopDetector = new LoopDetector();
  private iterationTracker = new IterationTracker();
  private circuitBreaker = new CircuitBreaker();

  checkTaskPreflight(history: AgentMessage[], incoming: AgentMessage): void {
    const taskKey = `${incoming.trace_id}:${incoming.action}`;

    // Loop detection
    if (this.loopDetector.detectLoop(history, incoming)) {
      throw new Error(
        `CRITICAL: Infinite execution loop detected for task action '${incoming.action}'. Swarm halting.`,
      );
    }

    // Iteration limit checks
    const currentIt = this.iterationTracker.getIteration(taskKey);
    if (currentIt > incoming.context.max_iterations) {
      throw new Error(
        `CRITICAL: Iteration limit exceeded for task action '${incoming.action}'. Iterations: ${currentIt}, Limit: ${incoming.context.max_iterations}.`,
      );
    }
  }

  recordTaskStep(incoming: AgentMessage): void {
    const taskKey = `${incoming.trace_id}:${incoming.action}`;
    this.iterationTracker.increment(taskKey);
  }

  recordResponse(response: AgentResponse, action: string): void {
    const taskKey = `${response.trace_id}:${action}`;
    if (response.status === "failed") {
      this.circuitBreaker.recordStrike(taskKey);
      if (this.circuitBreaker.isBreached(taskKey)) {
        throw new Error(
          `CRITICAL: Task action '${action}' breached circuit breaker after 3 consecutive failures. Escalating.`,
        );
      }
    } else {
      this.circuitBreaker.reset(taskKey);
    }
  }

  getIteration(traceId: string, action: string): number {
    return this.iterationTracker.getIteration(`${traceId}:${action}`);
  }
}
