import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHarris } from "@harris/orchestrator";

async function main() {
  const exampleDir = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(exampleDir, "sample-codebase");
  const codebasePath = await mkdtemp(join(tmpdir(), "harris-bug-fix-"));
  await cp(fixturePath, codebasePath, { recursive: true });
  const apiKey = process.env.GEMINI_API_KEY || "MOCK_KEY";

  console.log("Bug-fix fixture:", fixturePath);
  console.log("Working copy:", codebasePath);
  console.log(
    `Starting Harris bug-fix run (mode: ${
      apiKey === "MOCK_KEY" ? "OFFLINE_MOCK" : "REAL_GEMINI"
    })...`,
  );

  const harris = await createHarris({
    gemini_api_key: apiKey,
    codebase_path: codebasePath,
    budget: { total: 1_000_000 },
  });

  const result = await harris.run(
    "Find and fix the bug causing the tests in utils.test.ts to fail.",
    [
      "Analyst reads utils.test.ts and utils.ts",
      "Tester identifies the failing behavior",
      "Debugger traces the root cause to the off-by-one slice",
      "Builder fixes the helper without changing the test expectation",
      "Tester verifies the tests pass",
    ],
  );

  console.log("\n================ Bug-Fix Result ================");
  console.log("Goal Status:", result.status.toUpperCase());
  console.log("Summary:", result.summary);
  console.log("Total Tokens Consumed:", result.token_usage.total);
  console.log("Changes made:", result.changes);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
