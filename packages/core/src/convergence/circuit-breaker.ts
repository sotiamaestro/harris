export class CircuitBreaker {
  private strikes: Map<string, number> = new Map(); // taskKey -> count
  private maxStrikes = 3;

  recordStrike(taskKey: string): number {
    const current = this.strikes.get(taskKey) ?? 0;
    const nextVal = current + 1;
    this.strikes.set(taskKey, nextVal);
    return nextVal;
  }

  getStrikes(taskKey: string): number {
    return this.strikes.get(taskKey) ?? 0;
  }

  isBreached(taskKey: string): boolean {
    return this.getStrikes(taskKey) >= this.maxStrikes;
  }

  reset(taskKey: string): void {
    this.strikes.delete(taskKey);
  }
}
