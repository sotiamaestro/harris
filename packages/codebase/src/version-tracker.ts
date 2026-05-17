import { createHash } from "node:crypto";

export class VersionTracker {
  private versions: Map<string, string> = new Map(); // path -> hash

  hash(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 12);
  }

  getVersion(path: string): string {
    return this.versions.get(path) ?? "";
  }

  updateVersion(path: string, content: string): string {
    const newHash = this.hash(content);
    this.versions.set(path, newHash);
    return newHash;
  }

  checkConflict(path: string, baseVersion?: string): void {
    const currentVersion = this.getVersion(path);
    if (baseVersion && currentVersion && currentVersion !== baseVersion) {
      throw new Error(
        `CONFLICT: '${path}' has been modified since it was read. Expected version ${baseVersion}, found ${currentVersion}. Re-read the file and rebase your changes.`,
      );
    }
  }

  reset(): void {
    this.versions.clear();
  }
}
