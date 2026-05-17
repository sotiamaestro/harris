import type { AgentMessage, AgentResponse, Peer } from "@harris/core";
import { MessageRouter } from "@harris/core";

export class MessageBus {
  private router = new MessageRouter();
  private history: AgentMessage[] = [];
  private responses: AgentResponse[] = [];

  registerPeer(peer: Peer): void {
    this.router.registerPeer(peer);
  }

  async send(message: AgentMessage): Promise<AgentResponse> {
    this.history.push(message);
    const response = await this.router.route(message);
    this.responses.push(response);
    return response;
  }

  getHistory(): AgentMessage[] {
    return [...this.history];
  }

  getResponses(): AgentResponse[] {
    return [...this.responses];
  }

  clear(): void {
    this.history = [];
    this.responses = [];
  }
}
