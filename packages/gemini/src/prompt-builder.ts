import type { AgentConfig } from "@harris/core";
import { CORE_PROTOCOL } from "./prompts/core-protocol.js";
import { buildPeerRegistry } from "./prompts/peer-registry.js";
import { ARCHITECT_PROMPT } from "./prompts/architect.js";
import { ANALYST_PROMPT } from "./prompts/analyst.js";
import { BUILDER_PROMPT } from "./prompts/builder.js";
import { REVIEWER_PROMPT } from "./prompts/reviewer.js";
import { TESTER_PROMPT } from "./prompts/tester.js";
import { DEBUGGER_PROMPT } from "./prompts/debugger.js";
import { RELEASE_PROMPT } from "./prompts/release.js";

const ROLE_PROMPTS = {
  architect: ARCHITECT_PROMPT,
  analyst: ANALYST_PROMPT,
  builder: BUILDER_PROMPT,
  reviewer: REVIEWER_PROMPT,
  tester: TESTER_PROMPT,
  debugger: DEBUGGER_PROMPT,
  release: RELEASE_PROMPT,
};

export function buildSystemPrompt(
  config: AgentConfig,
  peers: AgentConfig[],
  yourAllocation = 200000,
): string {
  const peerRegistry = buildPeerRegistry(peers);

  let prompt = CORE_PROTOCOL.replace("{{agent_id}}", config.id)
    .replace("{{role}}", config.role)
    .replace("{{model}}", config.model)
    .replace("{{capabilities}}", config.capabilities.join(", "))
    .replace("{{peer_registry}}", peerRegistry)
    .replace("{{your_allocation}}", yourAllocation.toString());

  const rolePrompt = ROLE_PROMPTS[config.role];
  if (rolePrompt) {
    prompt += `\n\n=== ROLE SPECIFICATION ===\n\n${rolePrompt}`;
  }

  return prompt;
}
