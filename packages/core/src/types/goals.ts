import type { FileChange } from "./messages.js";
import type { AuditEntry } from "./audit.js";

export type GoalStatus = "pending" | "active" | "blocked" | "complete" | "failed" | "partial";

export interface AcceptanceCriteria {
  description: string;
  verifiable: boolean;
  verified: boolean;
  verified_by?: string;
}

export interface Goal {
  id: string;
  description: string;
  acceptance_criteria: AcceptanceCriteria[];
  parent_goal_id?: string;
  sub_goals?: Goal[];
  status: GoalStatus;
  assigned_to?: string;
  budget_allocation: number;
  created_by: string; // agent ID or "user"
  created_at: number;
}

export interface GoalResult {
  goal_id: string;
  status: GoalStatus;
  summary: string;
  changes: FileChange[];
  sub_results?: GoalResult[];
  token_usage: { total: number; by_agent: Record<string, number> };
  duration_ms: number;
  audit_trail: AuditEntry[];
}
