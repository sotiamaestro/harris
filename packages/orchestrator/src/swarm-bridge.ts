import type {
  CodebaseContext,
  CrossProjectGoal,
  CrossProjectImpact,
  FileChange,
  FileTree,
  Goal,
  GoalResult,
  SharedContext,
} from "@harris/core";

export interface SwarmRunner {
  runGoal(goal: Goal): Promise<GoalResult>;
}

export interface SwarmProject {
  id: string;
  codebase: CodebaseContext;
  runner: SwarmRunner;
}

export interface SwarmBridgeOptions {
  parent: SwarmProject;
  children: SwarmProject[];
  createChildGoal?: (context: SharedContext) => CrossProjectGoal;
}

export interface SwarmBridgeRun {
  context: SharedContext;
  goal: CrossProjectGoal;
  result: GoalResult;
}

interface ImportReference {
  file: string;
  specifier: string;
}

export class SwarmBridge {
  private readonly children = new Map<string, SwarmProject>();
  private readonly completedImpactKeys = new Set<string>();
  private readonly runs: SwarmBridgeRun[] = [];

  constructor(private readonly options: SwarmBridgeOptions) {
    for (const child of options.children) {
      this.children.set(child.id, child);
    }
  }

  get completedRuns(): SwarmBridgeRun[] {
    return [...this.runs];
  }

  async detectImpacts(changes: FileChange[]): Promise<CrossProjectImpact[]> {
    const changedFiles = [...new Set(changes.map((change) => change.file))];
    if (!changedFiles.length) {
      return [];
    }

    const impacts: CrossProjectImpact[] = [];
    for (const child of this.children.values()) {
      const imports = await this.collectImports(child.codebase);
      const matches = this.findMatchingImports(changedFiles, imports);
      if (!matches.length) {
        continue;
      }

      impacts.push({
        source_project: this.options.parent.id,
        target_project: child.id,
        changed_files: changedFiles,
        matched_imports: [...new Set(matches.map((match) => match.specifier))],
        importing_files: [...new Set(matches.map((match) => match.file))],
        reason: `Project ${child.id} imports changed code from ${this.options.parent.id}.`,
        required_updates: [
          `Update ${child.id} files that import ${this.options.parent.id} contract changes.`,
          "Run the child swarm's normal review and test flow before the parent continues testing.",
        ],
      });
    }

    return impacts;
  }

  async synchronizeImpacts(changes: FileChange[], parentGoal: Goal): Promise<SwarmBridgeRun[]> {
    const impacts = await this.detectImpacts(changes);
    const runs: SwarmBridgeRun[] = [];

    for (const impact of impacts) {
      const key = this.createImpactKey(impact);
      if (this.completedImpactKeys.has(key)) {
        continue;
      }

      const child = this.children.get(impact.target_project);
      if (!child) {
        continue;
      }

      const context = this.createSharedContext(parentGoal, changes, impact);
      const goal = this.options.createChildGoal?.(context) ?? this.createDefaultChildGoal(context);
      const result = await child.runner.runGoal(goal);
      const run = { context, goal, result };

      this.completedImpactKeys.add(key);
      this.runs.push(run);
      runs.push(run);
    }

    return runs;
  }

  private createSharedContext(parentGoal: Goal, changes: FileChange[], impact: CrossProjectImpact): SharedContext {
    const relevantChanges = changes.filter((change) => impact.changed_files.includes(change.file));

    return {
      id: crypto.randomUUID(),
      parent_goal_id: parentGoal.id,
      source_project: impact.source_project,
      target_project: impact.target_project,
      changed_files: impact.changed_files,
      changes: relevantChanges,
      matched_imports: impact.matched_imports,
      importing_files: impact.importing_files,
      reason: impact.reason,
      required_updates: impact.required_updates,
      created_at: Date.now(),
    };
  }

  private createDefaultChildGoal(context: SharedContext): CrossProjectGoal {
    return {
      id: crypto.randomUUID(),
      description: [
        `Update ${context.target_project} for upstream changes in ${context.source_project}.`,
        context.reason,
        `Changed files: ${context.changed_files.join(", ")}`,
        `Importing files: ${context.importing_files.join(", ")}`,
      ].join(" "),
      acceptance_criteria: [
        {
          description: "All impacted importing files have been updated for the upstream contract change.",
          verifiable: true,
          verified: false,
        },
        {
          description: "The child swarm completes its review and test flow independently.",
          verifiable: true,
          verified: false,
        },
      ],
      status: "pending",
      budget_allocation: 0,
      created_by: "swarm-bridge",
      created_at: Date.now(),
      parent_goal_id: context.parent_goal_id,
      source_project: context.source_project,
      target_project: context.target_project,
      shared_context: context,
    };
  }

  private async collectImports(codebase: CodebaseContext): Promise<ImportReference[]> {
    const files = this.flattenFiles(codebase.files);
    const imports: ImportReference[] = [];

    for (const file of files) {
      try {
        const content = await codebase.read(file);
        for (const specifier of this.parseImportSpecifiers(content.content)) {
          imports.push({ file, specifier });
        }
      } catch {
        // Ignore unreadable generated or deleted files while computing impact.
      }
    }

    return imports;
  }

  private flattenFiles(tree: FileTree): string[] {
    if (tree.type === "file") {
      return [tree.path];
    }

    return tree.children?.flatMap((child) => this.flattenFiles(child)) ?? [];
  }

  private parseImportSpecifiers(content: string): string[] {
    const specifiers = new Set<string>();
    const importPattern =
      /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g;

    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier) {
        specifiers.add(specifier);
      }
    }

    return [...specifiers];
  }

  private findMatchingImports(changedFiles: string[], imports: ImportReference[]): ImportReference[] {
    const candidates = this.createImportCandidates(changedFiles);

    return imports.filter((reference) =>
      candidates.some((candidate) => this.importMatches(reference.specifier, candidate)),
    );
  }

  private createImportCandidates(changedFiles: string[]): string[] {
    const candidates = new Set<string>([
      this.options.parent.id,
      `@${this.options.parent.id}`,
    ]);

    for (const file of changedFiles) {
      const normalized = this.withoutExtension(file).replace(/\/index$/, "");
      const fileName = normalized.split("/").at(-1);

      candidates.add(normalized);
      candidates.add(`${this.options.parent.id}/${normalized}`);
      candidates.add(`@${this.options.parent.id}/${normalized}`);

      if (fileName) {
        candidates.add(fileName);
        candidates.add(`${this.options.parent.id}/${fileName}`);
        candidates.add(`@${this.options.parent.id}/${fileName}`);
      }
    }

    return [...candidates].filter(Boolean);
  }

  private importMatches(specifier: string, candidate: string): boolean {
    const normalizedSpecifier = this.withoutExtension(specifier);
    const normalizedCandidate = this.withoutExtension(candidate);

    return (
      normalizedSpecifier === normalizedCandidate ||
      normalizedSpecifier.endsWith(`/${normalizedCandidate}`)
    );
  }

  private withoutExtension(value: string): string {
    return value.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, "");
  }

  private createImpactKey(impact: CrossProjectImpact): string {
    return [
      impact.target_project,
      ...impact.changed_files,
      ...impact.importing_files,
      ...impact.matched_imports,
    ].join("|");
  }
}
