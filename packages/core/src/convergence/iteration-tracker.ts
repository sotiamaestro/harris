export class IterationTracker {
  private iterations: Map<string, number> = new Map(); // taskKey -> count

  increment(taskKey: string): number {
    const current = this.getIteration(taskKey);
    const nextVal = current + 1;
    this.iterations.set(taskKey, nextVal);
    return nextVal;
  }

  getIteration(taskKey: string): number {
    return this.iterations.get(taskKey) ?? 1;
  }

  isExceeded(taskKey: string, maxIterations: number): boolean {
    const current = this.getIteration(taskKey);
    return current > maxIterations;
  }

  reset(taskKey: string): void {
    this.iterations.delete(taskKey);
  }
}
