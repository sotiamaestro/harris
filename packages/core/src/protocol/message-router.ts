import type { AgentMessage, AgentResponse, Peer } from "../types/index.js";

export class MessageRouter {
  private peers: Map<string, Peer> = new Map();

  registerPeer(peer: Peer): void {
    this.peers.set(peer.identity.id, peer);
  }

  async route(message: AgentMessage): Promise<AgentResponse> {
    const targetId = typeof message.to === "string" ? message.to : message.to.id;

    if (targetId === "*") {
      throw new Error("Broadcast messaging is not yet supported in this version.");
    }

    const peer = this.peers.get(targetId);
    if (!peer) {
      throw new Error(`Target peer '${targetId}' is not registered in the message router.`);
    }

    return peer.invoke(message);
  }
}
