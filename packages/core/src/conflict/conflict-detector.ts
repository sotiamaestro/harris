import type { AgentResponse } from "../types/messages.js";

export class ConflictDetector {
  detectDisagreement(response: AgentResponse): boolean {
    // Disagreements manifest as 'failed' status or reviewer/tester blocking reports
    if (response.agent.role === "reviewer" && response.status === "failed") {
      return true;
    }
    if (response.agent.role === "tester" && response.status === "failed") {
      return true;
    }
    return false;
  }
}
