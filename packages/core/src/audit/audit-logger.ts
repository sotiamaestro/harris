import { join } from "node:path";
import { mkdir, appendFile } from "node:fs/promises";
import type { AuditEntry } from "../types/audit.js";

export class AuditLogger {
  private logFilePath: string | null = null;
  private entries: AuditEntry[] = [];

  constructor(codebaseRoot?: string) {
    if (codebaseRoot) {
      this.logFilePath = join(codebaseRoot, ".harris", "audit.jsonl");
    }
  }

  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    if (!this.logFilePath) return;

    try {
      const dirPath = join(this.logFilePath, "..");
      await mkdir(dirPath, { recursive: true });
      await appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf-8");
    } catch (error) {
      console.error("Failed to write audit entry to file:", error);
    }
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }
}
