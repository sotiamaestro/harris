import type { AcceptanceCriteria, Goal } from "@harris/core";

export interface GoalTemplate {
  goal: string;
  criteria: string[];
  budget_allocation?: number;
  created_by?: string;
}

export const templates: Record<string, GoalTemplate> = {
  refactor: {
    goal: "Refactor {target} to use {pattern}",
    criteria: ["Behavior preserved", "Tests pass", "No new dependencies"],
  },
  "add-tests": {
    goal: "Add comprehensive tests for {target}",
    criteria: ["80%+ coverage", "Edge cases covered", "Tests are independent"],
  },
  "fix-bug": {
    goal: "Find and fix the bug in {target} causing {symptom}",
    criteria: ["Bug root cause identified", "Fix applied", "Regression test added"],
  },
  "add-feature": {
    goal: "Implement {feature} in {target}",
    criteria: ["Feature works per spec", "Tests written", "No regressions"],
  },
};

export function getTemplate(name: string, vars: Record<string, string>): Goal {
  const template = templates[name];
  if (!template) {
    throw new Error(`Unknown goal template "${name}". Available templates: ${Object.keys(templates).join(", ")}`);
  }

  return {
    id: crypto.randomUUID(),
    description: substitute(template.goal, vars),
    acceptance_criteria: template.criteria.map((criterion) => createAcceptanceCriteria(substitute(criterion, vars))),
    status: "pending",
    budget_allocation: template.budget_allocation ?? 0,
    created_by: template.created_by ?? "template",
    created_at: Date.now(),
  };
}

function createAcceptanceCriteria(description: string): AcceptanceCriteria {
  return {
    description,
    verifiable: true,
    verified: false,
  };
}

function substitute(value: string, vars: Record<string, string>): string {
  return value.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const replacement = vars[key];
    if (replacement === undefined) {
      throw new Error(`Missing value for template variable "${key}".`);
    }
    return replacement;
  });
}
