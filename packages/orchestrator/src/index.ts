import { Orchestrator, type OrchestratorConfig } from "./orchestrator.js";
import { GeminiAgent } from "@harris/gemini";
import { LocalCodebaseContext } from "@harris/codebase";
import { DEFAULT_AGENT_CONFIGS } from "@harris/core";
import type { Goal, AgentConfig } from "@harris/core";
import { getPlugins } from "./plugins.js";

export { Orchestrator, type OrchestratorConfig } from "./orchestrator.js";
export * from "./agent-pool.js";
export * from "./message-bus.js";
export * from "./lifecycle.js";
export * from "./reporter.js";
export * from "./goal-runner.js";
export * from "./plugins.js";

export interface HarrisConfig {
  gemini_api_key: string;
  codebase_path: string;
  budget?: Partial<OrchestratorConfig["budget"]>;
  convergence?: Partial<OrchestratorConfig["convergence"]>;
}

export async function createHarris(config: HarrisConfig) {
  const codebase = new LocalCodebaseContext(config.codebase_path);
  await codebase.initialize();

  const orchestratorConfig: OrchestratorConfig = {
    budget: {
      total: config.budget?.total ?? 2_000_000,
      warning_threshold: config.budget?.warning_threshold ?? 0.75,
      hard_stop: config.budget?.hard_stop ?? 0.95,
      per_agent_default: config.budget?.per_agent_default ?? 200_000,
      reserve_percentage: config.budget?.reserve_percentage ?? 0.10,
    },
    convergence: {
      max_iterations_per_task: config.convergence?.max_iterations_per_task ?? 3,
      max_total_invocations: config.convergence?.max_total_invocations ?? 50,
      loop_detection_window: config.convergence?.loop_detection_window ?? 5,
    },
  };

  const orchestrator = new Orchestrator(orchestratorConfig, codebase);

  const defaultAgentCards: AgentConfig[] = Object.entries(DEFAULT_AGENT_CONFIGS).map(([role, cfg]) => ({
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

  for (const [role, cfg] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
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
