import type { AgentMessage, AgentResponse } from "../types/messages.js";

export function validateMessage(message: unknown): message is AgentMessage {
  if (!message || typeof message !== "object") return false;
  const msg = message as Record<string, unknown>;
  
  return (
    typeof msg.message_id === "string" &&
    typeof msg.type === "string" &&
    typeof msg.from === "object" &&
    msg.from !== null &&
    ((typeof msg.to === "object" && msg.to !== null) || msg.to === "*") &&
    typeof msg.trace_id === "string" &&
    typeof msg.action === "string" &&
    typeof msg.context === "object" &&
    msg.context !== null &&
    typeof msg.budget === "object" &&
    msg.budget !== null
  );
}

export function validateResponse(response: unknown): response is AgentResponse {
  if (!response || typeof response !== "object") return false;
  const res = response as Record<string, unknown>;

  return (
    typeof res.message_id === "string" &&
    typeof res.in_response_to === "string" &&
    typeof res.trace_id === "string" &&
    typeof res.status === "string" &&
    typeof res.agent === "object" &&
    res.agent !== null &&
    typeof res.result === "object" &&
    res.result !== null
  );
}
