import type { FileDiff } from "@harris/core";

export class DiffEngine {
  private diffs: FileDiff[] = [];

  recordDiff(path: string, before: string, after: string, agentId: string): FileDiff {
    const diff: FileDiff = {
      path,
      before,
      after,
      agent_id: agentId,
      timestamp: Date.now(),
    };
    this.diffs.push(diff);
    return diff;
  }

  getDiffs(since?: string): FileDiff[] {
    if (!since) return [...this.diffs];
    const sinceTime = Number.parseInt(since, 10);
    if (Number.isNaN(sinceTime)) return [...this.diffs];
    return this.diffs.filter(d => d.timestamp > sinceTime);
  }

  clearDiffs(): void {
    this.diffs = [];
  }
}
