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
  assert.ok(res.errors.some((e) => e.includes("缺少 step 文件") || e.includes("stepFilesJson")));
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
  assert.ok(res.errors.some((e) => e.includes("不存在的 agentId")));
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
  assert.ok(res.errors.some((e) => e.includes("workflowId 不合法")));
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
  assert.ok(res.errors.some((e) => e.includes("stepFilesJson key 不合法")));
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
  assert.ok(res.errors.some((e) => e.includes("assets 路径不合法")));
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
  assert.ok(res.warnings.some((w) => w.includes("跳过非 assets/ 路径")));

  const zip = await JSZip.loadAsync(res.zipBytes);
  assert.ok(zip.file("assets/ok.txt"));
  assert.equal(zip.file("foo/bar.txt"), null);
});
