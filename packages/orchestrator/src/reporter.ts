import type { AgentMessage, AgentResponse } from "@harris/core";

export class SwarmReporter {
  reportTaskStarted(message: AgentMessage): void {
    const toName = typeof message.to === "string" ? message.to : message.to.role.toUpperCase();
    console.log(
      `\x1b[36m[TASK] [${message.from.role.toUpperCase()} -> ${toName}] Action: "${
        message.action
      }" (Trace: ${message.trace_id.slice(0, 8)})\x1b[0m`,
    );
  }

  reportResponseReceived(response: AgentResponse): void {
    const color = response.status === "complete" ? "\x1b[32m" : "\x1b[31m";
    console.log(
      `${color}[RESPONSE] [${response.agent.role.toUpperCase()}] Status: ${response.status.toUpperCase()} | Confidence: ${
        response.confidence
      } (Trace: ${response.trace_id.slice(0, 8)})\n` +
        `Summary: ${response.result.summary}\x1b[0m`,
    );
    if (response.result.changes && response.result.changes.length > 0) {
      console.log(
        `\x1b[33mChanges: ${response.result.changes
          .map((c) => `${c.action.toUpperCase()} ${c.file}`)
          .join(", ")}\x1b[0m`,
      );
    }
  }

  reportError(error: Error): void {
    console.error(`\x1b[41m\x1b[37m[CRITICAL ERROR] ${error.message}\x1b[0m`);
  }
}
