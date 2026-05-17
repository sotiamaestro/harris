import type { AgentRole } from "./messages.js";

export interface Position {
  agent_id: string;
  agent_role: AgentRole;
  stance: string;
  reasoning: string;
  principles_cited: string[];
}

export interface ArchitectRuling {
  decision: string;
  reasoning: string;
  principles_applied: string[];
  dissents_acknowledged: string[];
  ruled_by: string; // architect agent ID
}

export interface Conflict {
  id: string;
  trace_id: string;
  timestamp: number;
  agents_involved: string[];
  context: string;
  positions: Position[];
  ruling?: ArchitectRuling;
}
