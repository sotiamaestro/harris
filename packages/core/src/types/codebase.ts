import type { AgentRole, FileChange } from "./messages.js";

export interface CodebaseContext {
  root: string; // absolute path to codebase root
  files: FileTree;
  read(path: string): Promise<FileContent>;
  write(path: string, content: string, agentId: string): Promise<FileChange>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  diff(since?: string): Promise<FileDiff[]>;
  blame(path: string): AgentAttribution[];
  getVersion(path: string): string; // returns hash
  listModified(): string[]; // files changed since session start
}

export interface FileTree {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileTree[];
  size?: number;
  extension?: string;
}

export interface FileContent {
  path: string;
  content: string;
  version: string; // content hash for optimistic concurrency
  last_modified_by?: string; // agent ID
  last_modified_at?: number;
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  agent_id: string;
  timestamp: number;
}

export interface AgentAttribution {
  path: string;
  agent_id: string;
  agent_role: AgentRole;
  timestamp: number;
  change_summary: string;
}

export interface SearchOptions {
  type?: "text" | "regex";
  file_pattern?: string; // glob pattern
  max_results?: number;
  include_context?: boolean; // include surrounding lines
}

export interface SearchResult {
  path: string;
  line: number;
  content: string;
  context?: { before: string[]; after: string[] };
}
