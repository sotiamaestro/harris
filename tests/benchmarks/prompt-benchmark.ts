import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AgentConfig, AgentMessage, AgentResponse, AgentRole, FileChange, NextAction } from "@harris/core";
import { DEFAULT_AGENT_CONFIGS } from "@harris/core";
import { buildSystemPrompt, estimateTokens, parseAgentResponse } from "@harris/gemini";

type ScoreName = "json_validity" | "schema_compliance" | "relevance" | "conciseness" | "correctness";

interface BenchmarkArgs {
  models: string[];
  evaluator_model: string;
  api_key: string;
  output?: string;
  json: boolean;
}

interface PromptCase {
  id: string;
  role: AgentRole;
  action: string;
  goal: string;
  relevant_files: string[];
  constraints: string[];
  code_context: Array<{ path: string; content: string }>;
  payload?: unknown;
  expected_terms: string[];
  minimum_viable_tokens: number;
  correctness: {
    kind: "builder_code" | "reviewer_bug" | "terms";
    terms: string[];
  };
}

interface CaseScore {
  case_id: string;
  role: AgentRole;
  model: string;
  scores: Record<ScoreName, number>;
  total_score: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    minimum_viable: number;
  };
  parsed: boolean;
  schema_errors: string[];
  relevance_reasoning: string;
  correctness_reasoning: string;
  response_excerpt: string;
}

interface RoleScorecard {
  role: AgentRole;
  averages: Record<ScoreName, number>;
  overall: number;
  cases: CaseScore[];
}

interface ModelScorecard {
  model: string;
  roles: RoleScorecard[];
  overall: {
    averages: Record<ScoreName, number>;
    score: number;
  };
}

interface BenchmarkResult {
  generated_at: string;
  evaluator_model: string;
  cases_per_role: number;
  total_cases_per_model: number;
  models: ModelScorecard[];
}

const ROLES: AgentRole[] = ["architect", "analyst", "builder", "reviewer", "tester", "debugger", "release"];
const SCORE_NAMES: ScoreName[] = ["json_validity", "schema_compliance", "relevance", "conciseness", "correctness"];

const DEFAULT_OUTPUT = "tests/benchmarks/prompt-benchmark-results.json";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = buildCases();
  validateCaseCount(cases);

  const result: BenchmarkResult = {
    generated_at: new Date().toISOString(),
    evaluator_model: args.evaluator_model,
    cases_per_role: 5,
    total_cases_per_model: cases.length,
    models: [],
  };

  for (const model of args.models) {
    const caseScores: CaseScore[] = [];
    for (const promptCase of cases) {
      caseScores.push(await runCase(promptCase, model, args));
    }

    result.models.push({
      model,
      roles: buildRoleScorecards(caseScores),
      overall: buildOverallScore(caseScores),
    });
  }

  const json = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(args.output ?? DEFAULT_OUTPUT, json, "utf-8");

  if (args.json) {
    process.stdout.write(json);
    return;
  }

  process.stdout.write(`${renderSummary(result)}\n`);
  process.stdout.write(`Machine-readable results written to ${args.output ?? DEFAULT_OUTPUT}\n`);
}

async function runCase(promptCase: PromptCase, model: string, args: BenchmarkArgs): Promise<CaseScore> {
  const genAI = new GoogleGenerativeAI(args.api_key);
  const agentModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: DEFAULT_AGENT_CONFIGS[promptCase.role].temperature ?? 0.2,
    },
    systemInstruction: buildSystemPrompt(agentConfig(promptCase.role, model), peerConfigs(model), 10000),
  });

  const message = createMessage(promptCase, model);
  const userPrompt = JSON.stringify(message);
  const response = await agentModel.generateContent(userPrompt);
  const raw = response.response.text();
  const inputTokens = response.response.usageMetadata?.promptTokenCount ?? estimateTokens(userPrompt);
  const outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? estimateTokens(raw);
  const totalTokens = response.response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;

  const strictJson = parseStrictJson(raw);
  const parsed = parseLenientResponse(raw);
  const schemaErrors = parsed ? validateResponseSchema(parsed, message) : ["Response could not be parsed as AgentResponse JSON."];
  const relevance = await scoreRelevance(promptCase, raw, args);
  const correctness = scoreCorrectness(promptCase, parsed, raw);
  const scores: Record<ScoreName, number> = {
    json_validity: strictJson.ok ? 1 : 0,
    schema_compliance: schemaErrors.length === 0 ? 1 : 0,
    relevance: relevance.score,
    conciseness: scoreConciseness(outputTokens, promptCase.minimum_viable_tokens),
    correctness: correctness.score,
  };

  return {
    case_id: promptCase.id,
    role: promptCase.role,
    model,
    scores,
    total_score: averageScores(scores),
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
      minimum_viable: promptCase.minimum_viable_tokens,
    },
    parsed: Boolean(parsed),
    schema_errors: schemaErrors,
    relevance_reasoning: relevance.reasoning,
    correctness_reasoning: correctness.reasoning,
    response_excerpt: raw.trim().slice(0, 600),
  };
}

