export type WorkflowListItemForManifest = {
  id: number;
  name: string;
  isDefault?: boolean;
};

export type BmadManifestV11 = {
  schemaVersion: "1.1";
  name: string;
  version: string;
  createdAt: string;
  entry: {
    workflow: string;
    graph: string;
    agents: string;
    assetsDir?: string;
  };
  workflows: Array<{
    id: string;
    displayName?: string;
    workflow: string;
    graph: string;
    tags?: string[];
  }>;
};

export type BmadManifestBuildResult = {
  manifest: BmadManifestV11 | null;
  warnings: string[];
  errors: string[];
};

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function buildWorkflowPaths(id: string): { workflow: string; graph: string } {
  const base = `workflows/${id}`;
  return {
    workflow: `${base}/workflow.md`,
    graph: `${base}/workflow.graph.json`,
  };
}

export function formatBmadManifestV11(manifest: BmadManifestV11): string {
  return JSON.stringify(manifest, null, 2);
}

export function buildBmadManifestV11(params: {
  projectName: string;
  workflows: WorkflowListItemForManifest[];
  createdAt: string;
  version?: string;
}): BmadManifestBuildResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const rawName = params.projectName?.trim() ?? "";
  const name = rawName || "Untitled";
  if (!rawName) warnings.push('project.name is empty; fell back to "Untitled".');

  const workflows = Array.isArray(params.workflows) ? params.workflows : [];
  if (!workflows.length) {
    return { manifest: null, warnings, errors: ["workflows is empty: cannot generate bmad.json (need at least 1 workflow)."] };
  }

  const byId = new Map<number, WorkflowListItemForManifest>();
  for (const workflow of workflows) {
    if (!workflow) continue;
    if (byId.has(workflow.id)) {
      errors.push(`Duplicate workflowId: ${workflow.id}`);
      continue;
    }
    byId.set(workflow.id, workflow);
  }

  const ordered = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  if (!ordered.length) {
    return { manifest: null, warnings, errors: ["workflows has no valid entries: cannot generate bmad.json."] };
  }
  const normalizedIds = ordered.map((w) => String(w.id).trim());
  const invalidIds = normalizedIds.filter((id) => !id || !WORKFLOW_ID_PATTERN.test(id));
  if (invalidIds.length) {
    errors.push(`Invalid workflowId(s): ${invalidIds.join(", ")}`);
  }

  const createdAt = params.createdAt?.trim() ?? "";
  if (!createdAt) errors.push("createdAt is empty: cannot generate bmad.json.");

  const version = (params.version ?? "0.1.0").trim();
  if (!version) errors.push("version is empty: cannot generate bmad.json.");

  if (errors.length) return { manifest: null, warnings, errors };

  const defaults = ordered.filter((w) => w.isDefault === true);
  let entryWorkflow = defaults.sort((a, b) => a.id - b.id)[0] ?? null;
  if (defaults.length > 1) {
    warnings.push(`Multiple default workflows detected (chose smallest id): ${defaults.map((d) => d.id).join(", ")}`);
  }
  if (!entryWorkflow) {
    entryWorkflow = ordered[0] ?? null;
    warnings.push(`No default workflow set: chose workflowId=${entryWorkflow?.id ?? "unknown"} as entry.`);
  }

  const entryId = String(entryWorkflow?.id ?? "").trim();
  const entryPaths = buildWorkflowPaths(entryId);

  const workflowsIndex = ordered.map((wf) => {
    const id = String(wf.id).trim();
    const paths = buildWorkflowPaths(id);
    return {
      id,
      displayName: wf.name,
      workflow: paths.workflow,
      graph: paths.graph,
      tags: [],
    };
  });

  return {
    manifest: {
      schemaVersion: "1.1",
      name,
      version,
      createdAt,
      entry: {
        workflow: entryPaths.workflow,
        graph: entryPaths.graph,
        agents: "agents.json",
        assetsDir: "assets/",
      },
      workflows: workflowsIndex,
    },
    warnings,
    errors,
  };
}
