import type { AgentRole, AgentConfig, Peer } from "@harris/core";
import { GeminiAgent } from "@harris/gemini";

export class AgentPool {
  private pool: Map<string, Peer> = new Map();
  private configs: Map<string, AgentConfig> = new Map();

  registerAgent(config: AgentConfig, options?: { apiKey?: string }): Peer {
    const agent = new GeminiAgent(config, {
      apiKey: options?.apiKey,
      peers: Array.from(this.configs.values()),
    });

    this.pool.set(config.id, agent);
    this.configs.set(config.id, config);

    // Dynamic peer propagation across all active swarm agents
    for (const activeAgent of this.pool.values()) {
      if (activeAgent instanceof GeminiAgent) {
        activeAgent.setPeers(Array.from(this.configs.values()));
      }
    }

    return agent;
  }

  getAgent(agentId: string): Peer | undefined {
    return this.pool.get(agentId);
  }

  getAgentByRole(role: AgentRole): Peer | undefined {
    return Array.from(this.pool.values()).find((a) => a.identity.role === role);
  }

  getConfigs(): AgentConfig[] {
    return Array.from(this.configs.values());
  }

  clear(): void {
    this.pool.clear();
    this.configs.clear();
  }
}
