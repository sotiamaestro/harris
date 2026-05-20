import type {
  AgentMessage,
  AgentResponse,
  AgentRole,
  Goal,
  GoalResult,
  TokenBudget,
  AuditEntry,
  FileChange,
  AgentConfig,
  CodebaseContext,
} from "@harris/core";
import { createMessage, calculateZone, createSnapshot } from "@harris/core";
import type { GeminiAgent } from "@harris/gemini";
import { SwarmLifecycleManager } from "./lifecycle.js";
import { SwarmReporter } from "./reporter.js";
import { getPlugins } from "./plugins.js";

export interface OrchestratorConfig {
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
}

export class Orchestrator {
  private agents: Map<string, GeminiAgent> = new Map();
  private budget: TokenBudget;
  private auditLog: AuditEntry[] = [];
  private invocationCount = 0;
  private messageHistory: AgentMessage[] = [];
  private lifecycle = new SwarmLifecycleManager();
  private reporter = new SwarmReporter();
  private accumulatedChanges: FileChange[] = [];
  private lastCompletedResponse: AgentResponse | null = null;

  constructor(
    private config: OrchestratorConfig,
    private codebase: CodebaseContext,
  ) {
    this.budget = {
      total: config.budget.total,
      consumed: 0,
      per_agent: new Map(),
      allocations: new Map(),
      warning_threshold: config.budget.warning_threshold,
      hard_stop: config.budget.hard_stop,
    };
  }

  registerAgent(agent: GeminiAgent): void {
    this.agents.set(agent.identity.id, agent);
  }

  async runGoal(goal: Goal): Promise<GoalResult> {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();
    this.accumulatedChanges = [];
    this.lastCompletedResponse = null;

    const architect = this.findAgent("architect");
    if (!architect) {
      throw new Error("No architect agent registered");
    }

    const files = this.codebase.files?.children
      ? this.codebase.files.children.map((f) => f.path)
      : [];

    const initialMessage = createMessage(
      "task",
      { id: "orchestrator", role: "architect" as AgentRole },
      architect.identity,
      "decompose_goal",
      {
        goal: goal.description,
        relevant_files: files,
        constraints: [],
        prior_decisions: [],
        iteration: 1,
        max_iterations: this.config.convergence.max_iterations_per_task,
        acceptance_criteria: goal.acceptance_criteria.map((ac) => ac.description),
        code_context: await this.gatherContext(files),
      },
      createSnapshot(this.budget, architect.identity.id),
      { trace_id: traceId, priority: 0 },
    );

    const finalResult = await this.processMessage(initialMessage);

    return {
      goal_id: goal.id,
      status: finalResult?.status === "complete" ? "complete" : "partial",
      summary: (this.lastCompletedResponse as AgentResponse | null)?.result?.summary ?? finalResult?.result?.summary ?? "Goal processing ended",
      changes: this.collectAllChanges(),
      token_usage: {
        total: this.budget.consumed,
        by_agent: Object.fromEntries(this.budget.per_agent),
      },
      duration_ms: Date.now() - startTime,
      audit_trail: this.auditLog,
    };
  }

