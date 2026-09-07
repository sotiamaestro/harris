import type { AgentIdentity, AgentRole, AgentMessage, AgentResponse } from "./messages.js";

export type GeminiModel = "gemini-2.5-pro" | "gemini-2.5-flash";

/**
 * Behavioural dials applied on top of an agent's role specification.
 *
 * Every trait is an integer on a 1-10 scale where `5` is neutral, meaning
 * "behave exactly as the role specification says". Values below 5 dial the
 * behaviour down, values above 5 dial it up.
 */
export interface PersonalityTraits {
  /** How many issues make the Reviewer reject a change. */
  strictness: number;
  /** How detailed every agent's responses are. */
  verbosity: number;
  /** How novel the Architect's decomposition approach is. */
  creativity: number;
  /** How defensive the Builder's code style is. */
  caution: number;
}

export type PersonalityTraitName = keyof PersonalityTraits;

export const PERSONALITY_TRAIT_NAMES: readonly PersonalityTraitName[] = [
  "strictness",
  "verbosity",
  "creativity",
  "caution",
];

/** Neutral value for every trait: reproduces the stock role behaviour. */
export const NEUTRAL_TRAIT_VALUE = 5;

export const MIN_TRAIT_VALUE = 1;
export const MAX_TRAIT_VALUE = 10;

export const DEFAULT_PERSONALITY: PersonalityTraits = {
  strictness: NEUTRAL_TRAIT_VALUE,
  verbosity: NEUTRAL_TRAIT_VALUE,
  creativity: NEUTRAL_TRAIT_VALUE,
  caution: NEUTRAL_TRAIT_VALUE,
};

/**
 * Fills in missing traits with the neutral default and coerces every value to
 * an integer inside the 1-10 range. Values that are not finite numbers (a YAML
 * typo, `null`, a string, ...) fall back to the neutral default rather than
 * throwing, so a malformed `.harris.yml` degrades to stock behaviour.
 */
export function resolvePersonality(traits?: Partial<PersonalityTraits>): PersonalityTraits {
  const resolved = { ...DEFAULT_PERSONALITY };
  if (!traits) {
    return resolved;
  }

  for (const name of PERSONALITY_TRAIT_NAMES) {
    const value = traits[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    resolved[name] = Math.min(MAX_TRAIT_VALUE, Math.max(MIN_TRAIT_VALUE, Math.round(value)));
  }

  return resolved;
}

/** True when every trait sits at the neutral value, i.e. stock role behaviour. */
export function isNeutralPersonality(traits?: Partial<PersonalityTraits>): boolean {
  const resolved = resolvePersonality(traits);
  return PERSONALITY_TRAIT_NAMES.every((name) => resolved[name] === NEUTRAL_TRAIT_VALUE);
}

export interface AgentConfig {
  id: string;
  role: AgentRole;
  model: GeminiModel;
  capabilities: string[];
  temperature?: number;
  max_output_tokens?: number;
  /**
   * Optional per-agent behavioural modifiers. Omitting this (or setting every
   * trait to {@link NEUTRAL_TRAIT_VALUE}) preserves the stock role behaviour.
   */
  personality?: Partial<PersonalityTraits>;
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
