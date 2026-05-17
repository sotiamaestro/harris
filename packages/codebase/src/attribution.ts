import type { AgentRole, AgentAttribution } from "@harris/core";

export class AgentAttributor {
  private attributions: Map<string, AgentAttribution[]> = new Map();

  recordModification(
    path: string,
    agentId: string,
    agentRole: AgentRole,
    summary: string,
  ): AgentAttribution {
    const attr: AgentAttribution = {
      path,
      agent_id: agentId,
      agent_role: agentRole,
      timestamp: Date.now(),
      change_summary: summary,
    };

    const existing = this.attributions.get(path) ?? [];
    existing.push(attr);
    this.attributions.set(path, existing);

    return attr;
  }

  getAttributions(path: string): AgentAttribution[] {
    return this.attributions.get(path) ?? [];
  }

  getLastAttribution(path: string): AgentAttribution | undefined {
    const list = this.attributions.get(path);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  clear(): void {
    this.attributions.clear();
  }
}
