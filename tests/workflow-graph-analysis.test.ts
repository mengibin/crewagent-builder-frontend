import test = require("node:test");
import assert = require("node:assert/strict");

import { analyzeWorkflowGraph } from "../src/lib/workflow-graph-analysis";

test("analyzeWorkflowGraph: allows a controlled cycle and picks a decision entry", () => {
  const result = analyzeWorkflowGraph({
    nodes: [
      { id: "retry-check", type: "decision" },
      { id: "run-step", type: "step" },
      { id: "done", type: "end" },
    ],
    edges: [
      { from: "retry-check", to: "run-step" },
      { from: "run-step", to: "retry-check" },
      { from: "retry-check", to: "done" },
    ],
  });

  assert.deepEqual(result.cycleIssues, []);
  assert.equal(result.entryNodeId, "retry-check");
  assert.deepEqual(result.orderedNodeIds, ["retry-check", "run-step", "done"]);
});

test("analyzeWorkflowGraph: rejects a cycle without a decision node", () => {
  const result = analyzeWorkflowGraph({
    nodes: [
      { id: "step-a", type: "step" },
      { id: "step-b", type: "step" },
      { id: "done", type: "end" },
    ],
    edges: [
      { from: "step-a", to: "step-b" },
      { from: "step-b", to: "step-a" },
      { from: "step-b", to: "done" },
    ],
  });

  assert.ok(result.cycleIssues.some((issue) => issue.code === "cycle-missing-decision"));
});

test("analyzeWorkflowGraph: rejects a decision cycle that has no exit", () => {
  const result = analyzeWorkflowGraph({
    nodes: [
      { id: "retry-check", type: "decision" },
      { id: "run-step", type: "step" },
    ],
    edges: [
      { from: "retry-check", to: "run-step" },
      { from: "retry-check", to: "retry-check" },
      { from: "run-step", to: "retry-check" },
    ],
  });

  assert.ok(result.cycleIssues.some((issue) => issue.code === "cycle-missing-exit"));
  assert.equal(result.entryNodeId, "");
});
