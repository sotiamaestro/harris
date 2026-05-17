import type { AgentRole, MessageStatus, Flag } from "./messages.js";
import type { BudgetSnapshot } from "./budget.js";

export interface AuditEntry {
  timestamp: number;
  trace_id: string;
  message_id: string;
  agent_id: string;
  agent_role: AgentRole;
  action: string;
  input_summary: string;
  output_summary: string;
  token_usage: { input: number; output: number; total: number };
  budget_snapshot: BudgetSnapshot;
  duration_ms: number;
  status: MessageStatus;
  flags: Flag[];
  files_read: string[];
  files_modified: string[];
  peers_invoked: string[];
}

export interface DecisionRecord {
  id: string;
  trace_id: string;
  timestamp: number;
  agents_involved: string[];
  context: string;
  positions: Array<{
    agent_id: string;
    agent_role: AgentRole;
    stance: string;
    reasoning: string;
    principles_cited: string[];
  }>;
  ruling: {
    decision: string;
    reasoning: string;
    principles_applied: string[];
    dissents_acknowledged: string[];
    ruled_by: string; // architect agent ID
  };
}
