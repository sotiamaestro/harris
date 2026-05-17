import type { AgentConfig } from "@harris/core";

export function buildPeerRegistry(configs: AgentConfig[]): string {
  if (configs.length === 0) {
    return "No peers registered.";
  }
  return configs
    .map(
      (c) =>
        `- AGENT_ID: ${c.id}\n  ROLE: ${c.role}\n  CAPABILITIES: ${c.capabilities.join(", ")}`,
    )
    .join("\n\n");
}
