import type {
  CodebaseContext,
  FileTree,
  FileContent,
  FileDiff,
  AgentAttribution,
  SearchOptions,
  SearchResult,
  FileChange,
} from "@harris/core";
import { FileReader } from "./file-reader.js";
import { FileWriter } from "./file-writer.js";
import { FileTreeBuilder } from "./file-tree.js";
import { CodeSearcher } from "./search.js";
import { DiffEngine } from "./diff-engine.js";
import { VersionTracker } from "./version-tracker.js";
import { AgentAttributor } from "./attribution.js";

export class LocalCodebaseContext implements CodebaseContext {
  root: string;
  files!: FileTree;

  private reader: FileReader;
  private writer: FileWriter;
  private treeBuilder: FileTreeBuilder;
  private searcher: CodeSearcher;
  private diffEngine: DiffEngine;
  private versionTracker: VersionTracker;
  private attributor: AgentAttributor;

  constructor(root: string) {
    this.root = root;
    this.reader = new FileReader(root);
    this.writer = new FileWriter(root);
    this.treeBuilder = new FileTreeBuilder(root);
    this.searcher = new CodeSearcher(root);
    this.diffEngine = new DiffEngine();
    this.versionTracker = new VersionTracker();
    this.attributor = new AgentAttributor();
  }

  async initialize(): Promise<void> {
    this.files = await this.treeBuilder.build();
  }

  async read(path: string): Promise<FileContent> {
    const cached = this.reader.getCached(path);
    if (cached) {
      cached.version = this.versionTracker.getVersion(path);
      const lastAttr = this.attributor.getLastAttribution(path);
      cached.last_modified_by = lastAttr?.agent_id;
      cached.last_modified_at = lastAttr?.timestamp;
      return cached;
    }

    const content = await this.reader.read(path, this.versionTracker);
    const newVersion = this.versionTracker.updateVersion(path, content.content);
    content.version = newVersion;
    return content;
  }

  async write(path: string, content: string, agentId: string): Promise<FileChange> {
    let before = "";
    try {
      const existing = await this.reader.read(path, this.versionTracker);
      before = existing.content;
    } catch {
      // Expected for new files
    }

    const change = await this.writer.write(path, content, agentId, this.versionTracker);
    this.reader.invalidate(path);

    this.diffEngine.recordDiff(path, before, content, agentId);
    this.attributor.recordModification(path, agentId, "builder", `Modified by ${agentId}`);

    await this.initialize();
    return change;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.searcher.search(query, options);
  }

  async diff(since?: string): Promise<FileDiff[]> {
    return this.diffEngine.getDiffs(since);
  }

  blame(path: string): AgentAttribution[] {
    return this.attributor.getAttributions(path);
  }

  getVersion(path: string): string {
    return this.versionTracker.getVersion(path);
  }

  listModified(): string[] {
    return [...new Set(this.diffEngine.getDiffs().map(d => d.path))];
  }
}
