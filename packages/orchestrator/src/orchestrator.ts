import type {
  AgentMessage,
  AgentIdentity,
  AgentResponse,
  AgentRole,
  Goal,
  GoalResult,
  TokenBudget,
  AuditEntry,
  FileChange,
  AgentConfig,
  CodebaseContext,
  FileTree,
  NextAction,
} from "@harris/core";
import { createMessage, calculateZone, createSnapshot } from "@harris/core";
import type { GeminiAgent } from "@harris/gemini";
import { SwarmLifecycleManager } from "./lifecycle.js";
import { SwarmReporter } from "./reporter.js";
import { getPlugins } from "./plugins.js";
import type { SwarmBridgeRun } from "./swarm-bridge.js";
import { SwarmVisualizer, type VisualizerOptions } from "./visualizer.js";
import { runAcceptanceCriteriaValidators } from "./goal-runner.js";

interface CrossProjectBridge {
  synchronizeImpacts(changes: FileChange[], parentGoal: Goal): Promise<SwarmBridgeRun[]>;
}

interface ProcessMessageOptions {
  deferTesterActions?: boolean;
}

interface FileGroup {
  module: string;
  files: string[];
}

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
  visualizer?: boolean | VisualizerOptions;
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
  private activeGoal: Goal | null = null;
  private visualizer: SwarmVisualizer;

  constructor(
    private config: OrchestratorConfig,
    private codebase: CodebaseContext,
    private crossProjectBridge?: CrossProjectBridge,
  ) {
    this.budget = {
      total: config.budget.total,
      consumed: 0,
      per_agent: new Map(),
      allocations: new Map(),
      warning_threshold: config.budget.warning_threshold,
      hard_stop: config.budget.hard_stop,
    };
    this.visualizer = new SwarmVisualizer(
      typeof config.visualizer === "boolean" ? { enabled: config.visualizer } : config.visualizer,
    );
  }

  registerAgent(agent: GeminiAgent): void {
    this.agents.set(agent.identity.id, agent);
  }

  async runGoal(goal: Goal): Promise<GoalResult> {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();
    this.accumulatedChanges = [];
    this.lastCompletedResponse = null;
    this.activeGoal = goal;
    this.resetAgentResponseCaches();
    this.visualizer.startGoal(goal, this.budget, this.getRegisteredRoles());

    const architect = this.findAgent("architect");
    if (!architect) {
      throw new Error("No architect agent registered");
    }

    const files = this.listCodebaseFiles();

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

    const validationReport = await runAcceptanceCriteriaValidators(goal, this.codebase);
    const result: GoalResult = {
      goal_id: goal.id,
      status: finalResult?.status === "failed" ? "failed" : finalResult?.status === "complete" ? "complete" : "partial",
      summary:
        this.appendValidationSummary(
          finalResult?.status === "failed"
            ? finalResult.result.summary
            : (this.lastCompletedResponse as AgentResponse | null)?.result?.summary ?? finalResult?.result?.summary ?? "Goal processing ended",
          validationReport,
        ),
      changes: this.collectAllChanges(),
      token_usage: {
        total: this.budget.consumed,
        by_agent: Object.fromEntries(this.budget.per_agent),
      },
      duration_ms: Date.now() - startTime,
      audit_trail: this.auditLog,
    };
    this.visualizer.finish(result.status === "complete" ? "complete" : result.status === "failed" ? "failed" : "partial", this.budget);
    return result;
  }

  private appendValidationSummary(
    summary: string,
    validationReport: Awaited<ReturnType<typeof runAcceptanceCriteriaValidators>>,
  ): string {
    if (validationReport.ran === 0) {
      return summary;
    }

    const details = [
      `Custom validators: ${validationReport.passed.length}/${validationReport.ran} passed.`,
      ...validationReport.failed.map((criterion) => `Failed criterion: ${criterion}.`),
      ...validationReport.errors.map((entry) => `Validator error for "${entry.criterion}": ${entry.error}.`),
    ];

    return `${summary}\n${details.join("\n")}`;
  }

  private async processMessage(
    message: AgentMessage,
    options: ProcessMessageOptions = {},
  ): Promise<AgentResponse | null> {
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

    this.visualizer.reportTaskStarted(message, this.budget);
    if (!this.visualizer.enabled) {
      this.reporter.reportTaskStarted(message);
    }

    let response: AgentResponse;
    try {
      response = await this.invokeAgent(agent, message);
    } catch (error) {
      this.visualizer.reportError(error as Error, message);
      if (!this.visualizer.enabled) {
        this.reporter.reportError(error as Error);
      }
      return null;
    }

    this.recordUsage(agent.identity.id, response.token_usage.total);
    this.logAudit(message, response, startTime);
    this.visualizer.reportResponseReceived(response, this.budget, Date.now() - startTime);
    if (!this.visualizer.enabled) {
      this.reporter.reportResponseReceived(response);
    }

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

    const multiFileResponse = await this.processMultiFileGoalIfNeeded(agent.identity.role, message, response);
    if (multiFileResponse) {
      return multiFileResponse;
    }

    if (response.status === "needs_peer") {
      if (response.next_actions?.length) {
        for (const action of response.next_actions) {
          if (options.deferTesterActions && action.invoke === "tester") {
            continue;
          }

          const targetAgent = this.findAgent(action.invoke);
          if (!targetAgent) {
            continue;
          }

          const bridgeFailure = await this.synchronizeCrossProjectBeforeTesting(action.invoke, message.trace_id, response.message_id);
          if (bridgeFailure) {
            return bridgeFailure;
          }

          const currentZone = calculateZone(this.budget.consumed, this.budget.total);
          const ratio = this.budget.consumed / this.budget.total;
          const originalConstraints = action.context.constraints ?? message.context.constraints ?? [];
          const finalConstraints = [...originalConstraints];
          const nextRelevantFiles = action.context.relevant_files ?? message.context.relevant_files;
          const nextActionName = options.deferTesterActions
            ? this.withGroupSuffix(action.action, nextRelevantFiles)
            : action.action;
          if (currentZone === "orange" || currentZone === "red" || ratio >= this.budget.warning_threshold) {
            finalConstraints.push("BUDGET WARNING: Safety threshold exceeded. Tighten scope, avoid starting new work.");
          }

          const nextMessage = createMessage(
            "task",
            agent.identity,
            targetAgent.identity,
            nextActionName,
            {
              goal: message.context.goal,
              relevant_files: nextRelevantFiles,
              constraints: finalConstraints,
              prior_decisions: [
                ...message.context.prior_decisions,
                ...(response.result?.decision ? [response.result.decision.choice] : []),
              ],
              iteration: action.context.iteration ?? 1,
              max_iterations:
                action.context.max_iterations ?? this.config.convergence.max_iterations_per_task,
              code_context: await this.gatherContext(nextRelevantFiles),
            },
            createSnapshot(this.budget, targetAgent.identity.id),
            {
              trace_id: message.trace_id,
              parent_message_id: response.message_id,
              priority: action.priority,
              estimated_tokens: action.estimated_tokens,
            },
          );

          const peerResp = await this.processMessage(nextMessage, options);
          if (peerResp?.status === "failed") {
            return peerResp;
          }

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
            await this.processMessage(resumeMessage, options);
          }
        }
      }
    } else if (response.next_actions?.length && response.status !== "failed") {
      for (const action of response.next_actions) {
        if (options.deferTesterActions && action.invoke === "tester") {
          continue;
        }

        const targetAgent = this.findAgent(action.invoke);
        if (!targetAgent) {
          continue;
        }

        const bridgeFailure = await this.synchronizeCrossProjectBeforeTesting(action.invoke, message.trace_id, response.message_id);
        if (bridgeFailure) {
          return bridgeFailure;
        }

        const currentZone = calculateZone(this.budget.consumed, this.budget.total);
        const ratio = this.budget.consumed / this.budget.total;
        const originalConstraints = action.context.constraints ?? message.context.constraints ?? [];
        const finalConstraints = [...originalConstraints];
        const nextRelevantFiles = action.context.relevant_files ?? message.context.relevant_files;
        const nextActionName = options.deferTesterActions
          ? this.withGroupSuffix(action.action, nextRelevantFiles)
          : action.action;
        if (currentZone === "orange" || currentZone === "red" || ratio >= this.budget.warning_threshold) {
          finalConstraints.push("BUDGET WARNING: Safety threshold exceeded. Tighten scope, avoid starting new work.");
        }

        const nextMessage = createMessage(
          "task",
          agent.identity,
          targetAgent.identity,
          nextActionName,
          {
            goal: message.context.goal,
            relevant_files: nextRelevantFiles,
            constraints: finalConstraints,
            prior_decisions: [
              ...message.context.prior_decisions,
              ...(response.result?.decision ? [response.result.decision.choice] : []),
            ],
            iteration: action.context.iteration ?? 1,
            max_iterations:
              action.context.max_iterations ?? this.config.convergence.max_iterations_per_task,
            code_context: await this.gatherContext(nextRelevantFiles),
          },
          createSnapshot(this.budget, targetAgent.identity.id),
          {
            trace_id: message.trace_id,
            parent_message_id: response.message_id,
            priority: action.priority,
            estimated_tokens: action.estimated_tokens,
          },
        );

        const nextResp = await this.processMessage(nextMessage, options);
        if (nextResp?.status === "failed") {
          return nextResp;
        }
      }
    }

    return response;
  }

  private async processMultiFileGoalIfNeeded(
    role: AgentRole,
    message: AgentMessage,
    response: AgentResponse,
  ): Promise<AgentResponse | null> {
    if (role !== "architect" || message.action !== "decompose_goal" || response.status === "failed") {
      return null;
    }

    const files = message.context.relevant_files;
    if (files.length < 5) {
      return null;
    }

    const builderAction = response.next_actions.find((action) => action.invoke === "builder");
    if (!builderAction) {
      return null;
    }

    const groups = this.groupFilesByDirectory(files);
    if (!groups.length) {
      return null;
    }

    const builder = this.findAgent("builder");
    if (!builder) {
      return null;
    }

    const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0);
    const baseEstimatedTokens = builderAction.estimated_tokens || this.config.budget.per_agent_default;
    const groupResponses = await Promise.all(
      groups.map(async (group) => {
        const estimatedTokens = Math.max(1, Math.round((baseEstimatedTokens * group.files.length) / totalFiles));
        const groupMessage = await this.createGroupedBuilderMessage(
          message,
          response,
          builderAction,
          builder.identity,
          group,
          estimatedTokens,
        );
        return this.processMessage(groupMessage, { deferTesterActions: true });
      }),
    );

    const failedResponse = groupResponses.find((groupResponse) => groupResponse?.status === "failed");
    if (failedResponse) {
      return failedResponse;
    }

    const testerResponse = await this.runFinalMultiFileTester(message, response);
    return testerResponse ?? this.lastNonNullResponse(groupResponses) ?? response;
  }

  private async createGroupedBuilderMessage(
    parentMessage: AgentMessage,
    architectResponse: AgentResponse,
    builderAction: NextAction,
    builderIdentity: AgentIdentity,
    group: FileGroup,
    estimatedTokens: number,
  ): Promise<AgentMessage> {
    const originalConstraints = builderAction.context.constraints ?? parentMessage.context.constraints ?? [];
    const finalConstraints = [
      ...originalConstraints,
      `MULTI-FILE GROUP: ${group.module}`,
      `GROUP TOKEN BUDGET: ${estimatedTokens}`,
    ];

    return createMessage(
      "task",
      architectResponse.agent,
      builderIdentity,
      `${builderAction.action} [${group.module}]`,
      {
        goal: parentMessage.context.goal,
        relevant_files: group.files,
        constraints: finalConstraints,
        prior_decisions: [
          ...parentMessage.context.prior_decisions,
          ...(architectResponse.result?.decision ? [architectResponse.result.decision.choice] : []),
        ],
        iteration: builderAction.context.iteration ?? 1,
        max_iterations: builderAction.context.max_iterations ?? this.config.convergence.max_iterations_per_task,
        code_context: await this.gatherContext(group.files),
      },
      createSnapshot(this.budget, typeof builderIdentity === "string" ? builderIdentity : builderIdentity.id),
      {
        trace_id: parentMessage.trace_id,
        parent_message_id: architectResponse.message_id,
        priority: builderAction.priority,
        estimated_tokens: estimatedTokens,
      },
    );
  }

  private async runFinalMultiFileTester(
    parentMessage: AgentMessage,
    architectResponse: AgentResponse,
  ): Promise<AgentResponse | null> {
    const tester = this.findAgent("tester");
    if (!tester) {
      return null;
    }

    const bridgeFailure = await this.synchronizeCrossProjectBeforeTesting(
      "tester",
      parentMessage.trace_id,
      architectResponse.message_id,
    );
    if (bridgeFailure) {
      return bridgeFailure;
    }

    const testerMessage = createMessage(
      "task",
      architectResponse.agent,
      tester.identity,
      "Run full test suite after multi-file groups",
      {
        goal: parentMessage.context.goal,
        relevant_files: parentMessage.context.relevant_files,
        constraints: parentMessage.context.constraints,
        prior_decisions: parentMessage.context.prior_decisions,
        iteration: 1,
        max_iterations: this.config.convergence.max_iterations_per_task,
        code_context: await this.gatherContext(parentMessage.context.relevant_files),
      },
      createSnapshot(this.budget, tester.identity.id),
      {
        trace_id: parentMessage.trace_id,
        parent_message_id: architectResponse.message_id,
        priority: 1,
      },
    );

    return this.processMessage(testerMessage);
  }

  private groupFilesByDirectory(files: string[]): FileGroup[] {
    const grouped = new Map<string, string[]>();

    for (const file of files) {
      const parts = file.split("/");
      const module = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      const group = grouped.get(module) ?? [];
      group.push(file);
      grouped.set(module, group);
    }

    return [...grouped.entries()]
      .map(([module, groupFiles]) => ({ module, files: groupFiles }))
      .sort((left, right) => left.module.localeCompare(right.module));
  }

  private withGroupSuffix(action: string, relevantFiles: string[]): string {
    const group = this.groupFilesByDirectory(relevantFiles)[0];
    if (!group || action.includes(`[${group.module}]`)) {
      return action;
    }
    return `${action} [${group.module}]`;
  }

  private async synchronizeCrossProjectBeforeTesting(
    invoke: AgentRole,
    traceId: string,
    parentMessageId: string,
  ): Promise<AgentResponse | null> {
    if (invoke !== "tester" || !this.crossProjectBridge || !this.activeGoal || !this.accumulatedChanges.length) {
      return null;
    }

    let bridgeRuns: SwarmBridgeRun[];
    try {
      bridgeRuns = await this.crossProjectBridge.synchronizeImpacts(this.accumulatedChanges, this.activeGoal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown child swarm failure";
      return this.createBridgeFailureResponse(traceId, parentMessageId, `Child swarm synchronization failed: ${message}`);
    }

    const failedRuns = bridgeRuns.filter((run) => run.result.status === "failed");
    if (!failedRuns.length) {
      return null;
    }

    const failedProjects = failedRuns.map((run) => run.context.target_project).join(", ");
    return this.createBridgeFailureResponse(
      traceId,
      parentMessageId,
      `Child swarm failed for ${failedProjects}. Parent swarm blocked before testing.`,
    );
  }

  private createBridgeFailureResponse(traceId: string, parentMessageId: string, summary: string): AgentResponse {
    return {
      message_id: crypto.randomUUID(),
      in_response_to: parentMessageId,
      trace_id: traceId,
      status: "failed",
      agent: { id: "swarm-bridge", role: "architect" },
      result: { summary },
      next_actions: [],
      token_usage: { input: 0, output: 0, total: 0 },
      confidence: 1,
      flags: ["blocking_issue", "architectural_impact"],
    };
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

  private getRegisteredRoles(): AgentRole[] {
    const roles = [...new Set([...this.agents.values()].map((agent) => agent.identity.role))];
    return roles.length ? roles : ["architect", "analyst", "builder", "reviewer", "tester", "release"];
  }

  private resetAgentResponseCaches(): void {
    for (const agent of this.agents.values()) {
      agent.resetResponseCache();
    }
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
      this.visualizer.reportError(error as Error, shutdownMessage);
      if (!this.visualizer.enabled) {
        this.reporter.reportError(error as Error);
      }
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

  private listCodebaseFiles(): string[] {
    const files: string[] = [];
    const visit = (node: FileTree): void => {
      if (node.type === "file") {
        files.push(node.path);
        return;
      }

      for (const child of node.children ?? []) {
        visit(child);
      }
    };

    if (this.codebase.files) {
      visit(this.codebase.files);
    }

    return files;
  }

  private lastNonNullResponse(responses: Array<AgentResponse | null>): AgentResponse | null {
    for (let index = responses.length - 1; index >= 0; index--) {
      const response = responses[index];
      if (response) {
        return response;
      }
    }
    return null;
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
