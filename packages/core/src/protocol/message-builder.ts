import { randomUUID } from "node:crypto";
import type { AgentIdentity, AgentMessage, MessageType, Priority, TaskContext } from "../types/messages.js";
import type { BudgetSnapshot } from "../types/budget.js";

export function createMessage<T>(
  type: MessageType,
  from: AgentIdentity,
  to: AgentIdentity | "*",
  action: string,
  context: TaskContext,
  budget: BudgetSnapshot,
  options?: {
    trace_id?: string;
    parent_message_id?: string;
    priority?: Priority;
    estimated_tokens?: number;
    payload?: T;
  }
): AgentMessage<T> {
  return {
    message_id: randomUUID(),
    type,
    from,
    to,
    trace_id: options?.trace_id ?? randomUUID(),
    parent_message_id: options?.parent_message_id,
    action,
    context,
    payload: options?.payload,
    budget,
    metadata: {
      timestamp: Date.now(),
      priority: options?.priority ?? 2,
      estimated_tokens: options?.estimated_tokens,
      iteration: context.iteration,
      max_iterations: context.max_iterations,
    },
  };
}
