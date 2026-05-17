import { randomUUID } from "node:crypto";
import type { Position, Conflict, ArchitectRuling } from "../types/decisions.js";

export class ResolutionEngine {
  private activeConflicts: Map<string, Conflict> = new Map();

  createConflict(traceId: string, agentsInvolved: string[], context: string, positions: Position[]): Conflict {
    const conflict: Conflict = {
      id: randomUUID(),
      trace_id: traceId,
      timestamp: Date.now(),
      agents_involved: agentsInvolved,
      context,
      positions,
    };
    this.activeConflicts.set(conflict.id, conflict);
    return conflict;
  }

  applyRuling(conflictId: string, ruling: ArchitectRuling): Conflict {
    const conflict = this.activeConflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict with ID '${conflictId}' not found.`);
    }
    conflict.ruling = ruling;
    return conflict;
  }

  getConflict(conflictId: string): Conflict | undefined {
    return this.activeConflicts.get(conflictId);
  }
}
