import { describe, it, expect } from "vitest";
import { validateMessage, validateResponse } from "@harris/core";

describe("Message and Response Validation", () => {
  describe("validateMessage", () => {
    it("should validate a correct message", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: { id: "a1", role: "architect" },
        to: "*",
        trace_id: "t1",
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        budget: { total: 100, consumed: 0, remaining: 100, your_allocation: 50, zone: "green", warning_threshold: 0.75, hard_stop: 0.95 },
        metadata: { timestamp: 123, priority: 1, iteration: 1, max_iterations: 3 }
      };
      expect(validateMessage(msg)).toBe(true);
    });

    it("should validate message with object 'to'", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: { id: "a1", role: "architect" },
        to: { id: "a2", role: "builder" },
        trace_id: "t1",
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        budget: { total: 100, consumed: 0, remaining: 100, your_allocation: 50, zone: "green", warning_threshold: 0.75, hard_stop: 0.95 },
        metadata: { timestamp: 123, priority: 1, iteration: 1, max_iterations: 3 }
      };
      expect(validateMessage(msg)).toBe(true);
    });

    it("should fail if 'trace_id' is missing", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: { id: "a1", role: "architect" },
        to: { id: "a2", role: "builder" },
        // trace_id missing
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        budget: { total: 100, consumed: 0, remaining: 100, your_allocation: 50, zone: "green", warning_threshold: 0.75, hard_stop: 0.95 },
      };
      expect(validateMessage(msg)).toBe(false);
    });

    it("should fail if 'budget' is missing", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: { id: "a1", role: "architect" },
        to: { id: "a2", role: "builder" },
        trace_id: "t1",
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        // budget missing
      };
      expect(validateMessage(msg)).toBe(false);
    });

    it("should fail if 'from' is null", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: null,
        to: "*",
        trace_id: "t1",
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        budget: { total: 100, consumed: 0, remaining: 100, your_allocation: 50, zone: "green", warning_threshold: 0.75, hard_stop: 0.95 },
      };
      expect(validateMessage(msg)).toBe(false);
    });

    it("should fail if 'to' is null", () => {
      const msg = {
        message_id: "msg-1",
        type: "task",
        from: { id: "a1", role: "architect" },
        to: null,
        trace_id: "t1",
        action: "act",
        context: { goal: "g", relevant_files: [], constraints: [], prior_decisions: [], iteration: 1, max_iterations: 3 },
        budget: { total: 100, consumed: 0, remaining: 100, your_allocation: 50, zone: "green", warning_threshold: 0.75, hard_stop: 0.95 },
      };
      expect(validateMessage(msg)).toBe(false);
    });
  });

  describe("validateResponse", () => {
    it("should validate a correct response", () => {
      const res = {
        message_id: "res-1",
        in_response_to: "msg-1",
        trace_id: "t1",
        status: "complete",
        agent: { id: "a1", role: "builder" },
        result: { summary: "done" },
        next_actions: [],
        token_usage: { input: 1, output: 1, total: 2 },
        confidence: 1,
        flags: []
      };
      expect(validateResponse(res)).toBe(true);
    });

    it("should fail if 'status' is missing", () => {
      const res = {
        message_id: "res-1",
        in_response_to: "msg-1",
        trace_id: "t1",
        // status missing
        agent: { id: "a1", role: "builder" },
        result: { summary: "done" },
      };
      expect(validateResponse(res)).toBe(false);
    });
  });
});