  private async processMessage(message: AgentMessage): Promise<AgentResponse | null> {
    const zone = calculateZone(this.budget.consumed, this.budget.total);
    if (zone === "red" && this.budget.consumed / this.budget.total >= this.budget.hard_stop) {
      return this.gracefulShutdown(message.trace_id);
    }

    if (this.invocationCount >= this.config.convergence.max_total_invocations) {
      return this.gracefulShutdown(message.trace_id);
    }

    try {
      this.lifecycle.checkTaskPreflight(this.messageHistory, message);
    } catch {
      return this.handleLoop(message);
    }

    const targetId = typeof message.to === "string" ? message.to : message.to.id;
    const agent = this.agents.get(targetId) ?? (message.to === "*" ? undefined : this.findAgent(message.to));
    if (!agent) {
      console.error(`No agent found for target: ${JSON.stringify(message.to)}`);
      return null;
    }

    message.budget = createSnapshot(this.budget, agent.identity.id);

    this.invocationCount++;
    this.messageHistory.push(message);
    const startTime = Date.now();

    this.reporter.reportTaskStarted(message);

    let response: AgentResponse;
    try {
      response = await this.invokeAgent(agent, message);
    } catch (error) {
      this.reporter.reportError(error as Error);
      return null;
    }

    this.recordUsage(agent.identity.id, response.token_usage.total);
    this.logAudit(message, response, startTime);
    this.reporter.reportResponseReceived(response);

    if (response.status === "complete" || response.status === "partial") {
      this.lastCompletedResponse = response;
    }

    if (agent.identity.role !== "builder") {
      if (response.result?.changes?.length) {
        console.warn(`WARNING: Stripping file changes from non-builder role '${agent.identity.role}':`, response.result.changes);
        response.result.changes = [];
      }
    }

    if (response.result?.changes?.length) {
      for (const change of response.result.changes) {
        await this.applyChange(change, agent.identity.id);
      }
    }

    if (response.status === "needs_peer") {
      if (response.next_actions?.length) {
        for (const action of response.next_actions) {
          const targetAgent = this.findAgent(action.invoke);
          if (!targetAgent) {
            continue;
          }

          const currentZone = calculateZone(this.budget.consumed, this.budget.total);
          const ratio = this.budget.consumed / this.budget.total;
          const originalConstraints = action.context.constraints ?? message.context.constraints ?? [];
          const finalConstraints = [...originalConstraints];
          if (currentZone === "orange" || currentZone === "red" || ratio >= this.budget.warning_threshold) {
            finalConstraints.push("BUDGET WARNING: Safety threshold exceeded. Tighten scope, avoid starting new work.");
          }

          const nextMessage = createMessage(
            "task",
            agent.identity,
            targetAgent.identity,
            action.action,
            {
              goal: message.context.goal,
              relevant_files: action.context.relevant_files ?? message.context.relevant_files,
              constraints: finalConstraints,
              prior_decisions: [
                ...message.context.prior_decisions,
                ...(response.result?.decision ? [response.result.decision.choice] : []),
              ],
              iteration: action.context.iteration ?? 1,
              max_iterations:
                action.context.max_iterations ?? this.config.convergence.max_iterations_per_task,
              code_context: await this.gatherContext(action.context.relevant_files ?? message.context.relevant_files),
            },
            createSnapshot(this.budget, targetAgent.identity.id),
            {
              trace_id: message.trace_id,
              parent_message_id: response.message_id,
              priority: action.priority,
              estimated_tokens: action.estimated_tokens,
            },
          );

          const peerResp = await this.processMessage(nextMessage);

          if (peerResp && peerResp.status === "complete") {
            const resumeMessage = createMessage(
              "task",
              peerResp.agent,
              agent.identity,
              `Resume original task '${message.action}' with peer results`,
              {
                goal: message.context.goal,
                relevant_files: message.context.relevant_files,
                constraints: message.context.constraints,
                prior_decisions: message.context.prior_decisions,
                iteration: message.context.iteration + 1,
                max_iterations: message.context.max_iterations,
                code_context: await this.gatherContext(message.context.relevant_files),
              },
              createSnapshot(this.budget, agent.identity.id),
              {
                trace_id: message.trace_id,
                parent_message_id: peerResp.message_id,
                priority: action.priority,
              },
            );
            resumeMessage.payload = peerResp.result;
            await this.processMessage(resumeMessage);
          }
        }
      }
    } else if (response.next_actions?.length && response.status !== "failed") {
      for (const action of response.next_actions) {
        const targetAgent = this.findAgent(action.invoke);
        if (!targetAgent) {
          continue;
        }

        const currentZone = calculateZone(this.budget.consumed, this.budget.total);
        const ratio = this.budget.consumed / this.budget.total;
        const originalConstraints = action.context.constraints ?? message.context.constraints ?? [];
        const finalConstraints = [...originalConstraints];
        if (currentZone === "orange" || currentZone === "red" || ratio >= this.budget.warning_threshold) {
          finalConstraints.push("BUDGET WARNING: Safety threshold exceeded. Tighten scope, avoid starting new work.");
        }

        const nextMessage = createMessage(
          "task",
          agent.identity,
          targetAgent.identity,
          action.action,
          {
            goal: message.context.goal,
            relevant_files: action.context.relevant_files ?? message.context.relevant_files,
            constraints: finalConstraints,
            prior_decisions: [
              ...message.context.prior_decisions,
              ...(response.result?.decision ? [response.result.decision.choice] : []),
            ],
            iteration: action.context.iteration ?? 1,
            max_iterations:
              action.context.max_iterations ?? this.config.convergence.max_iterations_per_task,
            code_context: await this.gatherContext(action.context.relevant_files ?? message.context.relevant_files),
          },
          createSnapshot(this.budget, targetAgent.identity.id),
          {
            trace_id: message.trace_id,
            parent_message_id: response.message_id,
            priority: action.priority,
            estimated_tokens: action.estimated_tokens,
          },
        );

        await this.processMessage(nextMessage);
      }
    }

    return response;
  }

  private findAgent(role: AgentRole | { id: string; role: AgentRole }): GeminiAgent | undefined {
    const targetRole = typeof role === "string" ? role : role.role;
    for (const agent of this.agents.values()) {
      if (agent.identity.role === targetRole) {
        return agent;
      }
    }
    return undefined;
  }

