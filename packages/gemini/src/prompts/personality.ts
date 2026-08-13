import {
  NEUTRAL_TRAIT_VALUE,
  PERSONALITY_TRAIT_NAMES,
  resolvePersonality,
  type AgentConfig,
  type AgentRole,
  type PersonalityTraitName,
  type PersonalityTraits,
} from "@harris/core";

type Band = "very_low" | "low" | "high" | "very_high";

/**
 * Which roles each trait is meaningful for. A trait set on a role it does not
 * apply to is ignored, so a strict Analyst stays a stock Analyst.
 */
const TRAIT_ROLES: Record<PersonalityTraitName, "all" | readonly AgentRole[]> = {
  strictness: ["reviewer"],
  verbosity: "all",
  creativity: ["architect"],
  caution: ["builder"],
};

const TRAIT_MODIFIERS: Record<PersonalityTraitName, Record<Band, string>> = {
  strictness: {
    very_low:
      "Approve unless the code is fundamentally broken. Only defects that break production justify rejection.",
    low: "Focus only on correctness bugs. Style and minor issues are acceptable.",
    high: "Raise important-severity issues alongside blocking ones. When correctness is uncertain, request changes rather than approving.",
    very_high: "Reject code for ANY issue, no matter how minor. Zero tolerance.",
  },
  verbosity: {
    very_low: "Answer in the fewest words possible. State conclusions only; omit reasoning unless asked.",
    low: "Keep responses brief. Summarise your reasoning in one or two sentences.",
    high: "Explain your reasoning explicitly and include the context behind each decision.",
    very_high:
      "Produce exhaustive responses. Document every consideration, alternative and trade-off you evaluated, and why you discarded the ones you did.",
  },
  creativity: {
    very_low:
      "Use the most conventional decomposition available. Never introduce a novel pattern where a standard one exists.",
    low: "Prefer well-established patterns. Deviate from convention only when the conventional approach clearly fails.",
    high: "Consider non-obvious decompositions and propose alternatives whenever they materially simplify the design.",
    very_high:
      "Actively seek novel decompositions. Challenge the conventional structure and propose the most inventive design that still works.",
  },
  caution: {
    very_low:
      "Write the most direct implementation that satisfies the spec. Assume inputs are valid and skip defensive checks.",
    low: "Favour straightforward code. Add defensive checks only where failure is likely.",
    high: "Validate inputs and handle error paths explicitly, even when failure seems unlikely.",
    very_high:
      "Treat every input as hostile. Guard every boundary, assert your invariants, and handle every failure mode explicitly.",
  },
};

function bandFor(value: number): Band | null {
  if (value <= 2) return "very_low";
  if (value <= 4) return "low";
  if (value === NEUTRAL_TRAIT_VALUE) return null;
  if (value <= 7) return "high";
  return "very_high";
}

function appliesTo(trait: PersonalityTraitName, role: AgentRole): boolean {
  const roles = TRAIT_ROLES[trait];
  return roles === "all" || roles.includes(role);
}

/**
 * Renders the behavioural modifiers for an agent's personality traits.
 *
 * Returns an empty string when the agent has no personality configured, when
 * every configured trait is neutral, or when no configured trait applies to
 * the agent's role. In all of those cases the system prompt is byte-for-byte
 * identical to the one produced before personalities existed.
 */
export function buildPersonalitySection(config: Pick<AgentConfig, "role" | "personality">): string {
  if (!config.personality) {
    return "";
  }

  const resolved: PersonalityTraits = resolvePersonality(config.personality);
  const lines: string[] = [];

  for (const trait of PERSONALITY_TRAIT_NAMES) {
    if (!appliesTo(trait, config.role)) {
      continue;
    }
    const value = resolved[trait];
    const band = bandFor(value);
    if (!band) {
      continue;
    }
    lines.push(`- ${trait} (${value}/10): ${TRAIT_MODIFIERS[trait][band]}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return [
    "=== PERSONALITY ===",
    "",
    "Your behaviour is tuned by the following traits, scored 1-10 where 5 is neutral.",
    "Apply them as modifiers on top of your role specification. They adjust how you",
    "work; they never override your role's responsibilities or the core protocol.",
    "",
    ...lines,
  ].join("\n");
}
