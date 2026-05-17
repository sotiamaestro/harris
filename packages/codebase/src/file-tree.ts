import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FileTree } from "@harris/core";

export class FileTreeBuilder {
  constructor(private root: string) {}

  async build(dir = this.root, depth = 0): Promise<FileTree> {
    const name = dir.split("/").pop() ?? dir;
    const entries = await readdir(dir, { withFileTypes: true });
    const children: FileTree[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && depth < 5) {
        children.push(await this.build(fullPath, depth + 1));
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        children.push({
          path: relative(this.root, fullPath),
          name: entry.name,
          type: "file",
          size: stats.size,
          extension: entry.name.split(".").pop(),
        });
      }
    }

    return {
      path: relative(this.root, dir) || ".",
      name,
      type: "directory",
      children,
    };
  }
}
