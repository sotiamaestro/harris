import type { AgentIdentity, AgentRole, AgentMessage, AgentResponse } from "./messages.js";

export type GeminiModel = "gemini-2.5-pro" | "gemini-2.5-flash";

export interface AgentConfig {
  id: string;
  role: AgentRole;
  model: GeminiModel;
  capabilities: string[];
  temperature?: number;
  max_output_tokens?: number;
}

export interface AgentCard {
  id: string;
  role: AgentRole;
  model: GeminiModel;
  capabilities: string[];
  cost_tier: "high" | "medium" | "low";
  description: string;
}

export interface Peer {
  readonly identity: AgentIdentity;
  invoke(message: AgentMessage): Promise<AgentResponse>;
}

export const DEFAULT_AGENT_CONFIGS: Record<AgentRole, Omit<AgentConfig, "id">> = {
  architect: {
    role: "architect",
    model: "gemini-2.5-pro",
    capabilities: ["goal_decomposition", "architectural_decisions", "conflict_arbitration", "quality_assessment"],
    temperature: 0.3,
  },
  analyst: {
    role: "analyst",
    model: "gemini-2.5-pro",
    capabilities: ["codebase_analysis", "impact_assessment", "spec_production", "dependency_mapping", "pattern_identification"],
    temperature: 0.2,
  },
  builder: {
    role: "builder",
    model: "gemini-2.5-flash",
    capabilities: ["code_implementation", "feature_development", "bug_fixes", "scoped_refactoring"],
    temperature: 0.2,
  },
  reviewer: {
    role: "reviewer",
    model: "gemini-2.5-flash",
    capabilities: ["correctness_review", "integration_review", "simplicity_review", "approval_rejection"],
    temperature: 0.2,
  },
  tester: {
    role: "tester",
    model: "gemini-2.5-flash",
    capabilities: ["test_design", "test_execution", "failure_triage", "coverage_analysis"],
    temperature: 0.2,
  },
  debugger: {
    role: "debugger",
    model: "gemini-2.5-flash",
    capabilities: ["root_cause_analysis", "regression_analysis", "diagnostic_reports"],
    temperature: 0.2,
  },
  release: {
    role: "release",
    model: "gemini-2.5-flash",
    capabilities: ["preflight_checks", "changelog_generation", "commit_preparation", "post_ship_reporting"],
    temperature: 0.2,
  },
};
