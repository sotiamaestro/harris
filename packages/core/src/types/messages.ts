import type { BudgetSnapshot } from "./budget.js";

export type MessageType =
  | "task"
  | "response"
  | "feedback"
  | "conflict"
  | "escalation"
  | "query"
  | "broadcast"
  | "budget_warning";

export type MessageStatus = "complete" | "partial" | "failed" | "needs_peer" | "needs_escalation";

export type Priority = 0 | 1 | 2 | 3; // 0 = critical, 3 = low

export type Flag =
  | "budget_warning"
  | "needs_review"
  | "blocking_issue"
  | "architectural_impact"
  | "loop_detected"
  | "convergence_risk";

export interface AgentIdentity {
  id: string;
  role: AgentRole;
}

export type AgentRole =
  | "architect"
  | "analyst"
  | "builder"
  | "reviewer"
  | "tester"
  | "debugger"
  | "release";

export interface TaskContext {
  goal: string;
  relevant_files: string[];
  constraints: string[];
  prior_decisions: string[];
  iteration: number;
  max_iterations: number;
  spec?: string;
  acceptance_criteria?: string[];
  code_context?: Array<{ path: string; content: string; last_modified_by?: string }>;
}

export interface FileChange {
  file: string;
  action: "create" | "modify" | "delete";
  content: string;
  base_version?: string; // hash of file when agent read it
  reasoning: string;
}

export interface ReviewFeedback {
  severity: "blocking" | "important" | "minor";
  file: string;
  location: string;
  issue: string;
  reasoning: string;
  suggestion: string;
}

export interface TestFailure {
  test_name: string;
  expected: string;
  actual: string;
  file: string;
  analysis: string;
}

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  failures: TestFailure[];
  coverage_summary: string;
}

export interface Diagnosis {
  symptom: string;
  root_cause: string;
  location: string;
  mechanism: string;
  fix_guidance: string;
  risk_assessment: string;
  prevention: string;
}

export interface Decision {
  choice: string;
  reasoning: string;
  principles_applied: string[];
  alternatives_considered: string[];
  tradeoffs: string;
  reversible: boolean;
}

export interface NextAction {
  invoke: AgentRole;
  action: string;
  context: Partial<TaskContext>;
  priority: Priority;
  estimated_tokens: number;
}

export interface AgentMessage<T = unknown> {
  message_id: string;
  type: MessageType;
  from: AgentIdentity;
  to: AgentIdentity | "*";
  trace_id: string;
  parent_message_id?: string;

  action: string;
  context: TaskContext;
  payload?: T;

  budget: BudgetSnapshot;

  metadata: {
    timestamp: number;
    priority: Priority;
    estimated_tokens?: number;
    iteration: number;
    max_iterations: number;
  };
}

export interface AgentResponse {
  message_id: string;
  in_response_to: string;
  trace_id: string;
  status: MessageStatus;
  agent: AgentIdentity;

  result: {
    summary: string;
    changes?: FileChange[];
    analysis?: string;
    decision?: Decision;
    feedback?: ReviewFeedback[];
    test_results?: TestResults;
    diagnosis?: Diagnosis;
  };

  next_actions: NextAction[];

  token_usage: {
    input: number;
    output: number;
    total: number;
  };

  confidence: number; // 0.0 - 1.0
  flags: Flag[];
}