  private recordUsage(agentId: string, tokens: number): void {
    this.budget.consumed += tokens;
    const current = this.budget.per_agent.get(agentId) ?? 0;
    this.budget.per_agent.set(agentId, current + tokens);
  }

  private async handleLoop(message: AgentMessage): Promise<AgentResponse | null> {
    const architect = this.findAgent("architect");
    if (!architect) {
      return null;
    }

    const loopMessage = createMessage(
      "escalation",
      { id: "orchestrator", role: "architect" as AgentRole },
      architect.identity,
      "resolve_loop",
      {
        goal: message.context.goal,
        relevant_files: message.context.relevant_files,
        constraints: [
          ...message.context.constraints,
          "LOOP DETECTED: The system is repeating the same action. Intervene or terminate.",
        ],
        prior_decisions: message.context.prior_decisions,
        iteration: 1,
        max_iterations: 1,
      },
      createSnapshot(this.budget, architect.identity.id),
      { trace_id: message.trace_id, priority: 0 },
    );

    return this.processMessage(loopMessage);
  }

  private async gracefulShutdown(traceId: string): Promise<AgentResponse | null> {
    const release = this.findAgent("release");
    if (!release) {
      return null;
    }

    const shutdownMessage = createMessage(
      "task",
      { id: "orchestrator", role: "release" as AgentRole },
      release.identity,
      "partial_completion_report",
      {
        goal: "System budget exhausted. Produce status report of accomplished work and remaining tasks.",
        relevant_files: [],
        constraints: ["BUDGET EXHAUSTED. Produce report only. Do not invoke peers."],
        prior_decisions: [],
        iteration: 1,
        max_iterations: 1,
      },
      createSnapshot(this.budget, release.identity.id),
      { trace_id: traceId, priority: 0 },
    );

    try {
      return await this.invokeAgent(release, shutdownMessage);
    } catch (error) {
      this.reporter.reportError(error as Error);
      return null;
    }
  }

  private logAudit(message: AgentMessage, response: AgentResponse, startTime: number): void {
    this.auditLog.push({
      timestamp: Date.now(),
      trace_id: message.trace_id,
      message_id: response.message_id,
      agent_id: response.agent.id,
      agent_role: response.agent.role,
      action: message.action,
      input_summary: message.action,
      output_summary: response.result?.summary ?? "",
      token_usage: response.token_usage,
      budget_snapshot: createSnapshot(this.budget, response.agent.id),
      duration_ms: Date.now() - startTime,
      status: response.status,
      flags: response.flags,
      files_read: message.context.relevant_files,
      files_modified: response.result?.changes?.map((c) => c.file) ?? [],
      peers_invoked: response.next_actions?.map((a) => a.invoke) ?? [],
    });
  }

  private async gatherContext(relevantFiles: string[]): Promise<Array<{ path: string; content: string; last_modified_by?: string }>> {
    const context: Array<{ path: string; content: string; last_modified_by?: string }> = [];
    if (!relevantFiles?.length) return context;
    for (const file of relevantFiles) {
      try {
        const fileContent = await this.codebase.read(file);
        context.push({
          path: fileContent.path,
          content: fileContent.content,
          last_modified_by: fileContent.last_modified_by,
        });
      } catch (error) {
        // File does not exist yet (e.g. going to be created), ignore gracefully.
      }
    }
    return context;
  }

  private async applyChange(change: FileChange, agentId: string): Promise<void> {
    if (change.action === "create" || change.action === "modify") {
      await this.codebase.write(change.file, change.content, agentId);
    }
    this.accumulatedChanges.push(change);
  }

  private collectAllChanges(): FileChange[] {
    return this.accumulatedChanges;
  }

  private async invokeAgent(agent: GeminiAgent, message: AgentMessage): Promise<AgentResponse> {
    const plugins = getPlugins();
    let currentMessage = message;

    for (const plugin of plugins) {
      if (plugin.hooks?.beforeInvoke) {
        currentMessage = plugin.hooks.beforeInvoke(currentMessage);
      }
    }

    try {
      let response = await agent.invoke(currentMessage);

      for (const plugin of plugins) {
        if (plugin.hooks?.afterInvoke) {
          response = plugin.hooks.afterInvoke(response);
        }
      }

      return response;
    } catch (error) {
      for (const plugin of plugins) {
        if (plugin.hooks?.onError) {
          try {
            plugin.hooks.onError(error as Error, currentMessage);
          } catch (e) {
            // Suppress errors inside plugin error handlers
          }
        }
      }
      throw error;
    }
  }
}
