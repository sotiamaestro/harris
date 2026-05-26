import type { AgentMessage, AgentResponse, AgentRole, Goal, TokenBudget } from "@harris/core";

type AgentVisualStatus = "pending" | "active" | "complete" | "failed" | "partial";

interface AgentVisualState {
  role: AgentRole;
  action?: string;
  status: AgentVisualStatus;
  tokens?: number;
  started_at?: number;
  duration_ms?: number;
}

export interface VisualizerOptions {
  enabled?: boolean;
  width?: number;
  spinner_interval_ms?: number;
  stream?: NodeJS.WriteStream;
}

const DEFAULT_ROLES: AgentRole[] = ["architect", "analyst", "builder", "reviewer", "tester", "release"];
const SPINNER_FRAMES = ["⟳", "◐", "◓", "◑", "◒"];
const ESC = String.fromCharCode(27);
const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

export class SwarmVisualizer {
  private readonly width: number;
  private readonly stream: NodeJS.WriteStream;
  private readonly spinnerIntervalMs: number;
  private readonly agents = new Map<AgentRole, AgentVisualState>();
  private goal = "";
  private status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "PARTIAL" = "PENDING";
  private budget?: TokenBudget;
  private hasRendered = false;
  private renderedLines = 0;
  private spinnerIndex = 0;
  private spinnerTimer?: NodeJS.Timeout;

  constructor(private readonly options: VisualizerOptions = {}) {
    this.width = options.width ?? 61;
    this.stream = options.stream ?? process.stdout;
    this.spinnerIntervalMs = options.spinner_interval_ms ?? 120;
    for (const role of DEFAULT_ROLES) {
      this.agents.set(role, { role, status: "pending" });
    }
  }

  get enabled(): boolean {
    return this.options.enabled ?? false;
  }

  startGoal(goal: Goal, budget: TokenBudget, roles: AgentRole[] = DEFAULT_ROLES): void {
    this.goal = goal.description;
    this.status = "RUNNING";
    this.budget = budget;
    this.agents.clear();
    for (const role of roles) {
      this.agents.set(role, { role, status: "pending" });
    }
    this.render();
  }

  reportTaskStarted(message: AgentMessage, budget: TokenBudget): void {
    if (message.to === "*") {
      return;
    }

    this.budget = budget;
    const role = message.to.role;
    this.ensureAgent(role);
    this.agents.set(role, {
      ...this.agents.get(role),
      role,
      action: message.action,
      status: "active",
      started_at: Date.now(),
    });
    this.startSpinner();
    this.render();
  }

  reportResponseReceived(response: AgentResponse, budget: TokenBudget, durationMs: number): void {
    this.budget = budget;
    const role = response.agent.role;
    this.ensureAgent(role);
    this.agents.set(role, {
      ...this.agents.get(role),
      role,
      status: response.status === "failed" ? "failed" : response.status === "partial" ? "partial" : "complete",
      tokens: response.token_usage.total,
      duration_ms: durationMs,
    });
    this.stopSpinnerIfIdle();
    this.render();
  }

  reportError(error: Error, message?: AgentMessage): void {
    this.status = "FAILED";
    if (message && message.to !== "*") {
      const role = message.to.role;
      this.ensureAgent(role);
      this.agents.set(role, {
        ...this.agents.get(role),
        role,
        status: "failed",
        action: message.action,
      });
    }
    this.stopSpinner();
    this.render(error.message);
  }

  finish(status: "complete" | "failed" | "partial", budget: TokenBudget): void {
    this.status = status.toUpperCase() as "COMPLETE" | "FAILED" | "PARTIAL";
    this.budget = budget;
    this.stopSpinner();
    this.render();
    if (this.enabled && this.hasRendered) {
      this.stream.write("\n");
    }
  }

  renderFrame(errorMessage?: string): string {
    const lines = [
      this.topBorder(),
      this.contentLine(`${COLORS.cyan}Goal:${COLORS.reset} ${this.truncate(this.goal || "No goal running", this.innerWidth() - 6)}`),
      this.contentLine(this.renderBudget()),
      this.contentLine(`${COLORS.cyan}Status:${COLORS.reset} ${this.status}`),
      this.separator(),
      ...[...this.agents.values()].map((agent) => this.contentLine(this.renderAgent(agent))),
    ];

    if (errorMessage) {
      lines.push(this.separator(), this.contentLine(`${COLORS.red}Error:${COLORS.reset} ${this.truncate(errorMessage, this.innerWidth() - 7)}`));
    }

    lines.push(this.bottomBorder());
    return lines.join("\n");
  }

