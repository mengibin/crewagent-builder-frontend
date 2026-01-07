import test = require("node:test");
import assert = require("node:assert/strict");

import { parseStepMarkdown, serializeStepMarkdown } from "../src/lib/step-parser";

test("parseStepMarkdown: parses frontmatter + sections", () => {
  const markdown = `---
schemaVersion: "1.1"
nodeId: "step-1"
type: "step"
title: "My Step"
agentId: "dev"
inputs:
  - a
outputs:
  - b
---

# My Step

## Goal

Do X.

## Instructions

Do Y.

## Completion (Document-as-State)

Update workflow.
`;

  const res = parseStepMarkdown(markdown);
  assert.equal(res.success, true);
  assert.ok(res.data);
  assert.equal(String(res.data.frontmatter.schemaVersion), "1.1");
  assert.equal(res.data.frontmatter.nodeId, "step-1");
  assert.equal(res.data.frontmatter.type, "step");
  assert.equal(res.data.frontmatter.title, "My Step");
  assert.equal(res.data.frontmatter.agentId, "dev");
  assert.deepEqual(res.data.frontmatter.inputs, ["a"]);
  assert.deepEqual(res.data.frontmatter.outputs, ["b"]);

  assert.equal(res.data.sections.goal, "Do X.");
  assert.equal(res.data.sections.instructions, "Do Y.");
  assert.equal(res.data.sections.completion, "Update workflow.");
});

test("parseStepMarkdown: errors on missing frontmatter", () => {
  const res = parseStepMarkdown("# No frontmatter\n\n## Goal\n\nx\n");
  assert.equal(res.success, false);
  assert.equal(res.error, "Missing YAML frontmatter.");
});

test("parseStepMarkdown: errors on unclosed frontmatter", () => {
  const res = parseStepMarkdown("---\nschemaVersion: \"1.1\"\nnodeId: x\n");
  assert.equal(res.success, false);
  assert.equal(res.error, "Frontmatter is not closed (missing ending `---`).");
});

test("parseStepMarkdown: errors on leading whitespace before frontmatter", () => {
  const res = parseStepMarkdown("\n---\nschemaVersion: \"1.1\"\nnodeId: x\ntype: step\n---\n");
  assert.equal(res.success, false);
  assert.equal(res.error, "Frontmatter must be at the beginning of the file (remove leading blank lines/spaces).");
});

test("serializeStepMarkdown: round-trips with parseStepMarkdown", () => {
  const markdown = serializeStepMarkdown({
    frontmatter: {
      schemaVersion: "1.1",
      nodeId: "step-2",
      type: "decision",
      title: "Decision Step",
      agentId: "dev",
      inputs: ["conversation_history"],
      outputs: ["result_json"],
    },
    sections: {
      goal: "Pick a branch.",
      instructions: "Decide wisely.",
      completion: "Update workflow.md.",
    },
    rawContent: "",
  });

  const res = parseStepMarkdown(markdown);
  assert.equal(res.success, true);
  assert.ok(res.data);
  assert.equal(res.data.frontmatter.nodeId, "step-2");
  assert.equal(res.data.frontmatter.type, "decision");
  assert.equal(res.data.sections.goal, "Pick a branch.");
  assert.equal(res.data.sections.instructions, "Decide wisely.");
  assert.equal(res.data.sections.completion, "Update workflow.md.");
});
