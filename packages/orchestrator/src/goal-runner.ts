import type { Orchestrator } from "./orchestrator.js";
import type { Goal, GoalResult } from "@harris/core";

export class GoalRunner {
  constructor(private orchestrator: Orchestrator) {}

  async run(goal: Goal): Promise<GoalResult> {
    return this.orchestrator.runGoal(goal);
  }
}
