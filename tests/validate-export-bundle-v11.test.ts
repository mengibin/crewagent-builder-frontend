import test = require("node:test");
import assert = require("node:assert/strict");

import { buildAgentsManifestV11, formatAgentsManifestV11 } from "../src/lib/agents-manifest-v11";
import { buildBmadManifestV11, formatBmadManifestV11 } from "../src/lib/bmad-manifest-v11";
import { buildBmadExportFilesV11 } from "../src/lib/bmad-zip-v11";
import { validateExportBundleV11 } from "../src/lib/export/validate-export-bundle-v11";

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

function buildValidExportFiles(): Record<string, string | Uint8Array> {
  const { bmadJson, agentsJson } = buildSampleManifests();
  const res = buildBmadExportFilesV11({
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
  assert.ok(res.filesByPath);
  return res.filesByPath ?? {};
}

test("validateExportBundleV11: passes for valid export files", () => {
  const filesByPath = buildValidExportFiles();
  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, true);
  assert.deepEqual(res.issues, []);
});

test("validateExportBundleV11: reports frontmatter schema errors with filePath + pointers", () => {
  const filesByPath = buildValidExportFiles();
  filesByPath["workflows/1/steps/step-1.md"] = "---\nschemaVersion: \"1.1\"\nnodeId: step-1\n---\n\nDo it.\n";

  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.filePath === "workflows/1/steps/step-1.md"));
  assert.ok(res.issues.some((i) => typeof i.schemaPath === "string" && i.schemaPath.length > 0));
});

test("validateExportBundleV11: reports missing frontmatter as actionable error", () => {
  const filesByPath = buildValidExportFiles();
  filesByPath["workflows/1/workflow.md"] = "# Workflow\n";

  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.filePath === "workflows/1/workflow.md" && i.message.includes("缺少 frontmatter")));
});

test("validateExportBundleV11: reports unclosed frontmatter as actionable error", () => {
  const filesByPath = buildValidExportFiles();
  filesByPath["workflows/1/steps/step-1.md"] = "---\nschemaVersion: \"1.1\"\nnodeId: step-1\ntype: step\n\nDo it.\n";

  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.filePath === "workflows/1/steps/step-1.md" && i.message.includes("未闭合")));
});

test("validateExportBundleV11: reports leading whitespace before frontmatter as actionable error", () => {
  const filesByPath = buildValidExportFiles();
  filesByPath["workflows/1/steps/step-1.md"] =
    "\n---\nschemaVersion: \"1.1\"\nnodeId: step-1\ntype: step\n---\n\nDo it.\n";

  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.filePath === "workflows/1/steps/step-1.md" && i.message.includes("前置空行")));
});

test("validateExportBundleV11: reports additionalProperties with hint", () => {
  const filesByPath = buildValidExportFiles();
  const bmad = JSON.parse(filesByPath["bmad.json"] as string) as Record<string, unknown>;
  (bmad as Record<string, unknown>).oops = true;
  filesByPath["bmad.json"] = JSON.stringify(bmad, null, 2);

  const res = validateExportBundleV11({ filesByPath });
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.filePath === "bmad.json" && (i.hint ?? "").includes("oops")));
});
