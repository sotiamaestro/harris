import type { AgentConfig, AgentMessage, AgentResponse } from "@harris/core";

export interface HarrisPlugin {
  name: string;
  version: string;
  agents?: AgentConfig[];
  prompts?: Record<string, () => string>;
  hooks?: {
    beforeInvoke?: (msg: AgentMessage) => AgentMessage;
    afterInvoke?: (res: AgentResponse) => AgentResponse;
    onError?: (error: Error, msg: AgentMessage) => void;
  };
}

export interface PluginInfo {
  name: string;
  version: string;
}

const GLOBAL_PLUGINS_KEY = Symbol.for("harris.plugins");
const globalRegistry = globalThis as Record<string | symbol, unknown>;

if (!globalRegistry[GLOBAL_PLUGINS_KEY]) {
  globalRegistry[GLOBAL_PLUGINS_KEY] = [];
}

export function registerPlugin(plugin: HarrisPlugin): void {
  const plugins = globalRegistry[GLOBAL_PLUGINS_KEY] as HarrisPlugin[];
  if (plugins.some((p) => p.name === plugin.name)) {
    throw new Error(`Plugin with name "${plugin.name}" is already registered`);
  }
  plugins.push(plugin);
}

export function listPlugins(): PluginInfo[] {
  const plugins = globalRegistry[GLOBAL_PLUGINS_KEY] as HarrisPlugin[];
  return plugins.map((p) => ({
    name: p.name,
    version: p.version,
  }));
}

export function getPlugins(): HarrisPlugin[] {
  return (globalRegistry[GLOBAL_PLUGINS_KEY] ?? []) as HarrisPlugin[];
}
