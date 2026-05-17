import { randomUUID } from "node:crypto";

export class TraceManager {
  private messageParents: Map<string, string> = new Map(); // msgId -> parentMsgId
  private messageTraces: Map<string, string> = new Map(); // msgId -> traceId

  startTrace(): string {
    return randomUUID();
  }

  linkMessage(messageId: string, traceId: string, parentMessageId?: string): void {
    this.messageTraces.set(messageId, traceId);
    if (parentMessageId) {
      this.messageParents.set(messageId, parentMessageId);
    }
  }

  getTraceId(messageId: string): string | undefined {
    return this.messageTraces.get(messageId);
  }

  getParentMessageId(messageId: string): string | undefined {
    return this.messageParents.get(messageId);
  }

  getChain(messageId: string): string[] {
    const chain: string[] = [];
    let current: string | undefined = messageId;
    while (current) {
      chain.push(current);
      current = this.messageParents.get(current);
    }
    return chain;
  }
}
