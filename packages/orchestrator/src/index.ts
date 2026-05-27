import { Orchestrator, type OrchestratorConfig } from "./orchestrator.js";
import { GeminiAgent } from "@harris/gemini";
import { LocalCodebaseContext } from "@harris/codebase";
import { DEFAULT_AGENT_CONFIGS } from "@harris/core";
import type { AgentRole, Goal, AgentConfig } from "@harris/core";
import { getPlugins } from "./plugins.js";
import type { VisualizerOptions } from "./visualizer.js";
import { loadConfig, mergeConfig, type NormalizedHarrisConfig } from "./config-loader.js";

export { Orchestrator, type OrchestratorConfig } from "./orchestrator.js";
export * from "./agent-pool.js";
export * from "./message-bus.js";
export * from "./lifecycle.js";
export * from "./reporter.js";
export * from "./goal-runner.js";
export * from "./plugins.js";
export * from "./swarm-bridge.js";
export * from "./visualizer.js";
export * from "./config-loader.js";
export * from "./templates.js";
export * from "./integrations/webhooks.js";

export interface HarrisConfig {
  gemini_api_key: string;
  codebase_path: string;
  budget?: Partial<OrchestratorConfig["budget"]>;
  convergence?: Partial<OrchestratorConfig["convergence"]>;
  agents?: NormalizedHarrisConfig["agents"];
  visualizer?: boolean | VisualizerOptions;
}

export async function createHarris(config: HarrisConfig) {
  const fileConfig = await loadConfig(config.codebase_path);
  const codebase = new LocalCodebaseContext(config.codebase_path);
  await codebase.initialize();

  const mergedConfig = mergeConfig(
    {
      budget: {
        total: 2_000_000,
        warning_threshold: 0.75,
        hard_stop: 0.95,
        per_agent_default: 200_000,
        reserve_percentage: 0.10,
      },
      convergence: {
        max_iterations_per_task: 3,
        max_total_invocations: 50,
        loop_detection_window: 5,
      },
    },
    fileConfig,
    {
      budget: config.budget,
      convergence: config.convergence,
      agents: config.agents,
      visualizer: config.visualizer,
    },
  );

  const orchestratorConfig: OrchestratorConfig = {
    budget: {
      total: mergedConfig.budget.total,
      warning_threshold: mergedConfig.budget.warning_threshold,
      hard_stop: mergedConfig.budget.hard_stop,
      per_agent_default: mergedConfig.budget.per_agent_default,
      reserve_percentage: mergedConfig.budget.reserve_percentage,
    },
    convergence: {
      max_iterations_per_task: mergedConfig.convergence.max_iterations_per_task,
      max_total_invocations: mergedConfig.convergence.max_total_invocations,
      loop_detection_window: mergedConfig.convergence.loop_detection_window,
    },
  };

  const orchestrator = new Orchestrator({ ...orchestratorConfig, visualizer: mergedConfig.visualizer }, codebase);
  const agentConfigs = mergeAgentConfigs(mergedConfig.agents);

  const defaultAgentCards: AgentConfig[] = Object.entries(agentConfigs).map(([role, cfg]) => ({
    id: `${role}-001`,
    role: cfg.role,
    model: cfg.model,
    capabilities: cfg.capabilities,
  }));

  const plugins = getPlugins();
  const pluginAgentConfigs: AgentConfig[] = [];
  for (const plugin of plugins) {
    if (plugin.agents) {
      pluginAgentConfigs.push(...plugin.agents);
    }
  }

  const allAgentConfigs = [...defaultAgentCards, ...pluginAgentConfigs];

  for (const [role, cfg] of Object.entries(agentConfigs)) {
    const agent = new GeminiAgent(
      { ...cfg, id: `${role}-001` },
      {
        apiKey: config.gemini_api_key,
        peers: allAgentConfigs.filter((c) => c.id !== `${role}-001`),
      },
    );
    orchestrator.registerAgent(agent);
  }

  for (const agentConfig of pluginAgentConfigs) {
    const agent = new GeminiAgent(
      agentConfig,
      {
        apiKey: config.gemini_api_key,
        peers: allAgentConfigs.filter((c) => c.id !== agentConfig.id),
      },
    );
    orchestrator.registerAgent(agent);
  }

  return {
    run: async (goal: string, acceptance_criteria: string[] = []) => {
      const goalObj: Goal = {
        id: crypto.randomUUID(),
        description: goal,
        acceptance_criteria: acceptance_criteria.map((ac) => ({
          description: ac,
          verifiable: true,
          verified: false,
        })),
        status: "pending",
        budget_allocation: orchestratorConfig.budget.total,
        created_by: "user",
        created_at: Date.now(),
      };

      return orchestrator.runGoal(goalObj);
    },
    orchestrator,
    codebase,
  };
}

function mergeAgentConfigs(overrides: NormalizedHarrisConfig["agents"] = {}) {
  const merged = {} as Record<AgentRole, Omit<AgentConfig, "id">>;

  for (const [role, cfg] of Object.entries(DEFAULT_AGENT_CONFIGS) as Array<[AgentRole, Omit<AgentConfig, "id">]>) {
    merged[role] = {
      ...cfg,
      ...overrides[role],
      role,
      capabilities: cfg.capabilities,
    };
  }

  return merged;
}
