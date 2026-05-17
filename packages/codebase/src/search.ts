import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SearchOptions, SearchResult } from "@harris/core";

export class CodeSearcher {
  constructor(private root: string) {}

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const files = await this.getAllFiles(this.root, options?.file_pattern);

    for (const filePath of files) {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const relPath = relative(this.root, filePath);

      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i] ?? "";
        const match =
          options?.type === "regex"
            ? new RegExp(query).test(lineContent)
            : lineContent.includes(query);

        if (match) {
          results.push({
            path: relPath,
            line: i + 1,
            content: lineContent,
            context: options?.include_context
              ? {
                  before: lines.slice(Math.max(0, i - 3), i),
                  after: lines.slice(i + 1, i + 4),
                }
              : undefined,
          });
        }
      }

      if (options?.max_results && results.length >= options.max_results) {
        break;
      }
    }

    return results;
  }

  private async getAllFiles(dir: string, pattern?: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...(await this.getAllFiles(fullPath, pattern)));
      } else if (entry.isFile()) {
        if (!pattern || new RegExp(pattern.replace(/\*/g, ".*")).test(entry.name)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }
}
