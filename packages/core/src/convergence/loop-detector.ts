import type { AgentMessage } from "../types/messages.js";

export class LoopDetector {
  private windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  detectLoop(history: AgentMessage[], incoming: AgentMessage): boolean {
    const currentTrace = history.filter(m => m.trace_id === incoming.trace_id);
    const window = [...currentTrace, incoming].slice(-this.windowSize);

    // Pattern 1: Same target role + same action repeated 3+ times
    const matchedActions = window.filter(
      m =>
        m.action === incoming.action &&
        (typeof m.to === "string" ? m.to : m.to.role) ===
          (typeof incoming.to === "string" ? incoming.to : incoming.to.role),
    );
    if (matchedActions.length >= 3) {
      return true;
    }

    // Pattern 2: Bounce pattern (A -> B -> A -> B -> A)
    if (currentTrace.length >= 4) {
      const lastFour = [...currentTrace.slice(-3), incoming];
      const roles = lastFour.map(m => {
        const fromRole = m.from.role;
        const toRole = typeof m.to === "string" ? m.to : m.to.role;
        return `${fromRole}->${toRole}`;
      });

      if (roles[0] === roles[2] && roles[1] === roles[3]) {
        if (roles[0]?.includes("builder") || roles[0]?.includes("reviewer")) {
          return true;
        }
      }
    }

    return false;
  }
}
