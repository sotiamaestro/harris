import type { Orchestrator } from "./orchestrator.js";
import type { CodebaseContext, Goal, GoalResult } from "@harris/core";

export interface CriteriaValidationReport {
  ran: number;
  passed: string[];
  failed: string[];
  errors: Array<{ criterion: string; error: string }>;
}

export class GoalRunner {
  constructor(private orchestrator: Orchestrator) {}

  async run(goal: Goal): Promise<GoalResult> {
    return this.orchestrator.runGoal(goal);
  }
}

export async function runAcceptanceCriteriaValidators(
  goal: Goal,
  codebase: CodebaseContext,
): Promise<CriteriaValidationReport> {
  const report: CriteriaValidationReport = {
    ran: 0,
    passed: [],
    failed: [],
    errors: [],
  };

  for (const criterion of goal.acceptance_criteria) {
    if (!criterion.validator) {
      continue;
    }

    report.ran++;
    try {
      const passed = await criterion.validator(codebase);
      criterion.verified = passed;
      criterion.verified_by = "custom-validator";

      if (passed) {
        report.passed.push(criterion.description);
      } else {
        report.failed.push(criterion.description);
      }
    } catch (error) {
      criterion.verified = false;
      criterion.verified_by = "custom-validator";
      report.errors.push({
        criterion: criterion.description,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
