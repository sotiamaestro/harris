import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_PERSONALITY,
  isNeutralPersonality,
  resolvePersonality,
  type AgentConfig,
  type AgentRole,
} from "@harris/core";
import { buildPersonalitySection, buildSystemPrompt } from "@harris/gemini";
import { createHarris, loadConfig, mergeConfig } from "@harris/orchestrator";
import type { GeminiAgent } from "@harris/gemini";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function agent(role: AgentRole, personality?: AgentConfig["personality"]): AgentConfig {
  return {
    id: `${role}-001`,
    role,
    model: role === "architect" || role === "analyst" ? "gemini-2.5-pro" : "gemini-2.5-flash",
    capabilities: ["testing"],
    ...(personality ? { personality } : {}),
  };
}

describe("resolvePersonality", () => {
  it("defaults every trait to the neutral value", () => {
    expect(resolvePersonality()).toEqual(DEFAULT_PERSONALITY);
    expect(resolvePersonality({})).toEqual(DEFAULT_PERSONALITY);
  });

  it("fills unspecified traits while keeping specified ones", () => {
    expect(resolvePersonality({ strictness: 9 })).toEqual({
      strictness: 9,
      verbosity: 5,
      creativity: 5,
      caution: 5,
    });
  });

  it("clamps out-of-range values into the 1-10 band", () => {
    expect(resolvePersonality({ strictness: 99, caution: -4 })).toMatchObject({
      strictness: 10,
      caution: 1,
    });
  });

  it("rounds fractional values to integers", () => {
    expect(resolvePersonality({ verbosity: 7.6 })).toMatchObject({ verbosity: 8 });
  });

  it("ignores non-numeric or non-finite values instead of throwing", () => {
    const traits = {
      strictness: "high",
      verbosity: Number.NaN,
      creativity: null,
    } as unknown as AgentConfig["personality"];

    expect(resolvePersonality(traits)).toEqual(DEFAULT_PERSONALITY);
  });

  it("detects neutral personalities", () => {
    expect(isNeutralPersonality()).toBe(true);
    expect(isNeutralPersonality({ strictness: 5, verbosity: 5 })).toBe(true);
    expect(isNeutralPersonality({ strictness: 6 })).toBe(false);
  });
});

describe("buildPersonalitySection", () => {
  it("returns nothing when no personality is configured", () => {
    expect(buildPersonalitySection(agent("reviewer"))).toBe("");
  });

  it("returns nothing when every trait is neutral", () => {
    expect(
      buildPersonalitySection(
        agent("reviewer", { strictness: 5, verbosity: 5, creativity: 5, caution: 5 }),
      ),
    ).toBe("");
  });

  it("returns nothing when the configured traits do not apply to the role", () => {
    // strictness only shapes the Reviewer, creativity only the Architect.
    expect(buildPersonalitySection(agent("analyst", { strictness: 10, creativity: 1 }))).toBe("");
  });

  it("renders the trait value alongside its modifier", () => {
    const section = buildPersonalitySection(agent("reviewer", { strictness: 9 }));

    expect(section).toContain("=== PERSONALITY ===");
    expect(section).toContain("strictness (9/10)");
    expect(section).toContain("Reject code for ANY issue, no matter how minor. Zero tolerance.");
  });

  it("renders the low band described in the issue", () => {
    const section = buildPersonalitySection(agent("reviewer", { strictness: 3 }));

    expect(section).toContain("strictness (3/10)");
    expect(section).toContain("Focus only on correctness bugs. Style and minor issues are acceptable.");
  });

  it("reports the clamped value rather than the raw input", () => {
    expect(buildPersonalitySection(agent("reviewer", { strictness: 42 }))).toContain(
      "strictness (10/10)",
    );
  });

  it("applies verbosity to every role", () => {
    const roles: AgentRole[] = [
      "architect",
      "analyst",
      "builder",
      "reviewer",
      "tester",
      "debugger",
      "release",
    ];

    for (const role of roles) {
      expect(buildPersonalitySection(agent(role, { verbosity: 1 }))).toContain("verbosity (1/10)");
    }
  });

  it("scopes creativity to the architect and caution to the builder", () => {
    expect(buildPersonalitySection(agent("architect", { creativity: 10 }))).toContain(
      "creativity (10/10)",
    );
    expect(buildPersonalitySection(agent("builder", { creativity: 10 }))).toBe("");

    expect(buildPersonalitySection(agent("builder", { caution: 10 }))).toContain("caution (10/10)");
    expect(buildPersonalitySection(agent("architect", { caution: 10 }))).toBe("");
  });

  it("renders every applicable trait for a role at once", () => {
    const section = buildPersonalitySection(agent("reviewer", { strictness: 8, verbosity: 2 }));

    expect(section).toContain("strictness (8/10)");
    expect(section).toContain("verbosity (2/10)");
  });

  it("produces different guidance for opposite extremes", () => {
    const strict = buildPersonalitySection(agent("reviewer", { strictness: 10 }));
    const lenient = buildPersonalitySection(agent("reviewer", { strictness: 1 }));

    expect(strict).not.toBe(lenient);
    expect(strict).toContain("Zero tolerance");
    expect(lenient).toContain("Approve unless the code is fundamentally broken");
  });
});

