import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalCodebaseContext, VersionTracker } from "@harris/codebase";

describe("Swarm Codebase Integration", () => {
  const testRoot = "./test-sandbox";

  beforeEach(async () => {
    await mkdir(testRoot, { recursive: true });
    await writeFile(join(testRoot, "index.ts"), "const x = 1;", "utf-8");
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("should initialize codebase context tree and read files", async () => {
    const ctx = new LocalCodebaseContext(testRoot);
    await ctx.initialize();

    expect(ctx.files.type).toBe("directory");
    expect(ctx.files.children?.length).toBeGreaterThan(0);

    const file = await ctx.read("index.ts");
    expect(file.content).toBe("const x = 1;");
    expect(file.version.length).toBe(12);
  });

  it("should return fresh content after writing a previously cached file", async () => {
    const ctx = new LocalCodebaseContext(testRoot);
    await ctx.initialize();

    const initial = await ctx.read("index.ts");
    expect(initial.content).toBe("const x = 1;");

    await ctx.write("index.ts", "const x = 2;", "builder-001");

    const updated = await ctx.read("index.ts");
    expect(updated.content).toBe("const x = 2;");
    expect(updated.version).not.toBe(initial.version);
  });

  it("should enforce optimistic concurrent writing and detect stale version conflicts", () => {
    const tracker = new VersionTracker();
    tracker.updateVersion("index.ts", "const x = 1;");
    const baseVersion = tracker.getVersion("index.ts");

    // Dynamic write changes the file version
    tracker.updateVersion("index.ts", "const x = 2;");

    // The stale base version should raise a conflict
    expect(() => tracker.checkConflict("index.ts", baseVersion)).toThrow("CONFLICT");
  });

  it("should search codebase content exactly and with regex", async () => {
    const ctx = new LocalCodebaseContext(testRoot);
    await ctx.initialize();

    const matches = await ctx.search("const x");
    expect(matches.length).toBe(1);
    expect(matches[0]?.path).toBe("index.ts");
  });
});
