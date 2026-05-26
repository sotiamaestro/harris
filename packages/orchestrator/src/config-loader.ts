import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig, AgentRole } from "@harris/core";
import { parseDocument } from "yaml";
import type { OrchestratorConfig } from "./orchestrator.js";
import type { VisualizerOptions } from "./visualizer.js";

export interface HarrisFileConfig {
  budget?: Partial<OrchestratorConfig["budget"]>;
  convergence?: Partial<OrchestratorConfig["convergence"]> & {
    max_iterations?: number;
    max_invocations?: number;
  };
  agents?: Partial<Record<AgentRole, Partial<Omit<AgentConfig, "id" | "role" | "capabilities">>>>;
  visualizer?: boolean | VisualizerOptions;
}

export interface NormalizedHarrisConfig {
  budget?: Partial<OrchestratorConfig["budget"]>;
  convergence?: Partial<OrchestratorConfig["convergence"]>;
  agents?: Partial<Record<AgentRole, Partial<Omit<AgentConfig, "id" | "role" | "capabilities">>>>;
  visualizer?: boolean | VisualizerOptions;
}

export interface ResolvedHarrisConfig extends NormalizedHarrisConfig {
  budget: OrchestratorConfig["budget"];
  convergence: OrchestratorConfig["convergence"];
}

export async function loadConfig(codebasePath: string): Promise<NormalizedHarrisConfig> {
  const configPath = join(codebasePath, ".harris.yml");
  let raw: string;

  try {
    raw = await readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const document = parseDocument(raw);
  if (document.errors.length > 0) {
    const message = document.errors.map((error) => error.message).join("; ");
    throw new Error(`Invalid .harris.yml: ${message}`);
  }

  const parsed = document.toJS() as HarrisFileConfig | null;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return normalizeConfig(parsed);
}

export function normalizeConfig(config: HarrisFileConfig): NormalizedHarrisConfig {
  return {
    budget: config.budget,
    convergence: normalizeConvergence(config.convergence),
    agents: config.agents,
    visualizer: config.visualizer,
  };
}

export function mergeConfig(
  defaults: Pick<ResolvedHarrisConfig, "budget" | "convergence">,
  fileConfig: NormalizedHarrisConfig,
  overrideConfig: NormalizedHarrisConfig,
): ResolvedHarrisConfig {
  return {
    budget: {
      ...defaults.budget,
      ...fileConfig.budget,
      ...overrideConfig.budget,
    },
    convergence: {
      ...defaults.convergence,
      ...fileConfig.convergence,
      ...overrideConfig.convergence,
    },
    agents: {
      ...fileConfig.agents,
      ...overrideConfig.agents,
    },
    visualizer: overrideConfig.visualizer ?? fileConfig.visualizer,
  };
}

function normalizeConvergence(
  convergence: HarrisFileConfig["convergence"],
): Partial<OrchestratorConfig["convergence"]> | undefined {
  if (!convergence) {
    return undefined;
  }

  const { max_iterations, max_invocations, ...runtimeConvergence } = convergence;
  const normalized: Partial<OrchestratorConfig["convergence"]> = {
    ...runtimeConvergence,
  };

  if (max_iterations !== undefined) {
    normalized.max_iterations_per_task = max_iterations;
  }
  if (max_invocations !== undefined) {
    normalized.max_total_invocations = max_invocations;
  }

  return normalized;
}
