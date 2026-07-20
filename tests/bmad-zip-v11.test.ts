import test = require("node:test");
import assert = require("node:assert/strict");

import JSZip from "jszip";

import { buildAgentsManifestV11, formatAgentsManifestV11 } from "../src/lib/agents-manifest-v11";
import { buildBmadManifestV11, formatBmadManifestV11 } from "../src/lib/bmad-manifest-v11";
import { buildBmadZipBundleV11 } from "../src/lib/bmad-zip-v11";

function buildSampleManifests(): { bmadJson: string; agentsJson: string } {
  const bmad = buildBmadManifestV11({
    projectName: "My Project",
    workflows: [{ id: 1, name: "Main", isDefault: true }],
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
  });
  assert.ok(bmad.manifest);

  const agentsRaw = JSON.stringify({
    schemaVersion: "1.1",
    agents: [
      {
        id: "dev",
        metadata: { name: "Dev", title: "Developer", icon: "🧩" },
        persona: {
          role: "Developer",
          identity: "I write code",
          communication_style: "direct",
          principles: ["Ship"],
        },
      },
    ],
  });
  const agents = buildAgentsManifestV11({ agentsJsonRaw: agentsRaw });
  assert.ok(agents.manifest);

  return {
    bmadJson: formatBmadManifestV11(bmad.manifest),
    agentsJson: formatAgentsManifestV11(agents.manifest),
  };
}

test("buildBmadZipBundleV11: builds multi-workflow zip and rewrites node.file", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "---\nschemaVersion: \"1.1\"\nworkflowType: \"test\"\ncurrentNodeId: \"\"\nstepsCompleted: []\n---\n\n# Workflow\n",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1", agentId: "dev" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({
          "steps/step-1.md": "---\nschemaVersion: \"1.1\"\nnodeId: step-1\ntype: step\n---\n\nDo it.\n",
        }),
      },
    ],
  });

  assert.deepEqual(res.errors, []);
  assert.ok(res.zipBytes);

  const zip = await JSZip.loadAsync(res.zipBytes);
  const fileList = Object.keys(zip.files).sort();
  assert.ok(fileList.includes("bmad.json"));
  assert.ok(fileList.includes("agents.json"));
  assert.ok(fileList.includes("workflows/1/workflow.md"));
  assert.ok(fileList.includes("workflows/1/workflow.graph.json"));
  assert.ok(fileList.includes("workflows/1/steps/step-1.md"));

  const graphText = await zip.file("workflows/1/workflow.graph.json")!.async("string");
  const graph = JSON.parse(graphText) as { nodes: Array<{ id: string; file: string }> };
  assert.equal(graph.nodes[0]?.id, "step-1");
  assert.equal(graph.nodes[0]?.file, "workflows/1/steps/step-1.md");
});

test("buildBmadZipBundleV11: uses node.file from workflow graph as the step path", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [
            {
              id: "cost-calculation",
              type: "step",
              file: "steps/full-cost.md",
              data: { title: "Full cost calculation", agentId: "dev" },
            },
          ],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({
          "steps/full-cost.md": "---\nnodeId: cost-calculation\ntype: step\n---\n\nCalculate it.\n",
        }),
      },
    ],
  });

  assert.deepEqual(res.errors, []);
  assert.ok(res.zipBytes);

  const zip = await JSZip.loadAsync(res.zipBytes);
  assert.ok(zip.file("workflows/1/steps/full-cost.md"));

  const graphText = await zip.file("workflows/1/workflow.graph.json")!.async("string");
  const graph = JSON.parse(graphText) as { nodes: Array<{ id: string; file: string }> };
  assert.equal(graph.nodes[0]?.id, "cost-calculation");
  assert.equal(graph.nodes[0]?.file, "workflows/1/steps/full-cost.md");
});

test("buildBmadZipBundleV11: blocks export when a node references missing step file", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({}),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("missing step file") || e.includes("stepFilesJson")));
});

test("buildBmadZipBundleV11: blocks export when a node references unknown agentId", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1", agentId: "unknown" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({
          "steps/step-1.md": "ok",
        }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("unknown agentId")));
});

test("buildBmadZipBundleV11: blocks export when workflowId is invalid", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: -1,
        name: "Bad",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({ "steps/step-1.md": "ok" }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("invalid workflowId")));
});