async function scoreRelevance(
  promptCase: PromptCase,
  rawResponse: string,
  args: BenchmarkArgs,
): Promise<{ score: number; reasoning: string }> {
  const genAI = new GoogleGenerativeAI(args.api_key);
  const model = genAI.getGenerativeModel({
    model: args.evaluator_model,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });
  const prompt = {
    instruction:
      "Score whether the agent response addresses the task. Return JSON only: {\"score\": number between 0 and 1, \"reasoning\": string}. Do not score JSON format or code correctness here.",
    role: promptCase.role,
    task: {
      action: promptCase.action,
      goal: promptCase.goal,
      constraints: promptCase.constraints,
      expected_terms: promptCase.expected_terms,
    },
    response: rawResponse.slice(0, 8000),
  };

  try {
    const result = await model.generateContent(JSON.stringify(prompt));
    const parsed = parseAgentResponse<{ score?: number; reasoning?: string }>(result.response.text());
    return {
      score: clamp01(Number(parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? "Evaluator returned no reasoning.",
    };
  } catch (error) {
    return {
      score: 0,
      reasoning: `Evaluator failed: ${(error as Error).message}`,
    };
  }
}

function scoreCorrectness(
  promptCase: PromptCase,
  parsed: AgentResponse | null,
  rawResponse: string,
): { score: number; reasoning: string } {
  const haystack = `${rawResponse}\n${JSON.stringify(parsed ?? {})}`.toLowerCase();

  if (promptCase.correctness.kind === "builder_code") {
    const changes = parsed?.result?.changes ?? [];
    const content = changes.map((change) => change.content).join("\n").toLowerCase();
    const hits = promptCase.correctness.terms.filter((term) => content.includes(term.toLowerCase())).length;
    return {
      score: hits / promptCase.correctness.terms.length,
      reasoning: `Builder output contained ${hits}/${promptCase.correctness.terms.length} expected code markers.`,
    };
  }

  if (promptCase.correctness.kind === "reviewer_bug") {
    const hits = promptCase.correctness.terms.filter((term) => haystack.includes(term.toLowerCase())).length;
    return {
      score: hits / promptCase.correctness.terms.length,
      reasoning: `Reviewer identified ${hits}/${promptCase.correctness.terms.length} planted bug markers.`,
    };
  }

  const hits = promptCase.correctness.terms.filter((term) => haystack.includes(term.toLowerCase())).length;
  return {
    score: hits / promptCase.correctness.terms.length,
    reasoning: `Response included ${hits}/${promptCase.correctness.terms.length} expected correctness markers.`,
  };
}

function validateResponseSchema(response: AgentResponse, message: AgentMessage): string[] {
  const errors: string[] = [];
  const validStatuses = new Set(["complete", "partial", "failed", "needs_peer", "needs_escalation"]);

  if (!isString(response.message_id)) errors.push("message_id must be a string.");
  if (response.in_response_to !== message.message_id) errors.push("in_response_to must match request message_id.");
  if (response.trace_id !== message.trace_id) errors.push("trace_id must match request trace_id.");
  if (!validStatuses.has(response.status)) errors.push("status is not a valid MessageStatus.");
  if (!response.result || !isString(response.result.summary)) errors.push("result.summary must be a string.");
  if (!Array.isArray(response.next_actions)) errors.push("next_actions must be an array.");
  if (!isTokenUsage(response.token_usage)) errors.push("token_usage must include numeric input, output, and total.");
  if (typeof response.confidence !== "number" || response.confidence < 0 || response.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1.");
  }
  if (!Array.isArray(response.flags)) errors.push("flags must be an array.");

  if (response.result?.changes && !response.result.changes.every(isFileChange)) {
    errors.push("result.changes must contain valid FileChange objects.");
  }
  if (response.next_actions && !response.next_actions.every(isNextAction)) {
    errors.push("next_actions must contain valid NextAction objects.");
  }

  return errors;
}

function buildRoleScorecards(caseScores: CaseScore[]): RoleScorecard[] {
  return ROLES.map((role) => {
    const cases = caseScores.filter((score) => score.role === role);
    return {
      role,
      averages: averageByCriteria(cases),
      overall: average(cases.map((score) => score.total_score)),
      cases,
    };
  });
}

function buildOverallScore(caseScores: CaseScore[]): ModelScorecard["overall"] {
  return {
    averages: averageByCriteria(caseScores),
    score: average(caseScores.map((score) => score.total_score)),
  };
}

function averageByCriteria(caseScores: CaseScore[]): Record<ScoreName, number> {
  return Object.fromEntries(
    SCORE_NAMES.map((name) => [name, round4(average(caseScores.map((score) => score.scores[name])))]),
  ) as Record<ScoreName, number>;
}

function averageScores(scores: Record<ScoreName, number>): number {
  return round4(average(Object.values(scores)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreConciseness(outputTokens: number, minimumViableTokens: number): number {
  return round4(Math.min(1, minimumViableTokens / Math.max(outputTokens, 1)));
}

function parseStrictJson(raw: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(raw.trim()) };
  } catch {
    return { ok: false };
  }
}

function parseLenientResponse(raw: string): AgentResponse | null {
  try {
    return parseAgentResponse<AgentResponse>(raw);
  } catch {
    return null;
  }
}

function renderSummary(result: BenchmarkResult): string {
  const lines = [
    "# Prompt Benchmark Summary",
    `Generated: ${result.generated_at}`,
    `Evaluator model: ${result.evaluator_model}`,
    `Cases: ${result.total_cases_per_model} per model (${result.cases_per_role} per role)`,
    "",
  ];

  for (const model of result.models) {
    lines.push(`## ${model.model}`);
    lines.push(`Overall: ${model.overall.score.toFixed(3)}`);
    lines.push("Role scorecards:");
    for (const role of model.roles) {
      lines.push(
        `- ${role.role}: ${role.overall.toFixed(3)} ` +
          `(json ${role.averages.json_validity.toFixed(2)}, schema ${role.averages.schema_compliance.toFixed(2)}, ` +
          `relevance ${role.averages.relevance.toFixed(2)}, concise ${role.averages.conciseness.toFixed(2)}, ` +
          `correct ${role.averages.correctness.toFixed(2)})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function createMessage(promptCase: PromptCase, model: string): AgentMessage {
  return {
    message_id: `${promptCase.id}-${model}-message`,
    type: "task",
    from: { id: "benchmark-orchestrator", role: "architect" },
    to: { id: `${promptCase.role}-benchmark`, role: promptCase.role },
    trace_id: `${promptCase.id}-${model}-trace`,
    action: promptCase.action,
    context: {
      goal: promptCase.goal,
      relevant_files: promptCase.relevant_files,
      constraints: promptCase.constraints,
      prior_decisions: [],
      iteration: 1,
      max_iterations: 3,
      code_context: promptCase.code_context,
    },
    payload: promptCase.payload,
    budget: {
      total: 100000,
      consumed: 0,
      remaining: 100000,
      your_allocation: 10000,
      zone: "green",
      warning_threshold: 0.75,
      hard_stop: 0.95,
    },
    metadata: {
      timestamp: Date.now(),
      priority: 1,
      estimated_tokens: 2000,
      iteration: 1,
      max_iterations: 3,
    },
  };
}

function agentConfig(role: AgentRole, model: string): AgentConfig {
  return {
    ...DEFAULT_AGENT_CONFIGS[role],
    id: `${role}-benchmark`,
    model: model as AgentConfig["model"],
    temperature: DEFAULT_AGENT_CONFIGS[role].temperature ?? 0.2,
  };
}

function peerConfigs(model: string): AgentConfig[] {
  return ROLES.map((role) => agentConfig(role, model));
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const getValue = (name: string): string | undefined => {
    const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const models = (getValue("--models") ?? getValue("--model") ?? "gemini-2.5-flash")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const apiKey = getValue("--api-key") ?? process.env.GEMINI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required, or pass --api-key=<key>.");
  }

  return {
    models,
    evaluator_model: getValue("--evaluator-model") ?? "gemini-2.5-flash",
    api_key: apiKey,
    output: getValue("--output"),
    json: argv.includes("--json"),
  };
}

function validateCaseCount(cases: PromptCase[]): void {
  for (const role of ROLES) {
    const count = cases.filter((promptCase) => promptCase.role === role).length;
    if (count !== 5) {
      throw new Error(`Expected 5 benchmark cases for ${role}, got ${count}.`);
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTokenUsage(value: unknown): boolean {
  const usage = value as AgentResponse["token_usage"] | undefined;
  return Boolean(
    usage &&
      typeof usage.input === "number" &&
      typeof usage.output === "number" &&
      typeof usage.total === "number",
  );
}

function isFileChange(value: unknown): value is FileChange {
  const change = value as FileChange;
  return (
    isString(change?.file) &&
    ["create", "modify", "delete"].includes(change.action) &&
    typeof change.content === "string" &&
    isString(change.reasoning)
  );
}

function isNextAction(value: unknown): value is NextAction {
  const action = value as NextAction;
  return (
    ROLES.includes(action?.invoke) &&
    isString(action.action) &&
    typeof action.context === "object" &&
    [0, 1, 2, 3].includes(action.priority) &&
    typeof action.estimated_tokens === "number"
  );
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return round4(Math.max(0, Math.min(1, value)));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function buildCases(): PromptCase[] {
  const cases: PromptCase[] = [];
  for (const role of ROLES) {
    cases.push(...roleCases(role));
  }
  return cases;
}

function roleCases(role: AgentRole): PromptCase[] {
  const templates: Record<AgentRole, PromptCase[]> = {
    architect: [
      promptCase(role, "auth-expiry-plan", "Decompose JWT expiry validation work", "Add expiry validation to JWT middleware without changing refresh token behavior.", ["src/auth.ts"], ["Delegate implementation and review work."], authContext(), ["builder", "reviewer"], ["builder", "reviewer", "expiry"]),
      promptCase(role, "api-contract-plan", "Plan API contract migration", "Change User.email from optional to required across service and client.", ["src/user.ts", "src/client.ts"], ["Identify cross-project impact."], userContext(), ["contract", "client"], ["contract", "client", "tester"]),
      promptCase(role, "loop-risk-plan", "Break down repeated reviewer failures", "Resolve a builder/reviewer loop around unsafe input parsing.", ["src/parser.ts"], ["Avoid another blind implementation pass."], parserContext(), ["debugger", "reviewer"], ["debugger", "root cause"]),
      promptCase(role, "budget-plan", "Plan under orange budget", "Finish password reset validation with only 15 percent budget remaining.", ["src/reset.ts"], ["Do not start non-essential work."], resetContext(), ["budget", "tester"], ["budget", "minimal"]),
      promptCase(role, "conflict-plan", "Arbitrate cache strategy conflict", "Choose between in-memory and file-backed cache for small CLI runs.", ["src/cache.ts"], ["Cite correctness and simplicity tradeoffs."], cacheContext(), ["decision", "tradeoff"], ["decision", "simplicity"]),
    ],
    analyst: [
      promptCase(role, "auth-impact", "Analyze auth expiry impact", "Find dependencies and edge cases for adding JWT expiry checks.", ["src/auth.ts"], ["Do not propose code changes."], authContext(), ["expiry", "refresh"], ["expiry", "refresh", "dependencies"]),
      promptCase(role, "parser-impact", "Analyze parser bug", "Explain why empty input crashes parseUser.", ["src/parser.ts"], ["Find root cause and impacted callers."], parserContext(), ["empty", "trim"], ["empty", "root cause"]),
      promptCase(role, "cache-patterns", "Analyze cache patterns", "Identify existing cache style and invalidation constraints.", ["src/cache.ts"], ["Prefer existing patterns."], cacheContext(), ["invalidation", "ttl"], ["ttl", "invalidation"]),
      promptCase(role, "client-contract-impact", "Analyze client contract impact", "Find what breaks when User.email becomes required.", ["src/client.ts", "src/user.ts"], ["Mention tests likely affected."], userContext(), ["email", "tests"], ["email", "client"]),
      promptCase(role, "reset-security-impact", "Analyze reset security", "Assess password reset token validation risks.", ["src/reset.ts"], ["Prioritize security constraints."], resetContext(), ["token", "security"], ["token", "expiration"]),
    ],
    builder: [
      promptCase(role, "builder-subtract", "Implement subtract", "Add subtract(a, b) to math.ts.", ["math.ts"], ["Export subtract(a: number, b: number): number."], mathContext(), ["subtract"], ["subtract", "return a - b"], "builder_code"),
      promptCase(role, "builder-expiry", "Implement JWT expiry", "Reject expired JWT payloads in auth.ts.", ["src/auth.ts"], ["Keep refresh token behavior unchanged."], authContext(), ["exp", "expired"], ["exp", "Date.now"], "builder_code"),
      promptCase(role, "builder-empty-parser", "Fix empty parser", "Make parseUser return null for empty input.", ["src/parser.ts"], ["Do not throw for whitespace-only input."], parserContext(), ["null", "trim"], ["trim", "return null"], "builder_code"),
      promptCase(role, "builder-required-email", "Require email", "Update User type so email is required.", ["src/user.ts"], ["Keep id unchanged."], userContext(), ["email"], ["email: string"], "builder_code"),
      promptCase(role, "builder-reset-token", "Validate reset token expiry", "Reject expired password reset tokens.", ["src/reset.ts"], ["Use expiresAt field."], resetContext(), ["expiresAt", "expired"], ["expiresAt", "Date.now"], "builder_code"),
    ],
    reviewer: [
      promptCase(role, "reviewer-any-bug", "Review unsafe subtract", "Find strict typing issues in subtract change.", ["math.ts"], ["Find the planted bug."], mathContext(), ["any", "typing"], ["any"], "reviewer_bug", { changes: [{ file: "math.ts", action: "modify", content: "export function subtract(a: any, b: any) { return a - b; }", reasoning: "quick fix" }] }),
      promptCase(role, "reviewer-expiry-bug", "Review auth expiry", "Find expiry validation bugs.", ["src/auth.ts"], ["Find the planted bug."], authContext(), ["seconds", "milliseconds"], ["seconds", "milliseconds"], "reviewer_bug", { changes: [{ file: "src/auth.ts", action: "modify", content: "if (payload.exp < Date.now()) throw new Error('expired');", reasoning: "check exp" }] }),
      promptCase(role, "reviewer-empty-bug", "Review parser fix", "Find empty input handling bugs.", ["src/parser.ts"], ["Find the planted bug."], parserContext(), ["empty", "whitespace"], ["whitespace", "empty"], "reviewer_bug", { changes: [{ file: "src/parser.ts", action: "modify", content: "export function parseUser(input: string) { if (!input) return null; return JSON.parse(input); }", reasoning: "handle empty" }] }),
      promptCase(role, "reviewer-contract-bug", "Review user contract", "Find client contract migration bugs.", ["src/client.ts", "src/user.ts"], ["Find the planted bug."], userContext(), ["email", "client"], ["email", "client"], "reviewer_bug", { changes: [{ file: "src/user.ts", action: "modify", content: "export interface User { id: string; email: string; }", reasoning: "require email" }] }),
      promptCase(role, "reviewer-reset-bug", "Review reset validation", "Find reset token validation bugs.", ["src/reset.ts"], ["Find the planted bug."], resetContext(), ["expiresAt", "inverted"], ["expiresAt", "expired"], "reviewer_bug", { changes: [{ file: "src/reset.ts", action: "modify", content: "if (token.expiresAt > Date.now()) throw new Error('expired');", reasoning: "reject expired" }] }),
    ],
    tester: [
      promptCase(role, "tester-subtract", "Design subtract tests", "Verify subtract handles positive, negative, and zero values.", ["math.test.ts"], ["Return test results or test plan."], mathContext(), ["positive", "negative"], ["negative", "zero"]),
      promptCase(role, "tester-expiry", "Design auth expiry tests", "Verify expired tokens reject and refresh tokens remain exempt.", ["auth.test.ts"], ["Cover edge cases."], authContext(), ["expired", "refresh"], ["expired", "refresh"]),
      promptCase(role, "tester-parser", "Design parser tests", "Verify parseUser handles empty and malformed input.", ["parser.test.ts"], ["Include malformed JSON."], parserContext(), ["empty", "malformed"], ["empty", "malformed"]),
      promptCase(role, "tester-contract", "Design contract tests", "Verify User.email is required in client fixtures.", ["client.test.ts"], ["Mention fixture updates."], userContext(), ["email", "fixture"], ["email", "fixture"]),
      promptCase(role, "tester-reset", "Design reset token tests", "Verify expired reset tokens are rejected.", ["reset.test.ts"], ["Include boundary at expiresAt."], resetContext(), ["expiresAt", "boundary"], ["expiresAt", "boundary"]),
    ],
    debugger: [
      promptCase(role, "debugger-expiry", "Diagnose auth failure", "Expired JWTs are still accepted in production.", ["src/auth.ts"], ["Give root cause and fix guidance."], authContext(), ["root", "exp"], ["root", "exp"]),
      promptCase(role, "debugger-parser", "Diagnose parser crash", "Whitespace input crashes parseUser.", ["src/parser.ts"], ["Explain mechanism."], parserContext(), ["trim", "empty"], ["trim", "empty"]),
      promptCase(role, "debugger-client", "Diagnose client error", "Client crashes when rendering users without email.", ["src/client.ts"], ["Tie to contract change."], userContext(), ["email", "contract"], ["email", "contract"]),
      promptCase(role, "debugger-reset", "Diagnose reset security issue", "Expired reset tokens are accepted.", ["src/reset.ts"], ["Identify comparison bug."], resetContext(), ["expiresAt", "comparison"], ["expiresAt", "comparison"]),
      promptCase(role, "debugger-cache", "Diagnose stale cache", "CLI shows stale user data after invalidation.", ["src/cache.ts"], ["Find likely invalidation path."], cacheContext(), ["invalidate", "stale"], ["invalidate", "stale"]),
    ],
    release: [
      promptCase(role, "release-auth", "Prepare auth release notes", "Summarize JWT expiry validation change and checks.", ["src/auth.ts"], ["Mention risk and tests."], authContext(), ["risk", "tests"], ["expiry", "tests"]),
      promptCase(role, "release-parser", "Prepare parser release notes", "Summarize empty input parser fix.", ["src/parser.ts"], ["Mention behavior change."], parserContext(), ["empty", "behavior"], ["empty", "behavior"]),
      promptCase(role, "release-contract", "Prepare contract release notes", "Summarize required User.email migration.", ["src/user.ts"], ["Mention downstream clients."], userContext(), ["email", "client"], ["email", "client"]),
      promptCase(role, "release-reset", "Prepare reset release notes", "Summarize reset token expiry enforcement.", ["src/reset.ts"], ["Mention security impact."], resetContext(), ["security", "expired"], ["security", "expired"]),
      promptCase(role, "release-cache", "Prepare cache release notes", "Summarize cache invalidation fix.", ["src/cache.ts"], ["Mention verification."], cacheContext(), ["cache", "verification"], ["cache", "verification"]),
    ],
  };

  return templates[role];
}

function promptCase(
  role: AgentRole,
  id: string,
  action: string,
  goal: string,
  relevantFiles: string[],
  constraints: string[],
  codeContext: Array<{ path: string; content: string }>,
  expectedTerms: string[],
  correctnessTerms: string[],
  correctnessKind: PromptCase["correctness"]["kind"] = "terms",
  payload?: unknown,
): PromptCase {
  return {
    id: `${role}-${id}`,
    role,
    action,
    goal,
    relevant_files: relevantFiles,
    constraints,
    code_context: codeContext,
    payload,
    expected_terms: expectedTerms,
    minimum_viable_tokens: role === "builder" ? 180 : role === "architect" ? 220 : 160,
    correctness: {
      kind: correctnessKind,
      terms: correctnessTerms,
    },
  };
}

function authContext(): Array<{ path: string; content: string }> {
  return [
    {
      path: "src/auth.ts",
      content:
        "export function validateToken(payload: { exp?: number; kind?: string }) {\n  if (payload.kind === 'refresh') return true;\n  return true;\n}\n",
    },
  ];
}

function parserContext(): Array<{ path: string; content: string }> {
  return [{ path: "src/parser.ts", content: "export function parseUser(input: string) {\n  return JSON.parse(input.trim());\n}\n" }];
}

function cacheContext(): Array<{ path: string; content: string }> {
  return [{ path: "src/cache.ts", content: "const cache = new Map<string, unknown>();\nexport const get = (k: string) => cache.get(k);\nexport const set = (k: string, v: unknown) => cache.set(k, v);\n" }];
}

function resetContext(): Array<{ path: string; content: string }> {
  return [{ path: "src/reset.ts", content: "export function canReset(token: { expiresAt: number }) {\n  return true;\n}\n" }];
}

function userContext(): Array<{ path: string; content: string }> {
  return [
    { path: "src/user.ts", content: "export interface User { id: string; email?: string; }\n" },
    { path: "src/client.ts", content: "import type { User } from './user.js';\nexport function label(user: User) { return user.email ?? user.id; }\n" },
  ];
}

function mathContext(): Array<{ path: string; content: string }> {
  return [{ path: "math.ts", content: "export function add(a: number, b: number): number {\n  return a + b;\n}\n" }];
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(new URL(process.argv[1], "file://")) === currentFile) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error).stack ?? (error as Error).message}\n`);
    process.exitCode = 1;
  });
}
