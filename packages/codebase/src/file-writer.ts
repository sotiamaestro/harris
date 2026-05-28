import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange } from "@harris/core";

export class FileWriter {
  constructor(private root: string) {}

  async write(
    relativePath: string,
    content: string,
    agentId: string,
    versionTracker: {
      getVersion(path: string): string;
      updateVersion(path: string, content: string): string;
      checkConflict(path: string, baseVersion?: string): void;
    },
    baseVersion?: string,
  ): Promise<FileChange> {
    const oldVersion = versionTracker.getVersion(relativePath);

    // Enforce optimistic lock checking prior to modifications
    versionTracker.checkConflict(relativePath, baseVersion);

    const fullPath = join(this.root, relativePath);
    await writeFile(fullPath, content, "utf-8");
    versionTracker.updateVersion(relativePath, content);

    return {
      file: relativePath,
      action: oldVersion ? "modify" : "create",
      content,
      base_version: oldVersion || undefined,
      reasoning: `Modified by ${agentId}`,
    };
  }
}