  private render(errorMessage?: string): void {
    if (!this.enabled) {
      return;
    }

    const frame = this.renderFrame(errorMessage);
    if (this.hasRendered) {
      this.stream.write(`\x1b[${this.renderedLines}A\x1b[0J`);
    }

    this.stream.write(frame);
    this.hasRendered = true;
    this.renderedLines = frame.split("\n").length;
  }

  private renderBudget(): string {
    const total = this.budget?.total ?? 0;
    const consumed = this.budget?.consumed ?? 0;
    const ratio = total > 0 ? consumed / total : 0;
    const percent = Math.round(ratio * 100);
    const filled = Math.max(0, Math.min(16, Math.round(ratio * 16)));
    const bar = `${"█".repeat(filled)}${"░".repeat(16 - filled)}`;
    const color = ratio >= 0.9 ? COLORS.red : ratio >= 0.75 ? COLORS.yellow : COLORS.green;

    return `${COLORS.cyan}Budget:${COLORS.reset} ${color}${bar}${COLORS.reset} ${percent}% (${this.formatNumber(consumed)} / ${this.formatNumber(total)})`;
  }

  private renderAgent(agent: AgentVisualState): string {
    const role = this.formatRole(agent.role);
    const action = this.truncate(agent.action ?? "pending", 18).padEnd(18);

    if (agent.status === "pending") {
      return `${COLORS.dim}○ ${role} ${"pending".padEnd(18)}${COLORS.reset}`;
    }

    if (agent.status === "active") {
      return `${COLORS.yellow}${this.spinner()} ${role} ${action} ...${COLORS.reset}`;
    }

    const icon = agent.status === "failed" ? "✗" : "✓";
    const color = agent.status === "failed" ? COLORS.red : agent.status === "partial" ? COLORS.yellow : COLORS.green;
    const tokens = `${this.formatNumber(agent.tokens ?? 0)} tokens`.padStart(13);
    const duration = this.formatDuration(agent.duration_ms).padStart(5);
    return `${color}${icon} ${role} ${action} ${tokens} ${duration}${COLORS.reset}`;
  }

  private startSpinner(): void {
    if (!this.enabled || this.spinnerTimer) {
      return;
    }

    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, this.spinnerIntervalMs);
  }

  private stopSpinnerIfIdle(): void {
    if ([...this.agents.values()].every((agent) => agent.status !== "active")) {
      this.stopSpinner();
    }
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }

  private spinner(): string {
    return SPINNER_FRAMES[this.spinnerIndex] ?? SPINNER_FRAMES[0];
  }

  private ensureAgent(role: AgentRole): void {
    if (!this.agents.has(role)) {
      this.agents.set(role, { role, status: "pending" });
    }
  }

  private topBorder(): string {
    return `┌─ harris swarm ${"─".repeat(Math.max(0, this.width - 17))}┐`;
  }

  private separator(): string {
    return `├${"─".repeat(this.width - 2)}┤`;
  }

  private bottomBorder(): string {
    return `└${"─".repeat(this.width - 2)}┘`;
  }

  private contentLine(content: string): string {
    const visible = this.stripAnsi(content);
    const padded = visible.length >= this.innerWidth() ? this.truncateAnsi(content, this.innerWidth()) : `${content}${" ".repeat(this.innerWidth() - visible.length)}`;
    return `│ ${padded} │`;
  }

  private innerWidth(): number {
    return this.width - 4;
  }

  private formatRole(role: AgentRole): string {
    return `${role.charAt(0).toUpperCase()}${role.slice(1)}`.padEnd(10);
  }

  private formatDuration(durationMs?: number): string {
    if (durationMs === undefined) {
      return "...";
    }
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  private truncateAnsi(value: string, maxLength: number): string {
    return this.truncate(this.stripAnsi(value), maxLength);
  }

  private stripAnsi(value: string): string {
    let output = "";
    for (let index = 0; index < value.length; index++) {
      if (value[index] === ESC && value[index + 1] === "[") {
        index += 2;
        while (index < value.length && value[index] !== "m") {
          index++;
        }
        continue;
      }
      output += value[index];
    }
    return output;
  }
}
