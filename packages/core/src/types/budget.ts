export type BudgetZone = "green" | "yellow" | "orange" | "red";

export interface TokenBudget {
  total: number;
  consumed: number;
  per_agent: Map<string, number>; // agent_id -> tokens consumed
  allocations: Map<string, number>; // agent_id -> tokens allocated for current task
  warning_threshold: number; // 0.75
  hard_stop: number; // 0.95
}

export interface BudgetSnapshot {
  total: number;
  consumed: number;
  remaining: number;
  your_allocation: number;
  zone: BudgetZone;
  warning_threshold: number;
  hard_stop: number;
}

export interface BudgetConfig {
  total: number;
  warning_threshold?: number; // default 0.75
  hard_stop?: number; // default 0.95
  per_agent_default?: number; // default allocation per task
  reserve_percentage?: number; // default 0.10
}

export function calculateZone(consumed: number, total: number): BudgetZone {
  const ratio = consumed / total;
  if (ratio < 0.50) return "green";
  if (ratio < 0.75) return "yellow";
  if (ratio < 0.90) return "orange";
  return "red";
}

export function createSnapshot(budget: TokenBudget, agentId: string): BudgetSnapshot {
  return {
    total: budget.total,
    consumed: budget.consumed,
    remaining: budget.total - budget.consumed,
    your_allocation: budget.allocations.get(agentId) ?? 0,
    zone: calculateZone(budget.consumed, budget.total),
    warning_threshold: budget.warning_threshold,
    hard_stop: budget.hard_stop,
  };
}
