<div align="center">

```
██╗  ██╗ █████╗ ██████╗ ██████╗ ██╗███████╗
██║  ██║██╔══██╗██╔══██╗██╔══██╗██║██╔════╝
███████║███████║██████╔╝██████╔╝██║███████╗
██╔══██║██╔══██║██╔══██╗██╔══██╗██║╚════██║
██║  ██║██║  ██║██║  ██║██║  ██║██║███████║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
```

### Autonomous Agent Swarm Framework

**Agents don't need humans. They need each other.**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Gemini](https://img.shields.io/badge/Gemini_2.5-Pro_%7C_Flash-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

[Quick Start](#quick-start) · [Architecture](#architecture) · [Agent Roles](#agent-roles) · [How It Works](#how-it-works) · [Docs](#documentation)

</div>

---

## What is this?

**harris** is a framework where AI agents collaborate on your codebase autonomously. No chat interface. No human-in-the-loop. You give it a goal, and a swarm of specialist agents - Architect, Analyst, Builder, Reviewer, Tester, Debugger, Release - figure it out together.

Each agent invokes the others as peers. The Builder asks the Analyst for context. The Reviewer rejects the Builder's code and sends it back with feedback. The Tester finds a bug and routes it to the Debugger. The Architect resolves disagreements using first principles. All of this happens without you touching anything.

```typescript
import { createHarris } from "@harris/orchestrator";

const harris = await createHarris({
  gemini_api_key: process.env.GEMINI_API_KEY,
  codebase_path: "./my-project",
  budget: { total: 2_000_000 },
});

const result = await harris.run(
  "Refactor the auth module from callbacks to async/await",
  [
    "All callback functions converted to async/await",
    "No changes to public API signatures",
    "All existing tests pass",
  ]
);
```

That's it. The swarm handles decomposition, implementation, review, testing, and release.

---

## Why this exists

Every multi-agent framework today is hub-and-spoke. A human types a prompt. An orchestrator delegates to sub-agents. Results come back to the human. The human decides what's next.

```
                    ┌──────────┐
          ┌────────>│ Agent A  │────────┐
          │         └──────────┘        │
   ┌──────┴──┐                    ┌─────▼────┐
   │  Human  │                    │Orchestrator│
   └──────┬──┘                    └─────┬────┘
          │         ┌──────────┐        │
          └────────>│ Agent B  │────────┘
                    └──────────┘

              Most frameworks. Human is the glue.
```

**harris** removes the human from the loop entirely. Agents are the glue.

```
   ┌────────────┐      ┌───────────┐      ┌────────────┐
   │  Architect │◄────►│  Analyst  │◄────►│  Builder   │
   └─────┬──────┘      └───────────┘      └──────┬─────┘
         │                                        │
         │             ┌───────────┐              │
         └────────────►│ Reviewer  │◄─────────────┘
                       └─────┬─────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
          ┌──────────┐ ┌──────────┐ ┌──────────┐
          │  Tester  │ │ Debugger │ │ Release  │
          └──────────┘ └──────────┘ └──────────┘

              harris. Agents invoke each other.
```

MCP is agent-to-tool. Google A2A is HTTP-only and assumes cloud. **harris** is peer-to-peer, edge-compatible, and built for codebases.

---

## Quick Start

### Install

```bash
git clone https://github.com/sotiamaestro/harris.git
cd harris
pnpm install
pnpm build
```

### Run the example

```bash
# With live Gemini API
GEMINI_API_KEY=your_key npx tsx examples/simple-refactor/run.ts

# Offline mode (mocked agents)
npx tsx examples/simple-refactor/run.ts
```

### Run tests

```bash
pnpm test                                           # unit tests
GEMINI_API_KEY=your_key pnpm test:integration       # live API tests
pnpm lint                                           # biome checks
```

---

## Architecture

harris is a monorepo with four packages. Each has a single responsibility.

```
@harris/core            Protocol types, message system, budget tracking,
                        loop detection, conflict resolution, audit logging

@harris/codebase        Filesystem abstraction with optimistic concurrency,
                        version tracking, file attribution, code search

@harris/gemini          Gemini API integration, prompt assembly, response
                        parsing, role-specific system prompts

@harris/orchestrator    Swarm runtime - message routing, lifecycle
                        management, goal execution, graceful shutdown
```

### Design principles

The framework is built on five first principles, applied in strict priority order:

| Priority | Principle | Meaning |
|----------|-----------|---------|
| P1 | **Correctness** | Does it work? Non-negotiable. |
| P2 | **Simplicity** | Simplest correct solution wins. |
| P3 | **Maintainability** | Will someone understand this in 6 months? |
| P4 | **Performance** | Fast enough is fast enough. |
| P5 | **Security** | Never introduce vulnerabilities. |

When agents disagree, they cite these principles. The Architect resolves conflicts by applying the hierarchy. P1 beats P4. Always.

---

## Agent Roles

Seven specialist agents, each with a defined scope and authority level.

### Architect `gemini-2.5-pro`
Final decision-maker. Decomposes goals into sub-tasks, allocates token budgets, resolves conflicts between agents. Does not write code. Thinks, decides, directs.

### Analyst `gemini-2.5-pro`
The understanding engine. Reads the codebase deeply - dependencies, invariants, failure modes, patterns. Produces specs that the Builder executes. Advisory authority only.

### Builder `gemini-2.5-flash`
Writes code. Follows specs from the Analyst and constraints from the Architect. Self-verifies before submitting. Integrates feedback from the Reviewer without complaint.

### Reviewer `gemini-2.5-flash`
Quality gate. Code does not advance without approval. Finds bugs that pass CI but break production. Focuses on correctness, not style.

### Tester `gemini-2.5-flash`
Proof engine. Writes and runs tests against every acceptance criterion and edge case. Routes failures to the Debugger or back to the Builder.

### Debugger `gemini-2.5-flash`
Forensic diagnostician. Traces from symptom to root cause. Produces a diagnosis - never guesses, never patches without understanding.

### Release `gemini-2.5-flash`
Shipping gate. Pre-flight checks, changelog generation, commit preparation, post-ship reporting. Does not override failed tests.

---

## How It Works

### 1. Goal decomposition
You provide a goal and acceptance criteria. The Architect breaks it into sub-tasks with file scopes, constraints, and token allocations.

### 2. Autonomous execution
Agents invoke each other through structured JSON messages. The Builder asks the Analyst for file context. The Reviewer rejects bad code and sends feedback. The Tester finds bugs and routes them. No human intervention.

### 3. Failure recovery
When the Builder's code is rejected, it receives specific feedback and rewrites. When tests fail, the Debugger diagnoses the root cause. When agents loop, the system detects it and escalates to the Architect.

### 4. Token budget management
Every agent is aware of the shared token budget. As consumption increases, agents shift behavior:

| Zone | Consumed | Behavior |
|------|----------|----------|
| 🟢 Green | < 50% | Full exploration, thorough analysis |
| 🟡 Yellow | 50-75% | Tightened focus, targeted prompts |
| 🟠 Orange | 75-90% | Finish current task only, no new work |
| 🔴 Red | > 90% | Complete and stop, produce status report |

### 5. Conflict resolution
When agents disagree, each states a position citing first principles. The Architect evaluates and rules. The best argument wins - not the majority. Rulings are logged with full reasoning.

### 6. Optimistic concurrency
Multiple agents can work on different files simultaneously. File changes carry version hashes. If two agents modify the same file, the second detects the conflict and rebases or escalates.

---

## Live Telemetry

Real output from a live Gemini swarm run:

```
[TASK]     [ARCHITECT -> ARCHITECT] Action: "decompose_goal"
[RESPONSE] [ARCHITECT] Status: COMPLETE | Confidence: 0.98
           Decomposed refactoring goal into analysis and implementation tasks.

[TASK]     [ARCHITECT -> ANALYST] Action: "Analyze auth.ts for refactoring spec"
[RESPONSE] [ANALYST] Status: COMPLETE | Confidence: 1.0
           Produced specification for callback-to-async/await refactoring.

[TASK]     [ANALYST -> BUILDER] Action: "Implement refactoring per spec"
[RESPONSE] [BUILDER] Status: NEEDS_PEER | Confidence: 1.0
           Requires file content to proceed. Invoking Analyst.

[TASK]     [BUILDER -> ANALYST] Action: "Provide auth.ts content"
[RESPONSE] [ANALYST] Status: COMPLETE | Confidence: 1.0
           Retrieved and analyzed file content.

================ Swarm Result ================
Goal Status: COMPLETE
Total Tokens: 29,399
Changes: auth.ts refactored to async/await
```

Agents autonomously identified missing context, delegated to peers, and completed the task without human intervention.

---

## Configuration

```typescript
const harris = await createHarris({
  gemini_api_key: process.env.GEMINI_API_KEY,
  codebase_path: "./my-project",

  budget: {
    total: 2_000_000,          // total token budget
    warning_threshold: 0.75,    // yellow -> orange transition
    hard_stop: 0.95,            // system shutdown threshold
    per_agent_default: 200_000, // default allocation per task
    reserve_percentage: 0.10,   // held for conflict resolution
  },

  convergence: {
    max_iterations_per_task: 3,  // prevent infinite rewrites
    max_total_invocations: 50,   // cap on total agent calls
    loop_detection_window: 5,    // check last N messages for loops
  },
});
```

---

## Project Structure

```
harris/
├── packages/
│   ├── core/           # Types, protocol, budget, convergence, audit
│   ├── codebase/       # Filesystem ops, versioning, attribution
│   ├── gemini/         # LLM integration, prompts, roles
│   └── orchestrator/   # Swarm runtime, message bus, lifecycle
├── examples/
│   └── simple-refactor/
├── tests/
│   ├── message.test.ts
│   ├── budget.test.ts
│   ├── convergence.test.ts
│   ├── codebase.test.ts
│   └── failure-scenarios.test.ts
└── docs/
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | System design, message flow, design decisions |
| [Getting Started](docs/getting-started.md) | Setup, first run, configuration |
| [Agent Roles](docs/agent-roles.md) | Detailed role specs and prompt architecture |
| [Budget Management](docs/budget-management.md) | Token tracking, zones, allocation strategies |
| [Extending Agents](docs/extending-agents.md) | Adding custom roles, swapping LLM backends |

---

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20+
- **LLM**: Google Gemini 2.5 (Pro for reasoning, Flash for execution)
- **Build**: tsup + pnpm workspaces
- **Test**: vitest
- **Lint**: biome
- **Dependencies**: Minimal. `@google/generative-ai`, `uuid`, native `node:` modules only.

---

## Roadmap

- [ ] Pluggable LLM backends (Claude, GPT, local models)
- [ ] Parallel Builder execution for independent tasks
- [ ] Web dashboard for real-time swarm telemetry
- [ ] Git integration (auto-commit, auto-PR)
- [ ] Plugin system for custom agent roles
- [ ] VS Code extension

---

## Contributing

PRs welcome. The codebase follows Torvalds' philosophy: minimal, obvious, correct. No clever abstractions. No `any` types. Guard clauses over nested conditionals.

```bash
pnpm install
pnpm test
pnpm lint
```

---

## License

MIT

---

<div align="center">

*Sic Parvis Magna*

Built by [Harris Robinson](https://github.com/sotiamaestro)

</div>
