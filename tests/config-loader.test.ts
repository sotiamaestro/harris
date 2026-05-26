import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHarris, loadConfig, mergeConfig } from "@harris/orchestrator";
import type { GeminiAgent } from "@harris/gemini";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type OrchestratorInternals = {
  config: {
    budget: {
      total: number;
      warning_threshold: number;
      hard_stop: number;
      per_agent_default: number;
      reserve_percentage: number;
    };
    convergence: {
      max_iterations_per_task: number;
      max_total_invocations: number;
      loop_detection_window: number;
    };
  };
  agents: Map<string, GeminiAgent>;
};

describe(".harris.yml config loader", () => {
  const sandboxDir = join(process.cwd(), "test-sandbox-config-loader");

  beforeEach(async () => {
    await mkdir(sandboxDir, { recursive: true });
    await writeFile(join(sandboxDir, "index.ts"), "export const ok = true;\n", "utf-8");
  });

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true });
  });

  it("parses valid YAML config and normalizes convergence aliases", async () => {
    await writeFile(
      join(sandboxDir, ".harris.yml"),
      [
        "budget:",
        "  total: 2000000",
        "  warning_threshold: 0.75",
        "convergence:",
        "  max_iterations: 3",
        "  max_invocations: 50",
        "agents:",
        "  architect:",
        "    model: gemini-2.5-pro",
        "    temperature: 0.3",
        "  builder:",
        "    model: gemini-2.5-flash",
      ].join("\n"),
      "utf-8",
    );

    const config = await loadConfig(sandboxDir);

    expect(config.budget?.total).toBe(2_000_000);
    expect(config.budget?.warning_threshold).toBe(0.75);
    expect(config.convergence?.max_iterations_per_task).toBe(3);
    expect(config.convergence?.max_total_invocations).toBe(50);
    expect(config.agents?.architect?.model).toBe("gemini-2.5-pro");
    expect(config.agents?.architect?.temperature).toBe(0.3);
  });

  it("returns empty config when .harris.yml is missing", async () => {
    await expect(loadConfig(sandboxDir)).resolves.toEqual({});
  });

  it("throws a descriptive error for invalid YAML", async () => {
    await writeFile(join(sandboxDir, ".harris.yml"), "budget:\n  total: [unterminated\n", "utf-8");

    await expect(loadConfig(sandboxDir)).rejects.toThrow(/Invalid \.harris\.yml/);
  });

  it("merges partial configs with defaults and lets explicit overrides win", () => {
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
      {
        budget: { total: 1_000_000 },
        convergence: { max_iterations_per_task: 4 },
        agents: { builder: { temperature: 0.1 } },
      },
      {
        budget: { warning_threshold: 0.8 },
        convergence: { max_total_invocations: 25 },
        agents: { builder: { temperature: 0.4 } },
      },
    );

    expect(merged.budget).toEqual({
      total: 1_000_000,
      warning_threshold: 0.8,
      hard_stop: 0.95,
      per_agent_default: 200_000,
      reserve_percentage: 0.1,
    });
    expect(merged.convergence).toEqual({
      max_iterations_per_task: 4,
      max_total_invocations: 25,
      loop_detection_window: 5,
    });
    expect(merged.agents?.builder?.temperature).toBe(0.4);
  });

  it("applies .harris.yml in createHarris while explicit config overrides the file", async () => {
    await writeFile(
      join(sandboxDir, ".harris.yml"),
      [
        "budget:",
        "  total: 123456",
        "  warning_threshold: 0.6",
        "convergence:",
        "  max_iterations: 7",
        "agents:",
        "  builder:",
        "    temperature: 0.9",
      ].join("\n"),
      "utf-8",
    );

    const harris = await createHarris({
      gemini_api_key: "MOCK_KEY",
      codebase_path: sandboxDir,
      budget: { total: 999_999 },
      convergence: { max_total_invocations: 12 },
      agents: { builder: { temperature: 0.2 } },
    });

    const orchestrator = harris.orchestrator as unknown as OrchestratorInternals;
    expect(orchestrator.config.budget.total).toBe(999_999);
    expect(orchestrator.config.budget.warning_threshold).toBe(0.6);
    expect(orchestrator.config.convergence.max_iterations_per_task).toBe(7);
    expect(orchestrator.config.convergence.max_total_invocations).toBe(12);

    const builder = orchestrator.agents.get("builder-001");
    expect(builder).toBeDefined();
    expect((builder as unknown as { config: { temperature?: number } }).config.temperature).toBe(0.2);
  });
});
