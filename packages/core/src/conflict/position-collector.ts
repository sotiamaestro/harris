import type { AgentResponse } from "../types/messages.js";
import type { Position } from "../types/decisions.js";

export class PositionCollector {
  collectPosition(response: AgentResponse): Position {
    const role = response.agent.role;
    const agentId = response.agent.id;

    let stance = "unspecified";
    let reasoning = "No reasoning provided in the response.";
    let principles: string[] = [];

    if (response.result?.decision) {
      stance = response.result.decision.choice;
      reasoning = response.result.decision.reasoning;
      principles = response.result.decision.principles_applied;
    } else if (response.result?.summary) {
      stance = response.result.summary;
      reasoning = response.result.analysis ?? response.result.summary;
    }

    return {
      agent_id: agentId,
      agent_role: role,
      stance,
      reasoning,
      principles_cited: principles,
    };
  }
}
