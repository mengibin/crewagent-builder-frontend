import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildPreviewModelFromChangeSet,
  buildValidationLabel,
  formatBudgetHint,
  normalizeRevisionBase,
} from "../src/lib/ai-workbench-model";

test("buildPreviewModelFromChangeSet: builds changed files + diff model + impact", () => {
  const changeSet = {
    schemaVersion: "1.0",
    targetType: "step",
    mode: "optimize",
    operations: [
      {
        op: "upsert",
        targetType: "step",
        target: { workflowId: 3, nodeId: "step-collect" },
        payload: {
          stepPath: "steps/step-collect.md",
          stepMarkdown: "---\nnodeId: step-collect\n---\n\n## Goal\nCollect v2\n",
        },
      },
      {
        op: "upsert",
        targetType: "asset",
        target: { path: "assets/templates/report.md" },
        payload: { content: "# Report\n\n- New\n" },
      },
    ],
  };

  const snapshot = {
    workflowMarkdownById: { "3": "---\nworkflow: old\n---\n" },
    stepMarkdownByPath: { "steps/step-collect.md": "---\nnodeId: step-collect\n---\n\n## Goal\nCollect v1\n" },
    stepPathByNodeId: { "step-collect": "steps/step-collect.md" },
    agentsById: {},
    assetsByPath: { "assets/templates/report.md": "# Report\n\n- Old\n" },
  };

  const preview = buildPreviewModelFromChangeSet(changeSet, snapshot);
  assert.equal(preview.files.length, 2);
  assert.equal(preview.files[0]?.path, "steps/step-collect.md");
  assert.equal(preview.files[0]?.changeType, "M");
  assert.equal(preview.files[1]?.path, "assets/templates/report.md");
  assert.equal(preview.files[1]?.changeType, "M");
  assert.ok(preview.diffByPath["steps/step-collect.md"]);
  assert.ok(preview.diffByPath["assets/templates/report.md"]);
  assert.equal(preview.impact.counts.step, 1);
  assert.equal(preview.impact.counts.asset, 1);
  assert.ok(preview.impact.riskFlags.includes("cross-object"));
});

test("buildValidationLabel + normalizeRevisionBase + formatBudgetHint", () => {
  assert.equal(
    buildValidationLabel({ valid: true, filesCount: 4, errorsCount: 0, warningsCount: 1 }),
    "4 files · validation passed · 1 warning",
  );
  assert.equal(
    buildValidationLabel({ valid: false, filesCount: 2, errorsCount: 3, warningsCount: 0 }),
    "Validation failed · 3 errors",
  );
  assert.deepEqual(normalizeRevisionBase(null), {
    workflowRevision: 1,
    agentsRevision: 1,
    assetsRevision: 1,
  });
  assert.equal(formatBudgetHint(8000, 16000), "Context budget: ~8000/16000 tokens (50%)");
});

test("buildPreviewModelFromChangeSet: normalizes legacy agent payload aliases", () => {
  const changeSet = {
    schemaVersion: "1.0",
    targetType: "agent",
    mode: "optimize",
    operations: [
      {
        op: "upsert",
        targetType: "agent",
        target: { agentId: "analyst" },
        payload: {
          name: "Analyst Pro",
          role: "coach",
          communicationStyle: "concise",
          agent: {
            persona: {
              identity: "Improved identity",
            },
          },
        },
      },
    ],
  };

  const snapshot = {
    workflowMarkdownById: {},
    stepMarkdownByPath: {},
    stepPathByNodeId: {},
    agentsById: {
      analyst: {
        id: "analyst",
        metadata: { name: "Analyst", title: "Business Analyst", icon: "bot" },
        persona: {
          role: "analysis",
          identity: "Extracts structured requirements.",
          communication_style: "direct",
          principles: ["be precise"],
        },
      },
    },
    assetsByPath: {},
  };

  const preview = buildPreviewModelFromChangeSet(changeSet, snapshot);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0]?.path, "agents/analyst.json");

  const diff = preview.diffByPath["agents/analyst.json"];
  assert.ok(diff);
  const after = JSON.parse(diff.after) as Record<string, unknown>;
  const metadata = after.metadata as Record<string, unknown>;
  const persona = after.persona as Record<string, unknown>;

  assert.equal(metadata.name, "Analyst Pro");
  assert.equal(persona.role, "coach");
  assert.equal(persona.identity, "Improved identity");
  assert.equal(persona.communication_style, "concise");
  assert.equal(after.name, undefined);
  assert.equal(after.role, undefined);
});
