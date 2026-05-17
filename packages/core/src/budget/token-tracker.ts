export class TokenTracker {
  private consumedTotal = 0;
  private agentConsumption: Map<string, number> = new Map();

  recordUsage(agentId: string, tokens: number): void {
    if (tokens < 0) {
      throw new Error("Token consumption cannot be negative.");
    }
    this.consumedTotal += tokens;
    const current = this.agentConsumption.get(agentId) ?? 0;
    this.agentConsumption.set(agentId, current + tokens);
  }

  getConsumedTotal(): number {
    return this.consumedTotal;
  }

  getAgentConsumption(agentId: string): number {
    return this.agentConsumption.get(agentId) ?? 0;
  }

  getPerAgentMap(): Map<string, number> {
    return new Map(this.agentConsumption);
  }
}