test("buildBmadZipBundleV11: blocks export when bmad.json.entry points to missing file", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();
  const bmadObj = JSON.parse(bmadJson) as Record<string, unknown>;
  const entry = (bmadObj.entry ?? {}) as Record<string, unknown>;
  entry.workflow = "workflows/1/missing.md";
  bmadObj.entry = entry;

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson: JSON.stringify(bmadObj, null, 2),
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({ "steps/step-1.md": "ok" }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("bmad.json.entry")));
});

test("buildBmadZipBundleV11: exports a decision-controlled loop", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [
            { id: "retry-check", type: "decision", data: { title: "Retry Check", agentId: "dev" } },
            { id: "run-step", type: "step", data: { title: "Run Step", agentId: "dev" } },
            { id: "done", type: "end", data: { title: "Done", agentId: "dev" } },
          ],
          edges: [
            { source: "retry-check", target: "run-step", label: "retry", data: { isDefault: true } },
            { source: "run-step", target: "retry-check", label: "loop" },
            { source: "retry-check", target: "done", label: "done" },
          ],
        }),
        stepFilesJson: JSON.stringify({
          "steps/retry-check.md": "ok",
          "steps/run-step.md": "ok",
          "steps/done.md": "ok",
        }),
      },
    ],
  });

  assert.deepEqual(res.errors, []);
  assert.ok(res.zipBytes);

  const zip = await JSZip.loadAsync(res.zipBytes);
  const graphText = await zip.file("workflows/1/workflow.graph.json")!.async("string");
  const graph = JSON.parse(graphText) as { entryNodeId: string };
  assert.equal(graph.entryNodeId, "retry-check");
});

test("buildBmadZipBundleV11: blocks export when graph has multiple start nodes", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [
            { id: "collect", type: "step", data: { title: "Collect", agentId: "dev" } },
            { id: "review", type: "step", data: { title: "Review", agentId: "dev" } },
          ],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({
          "steps/collect.md": "ok",
          "steps/review.md": "ok",
        }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("multiple start nodes with indegree 0")));
});

test("buildBmadZipBundleV11: blocks export when a decision cycle has no exit", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [
            { id: "retry-check", type: "decision", data: { title: "Retry Check", agentId: "dev" } },
            { id: "run-step", type: "step", data: { title: "Run Step", agentId: "dev" } },
          ],
          edges: [
            { source: "retry-check", target: "run-step", label: "retry", data: { isDefault: true } },
            { source: "retry-check", target: "retry-check", label: "wait" },
            { source: "run-step", target: "retry-check", label: "loop" },
          ],
        }),
        stepFilesJson: JSON.stringify({
          "steps/retry-check.md": "ok",
          "steps/run-step.md": "ok",
        }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("add an edge that exits the loop")));
});

test("buildBmadZipBundleV11: blocks export when stepFilesJson keys are not under steps/", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({ "step-1.md": "ok" }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("invalid stepFilesJson key")));
});

test("buildBmadZipBundleV11: blocks export when assets path is unsafe", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    assets: { "assets/../evil.txt": "pwned" },
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({ "steps/step-1.md": "ok" }),
      },
    ],
  });

  assert.equal(res.zipBytes, null);
  assert.ok(res.errors.some((e) => e.includes("Invalid assets path")));
});

test("buildBmadZipBundleV11: skips non-assets paths in assets map", async () => {
  const { bmadJson, agentsJson } = buildSampleManifests();

  const res = await buildBmadZipBundleV11({
    projectName: "My Project",
    bmadJson,
    agentsJson,
    assets: { "foo/bar.txt": "x", "assets/ok.txt": "y" },
    workflows: [
      {
        id: 1,
        name: "Main",
        workflowMd: "x",
        graphJson: JSON.stringify({
          nodes: [{ id: "step-1", type: "step", data: { title: "Step 1" } }],
          edges: [],
        }),
        stepFilesJson: JSON.stringify({ "steps/step-1.md": "ok" }),
      },
    ],
  });

  assert.ok(res.zipBytes);
  assert.ok(res.warnings.some((w) => w.includes("Skipped non-assets/ path")));

  const zip = await JSZip.loadAsync(res.zipBytes);
  assert.ok(zip.file("assets/ok.txt"));
  assert.equal(zip.file("foo/bar.txt"), null);
});
