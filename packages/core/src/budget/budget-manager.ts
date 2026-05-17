import { calculateZone, type BudgetConfig, type BudgetSnapshot, type TokenBudget } from "../types/budget.js";
import { TokenTracker } from "./token-tracker.js";

export class BudgetManager {
  private total: number;
  private warningThreshold: number;
  private hardStop: number;
  private perAgentDefault: number;
  private reservePercentage: number;

  private tracker = new TokenTracker();
  private allocations: Map<string, number> = new Map();

  constructor(config: BudgetConfig) {
    this.total = config.total;
    this.warningThreshold = config.warning_threshold ?? 0.75;
    this.hardStop = config.hard_stop ?? 0.95;
    this.perAgentDefault = config.per_agent_default ?? 200000;
    this.reservePercentage = config.reserve_percentage ?? 0.10;
  }

  allocate(agentId: string, tokens: number): void {
    if (tokens < 0) {
      throw new Error("Allocation tokens cannot be negative.");
    }
    this.allocations.set(agentId, tokens);
  }

  getAllocation(agentId: string): number {
    return this.allocations.get(agentId) ?? this.perAgentDefault;
  }

  recordUsage(agentId: string, tokens: number): void {
    this.tracker.recordUsage(agentId, tokens);
  }

  getBudgetSnapshot(agentId: string): BudgetSnapshot {
    const consumed = this.tracker.getConsumedTotal();
    return {
      total: this.total,
      consumed,
      remaining: this.total - consumed,
      your_allocation: this.getAllocation(agentId),
      zone: calculateZone(consumed, this.total),
      warning_threshold: this.warningThreshold,
      hard_stop: this.hardStop,
    };
  }

  isHardStopTriggered(): boolean {
    const ratio = this.tracker.getConsumedTotal() / this.total;
    return ratio >= this.hardStop;
  }

  isWarningTriggered(): boolean {
    const ratio = this.tracker.getConsumedTotal() / this.total;
    return ratio >= this.warningThreshold;
  }

  getTokenBudget(): TokenBudget {
    return {
      total: this.total,
      consumed: this.tracker.getConsumedTotal(),
      per_agent: this.tracker.getPerAgentMap(),
      allocations: new Map(this.allocations),
      warning_threshold: this.warningThreshold,
      hard_stop: this.hardStop,
    };
  }
}
