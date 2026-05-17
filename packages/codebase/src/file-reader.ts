import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileContent } from "@harris/core";

export class FileReader {
  private cache: Map<string, FileContent> = new Map();

  constructor(private root: string) {}

  async read(relativePath: string, versionTracker: { getVersion(path: string): string }): Promise<FileContent> {
    const fullPath = join(this.root, relativePath);
    const content = await readFile(fullPath, "utf-8");
    const currentVersion = versionTracker.getVersion(relativePath);

    const fileContent: FileContent = {
      path: relativePath,
      content,
      version: currentVersion,
    };

    this.cache.set(relativePath, fileContent);
    return fileContent;
  }

  getCached(relativePath: string): FileContent | undefined {
    return this.cache.get(relativePath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