describe("buildSystemPrompt personality injection", () => {
  it("is unchanged when no personality is configured", () => {
    const prompt = buildSystemPrompt(agent("reviewer"), []);

    expect(prompt).not.toContain("=== PERSONALITY ===");
    expect(prompt).toContain("=== ROLE SPECIFICATION ===");
  });

  it("produces a byte-identical prompt for an all-neutral personality", () => {
    const stock = buildSystemPrompt(agent("reviewer"), []);
    const neutral = buildSystemPrompt(
      agent("reviewer", { strictness: 5, verbosity: 5, creativity: 5, caution: 5 }),
      [],
    );

    expect(neutral).toBe(stock);
  });

  it("injects the personality section after the role specification", () => {
    const prompt = buildSystemPrompt(agent("reviewer", { strictness: 9 }), []);

    expect(prompt).toContain("=== PERSONALITY ===");
    expect(prompt.indexOf("=== PERSONALITY ===")).toBeGreaterThan(
      prompt.indexOf("=== ROLE SPECIFICATION ==="),
    );
  });

  it("keeps the role specification intact when a personality is applied", () => {
    const prompt = buildSystemPrompt(agent("builder", { caution: 10 }), []);

    expect(prompt).toContain("=== ROLE SPECIFICATION ===");
    expect(prompt).toContain("Treat every input as hostile");
  });

  it("makes extreme values produce noticeably different prompts", () => {
    const cautious = buildSystemPrompt(agent("builder", { caution: 10 }), []);
    const reckless = buildSystemPrompt(agent("builder", { caution: 1 }), []);

    expect(cautious).not.toBe(reckless);
    expect(cautious).toContain("Guard every boundary");
    expect(reckless).toContain("skip defensive checks");
  });
});

describe("personality configuration", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-personality");

  beforeEach(async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "index.ts"), "export const ok = true;\n", "utf-8");
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
  });

  it("reads per-agent personality traits from .harris.yml", async () => {
    await writeFile(
      join(sandboxDir, ".harris.yml"),
      [
        "agents:",
        "  reviewer:",
        "    personality:",
        "      strictness: 9",
        "      verbosity: 2",
        "  architect:",
        "    personality:",
        "      creativity: 10",
      ].join("\n"),
      "utf-8",
    );

    const config = await loadConfig(sandboxDir);

    expect(config.agents?.reviewer?.personality).toEqual({ strictness: 9, verbosity: 2 });
    expect(config.agents?.architect?.personality).toEqual({ creativity: 10 });
  });

  it("merges personality traits individually instead of replacing the whole object", () => {
    const merged = mergeConfig(
      {
        budget: {
          total: 2_000_000,
          warning_threshold: 0.75,
          hard_stop: 0.95,
          per_agent_default: 200_000,
          reserve_percentage: 0.1,
        },
        convergence: {
          max_iterations_per_task: 3,
          max_total_invocations: 50,
          loop_detection_window: 5,
        },
      },
      { agents: { reviewer: { temperature: 0.1, personality: { strictness: 9, verbosity: 2 } } } },
      { agents: { reviewer: { personality: { verbosity: 8 } } } },
    );

    // The override only changes verbosity: strictness and temperature survive.
    expect(merged.agents?.reviewer?.personality).toEqual({ strictness: 9, verbosity: 8 });
    expect(merged.agents?.reviewer?.temperature).toBe(0.1);
  });

  it("hands the configured personality to the live agent", async () => {
    await writeFile(
      join(sandboxDir, ".harris.yml"),
      ["agents:", "  reviewer:", "    personality:", "      strictness: 10"].join("\n"),
      "utf-8",
    );

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
    });

    const agents = (harris.orchestrator as unknown as { agents: Map<string, GeminiAgent> }).agents;
    const reviewer = agents.get("reviewer-001");
    expect(reviewer).toBeDefined();

    const reviewerConfig = (reviewer as unknown as { config: AgentConfig }).config;
    expect(reviewerConfig.personality).toEqual({ strictness: 10 });
    expect(buildSystemPrompt(reviewerConfig, [])).toContain("Zero tolerance");
  });

  it("leaves agents without configured traits on stock behaviour", async () => {
    await writeFile(
      join(sandboxDir, ".harris.yml"),
      ["agents:", "  reviewer:", "    personality:", "      strictness: 10"].join("\n"),
      "utf-8",
    );

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
    });

    const agents = (harris.orchestrator as unknown as { agents: Map<string, GeminiAgent> }).agents;
    const builderConfig = (agents.get("builder-001") as unknown as { config: AgentConfig }).config;

    expect(builderConfig.personality).toBeUndefined();
    expect(buildSystemPrompt(builderConfig, [])).not.toContain("=== PERSONALITY ===");
  });
});
