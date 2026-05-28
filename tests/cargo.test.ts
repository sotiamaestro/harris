import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectLanguages } from "@harris/codebase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Cargo and Rust detection", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-cargo");

  beforeEach(async () => {
    await mkdir(join(sandboxDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
  });

  it("detects a simple Rust project", async () => {
    await writeFile(join(sandboxDir, "Cargo.toml"), "[package]\nname = \"hello_world\"\nversion = \"0.1.0\"\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "main.rs"), "fn main() {\n    println!(\"Hello, world!\");\n}\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);

    expect(stats.primary).toBe("Rust");
    expect(stats.frameworks).toContain("Rust");
    expect(stats.breakdown.Rust).toMatchObject({
      files: 1,
      lines: 3,
      percentage: 50,
    });
    expect(stats.breakdown.TOML).toMatchObject({
      files: 1,
      lines: 3,
      percentage: 50,
    });
  });

  it("detects a Rust project with multiple files", async () => {
    await writeFile(join(sandboxDir, "Cargo.toml"), "[package]\nname = \"multi_file\"\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "main.rs"), "mod lib;\nfn main() {\n    lib::hello();\n}\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "lib.rs"), "pub fn hello() {\n    println!(\"Hello\");\n}\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);

    expect(stats.primary).toBe("Rust");
    expect(stats.breakdown.Rust).toMatchObject({
      files: 2,
      lines: 7,
    });
  });

  it("correctly handles mixed Rust and other files", async () => {
    await writeFile(join(sandboxDir, "Cargo.toml"), "[package]\nname = \"mixed\"\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "main.rs"), "fn main() {}\n", "utf-8"); // 1 line
    await mkdir(join(sandboxDir, "scripts"), { recursive: true });
    await writeFile(join(sandboxDir, "scripts", "build.sh"), "#!/bin/bash\necho \"Building\"\n", "utf-8"); // 2 lines

    const stats = await detectLanguages(sandboxDir);

    expect(stats.frameworks).toContain("Rust");
    expect(stats.breakdown.Rust).toBeDefined();
    expect(stats.breakdown.Shell).toBeDefined();

    // main.rs (1 line) vs build.sh (2 lines)
    expect(stats.primary).toBe("Shell");
  });

  it("ignores Cargo.lock if it was theoretically considered, but it is not in the list anyway", async () => {
    // Cargo.lock is .lock which is not in LANGUAGE_BY_EXTENSION, so it should be ignored.
    await writeFile(join(sandboxDir, "Cargo.toml"), "[package]\nname = \"lock_test\"\n", "utf-8");
    await writeFile(join(sandboxDir, "Cargo.lock"), "# Some lock content\n", "utf-8");
    await writeFile(join(sandboxDir, "src", "main.rs"), "fn main() {}\n", "utf-8");

    const stats = await detectLanguages(sandboxDir);

    expect(Object.keys(stats.breakdown)).not.toContain("Cargo.lock");
    expect(stats.breakdown.Rust.files).toBe(1);
  });
});
