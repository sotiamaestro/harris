import type { GeminiModel } from "../types/agents.js";

export interface CostEntry {
  model: GeminiModel;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  total: number;
  by_model: Record<string, number>;
}

const GEMINI_PRICING_USD_PER_MILLION: Record<GeminiModel, { input: number; output: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

export class CostTracker {
  private entries: CostEntry[] = [];

  trackCost(
    model: GeminiModel,
    inputTokens: number,
    outputTokens: number,
    agentId = "default",
  ): CostEntry {
    if (inputTokens < 0 || outputTokens < 0) {
      throw new Error("Token counts cannot be negative.");
    }

    const pricing = GEMINI_PRICING_USD_PER_MILLION[model];
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const entry: CostEntry = {
      model,
      agentId,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };

    this.entries.push(entry);
    return entry;
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, entry) => sum + entry.totalCost, 0);
  }

  getCostByAgent(): Record<string, number> {
    return this.entries.reduce<Record<string, number>>((costs, entry) => {
      costs[entry.agentId] = (costs[entry.agentId] ?? 0) + entry.totalCost;
      return costs;
    }, {});
  }

  getCostBreakdown(): CostBreakdown {
    return this.entries.reduce<CostBreakdown>(
      (breakdown, entry) => {
        breakdown.input_cost += entry.inputCost;
        breakdown.output_cost += entry.outputCost;
        breakdown.total += entry.totalCost;
        breakdown.by_model[entry.model] = (breakdown.by_model[entry.model] ?? 0) + entry.totalCost;
        return breakdown;
      },
      { input_cost: 0, output_cost: 0, total: 0, by_model: {} },
    );
  }

  getEntries(): CostEntry[] {
    return [...this.entries];
  }
}
