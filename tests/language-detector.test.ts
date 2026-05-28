import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectLanguages } from "@harris/codebase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("detectLanguages", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-language-detector");

  beforeEach(async () => {
    await mkdir(join(sandboxDir, "src"), { recursive: true });
    await mkdir(join(sandboxDir, "scripts"), { recursive: true });
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
  });

  it("identifies the primary language by line count and returns a 100% breakdown", async () => {
    await writeFile(join(sandboxDir, "src", "app.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "util.ts"), "export const ok = true;\nexport const value = 1;\n", "utf-8");
    await writeFile(join(sandboxDir, "scripts", "tool.py"), "print('one')\nprint('two')\n", "utf-8");
    await writeFile(join(sandboxDir, "README.md"), "# Project\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);
    const percentageTotal = Object.values(stats.breakdown).reduce((sum, entry) => sum + entry.percentage, 0);

    expect(stats.primary).toBe("TypeScript");
    expect(stats.breakdown.TypeScript).toMatchObject({ files: 2, lines: 5 });
    expect(stats.breakdown.Python).toMatchObject({ files: 1, lines: 2 });
    expect(stats.breakdown.Markdown).toMatchObject({ files: 1, lines: 1 });
    expect(percentageTotal).toBe(100);
  });

  it("detects frameworks from supported config files", async () => {
    await writeFile(join(sandboxDir, "package.json"), "{\"name\":\"app\"}\n", "utf-8");
    await writeFile(join(sandboxDir, "Cargo.toml"), "[package]\nname = \"app\"\n", "utf-8");
    await writeFile(join(sandboxDir, "go.mod"), "module example.com/app\n", "utf-8");
    await writeFile(join(sandboxDir, "pom.xml"), "<project></project>\n", "utf-8");
    await writeFile(join(sandboxDir, "requirements.txt"), "pytest\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);

    expect(stats.frameworks).toEqual(["Go", "Java", "Node", "Python", "Rust"]);
  });

  it("excludes binary files from language counts", async () => {
    await writeFile(join(sandboxDir, "src", "app.ts"), "const ok = true;\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "generated.ts"), Buffer.from([0, 1, 2, 3, 4]));
    await writeFile(join(sandboxDir, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));

    const stats = await detectLanguages(sandboxDir);

    expect(stats.primary).toBe("TypeScript");
    expect(stats.breakdown.TypeScript).toMatchObject({ files: 1, lines: 1, percentage: 100 });
    expect(Object.keys(stats.breakdown)).toEqual(["TypeScript"]);
  });

  it("returns Unknown and empty breakdown when no language files are found", async () => {
    await writeFile(join(sandboxDir, "notes.unknown"), "hello\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);

    expect(stats).toEqual({
      primary: "Unknown",
      breakdown: {},
      frameworks: [],
    });
  });
});
