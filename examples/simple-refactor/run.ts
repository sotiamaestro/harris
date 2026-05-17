import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHarris } from "@harris/orchestrator";

async function main() {
  const codebasePath = "./sample-codebase";

  // Create legacy mockup codebase
  await mkdir(codebasePath, { recursive: true });
  await writeFile(
    join(codebasePath, "auth.ts"),
    `// Legacy User Authentication Module
export function authenticateUser(username, password, callback) {
  setTimeout(() => {
    if (username === "admin" && password === "secret") {
      callback(null, { id: "1", username: "admin", role: "administrator" });
    } else {
      callback(new Error("Invalid credentials"));
    }
  }, 100);
}
`,
    "utf-8",
  );

  console.log("Initialized mock legacy codebase at:", codebasePath);

  const apiKey = process.env.GEMINI_API_KEY || "MOCK_KEY";

  console.log(
    `Starting autonomous swarm execution (using API key: ${
      apiKey === "MOCK_KEY" ? "OFFLINE_MOCK" : "REAL"
    })...`,
  );

  const harris = await createHarris({
    gemini_api_key: apiKey,
    codebase_path: codebasePath,
    budget: { total: 1_000_000 },
  });

  const result = await harris.run(
    "Refactor the user authentication module to use async/await instead of callbacks. Preserve all existing behavior and ensure all tests pass.",
    [
      "All callback-based functions converted to async/await",
      "No changes to public API signatures",
      "All existing tests pass without modification",
      "Error handling preserved or improved",
    ],
  );

  console.log("\n================ Swarm Result ================");
  console.log("Goal Status:", result.status.toUpperCase());
  console.log("Summary:", result.summary);
  console.log("Total Tokens Consumed:", result.token_usage.total);
  console.log("Token consumption by Agent:", result.token_usage.by_agent);
  console.log("Changes made:", result.changes);
  console.log("Audit log size:", result.audit_trail.length);
}

main().catch(console.error);
