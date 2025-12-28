import JSZip from "jszip";

import { buildWorkflowGraphV11, type BuilderGraphEdge, type BuilderGraphNode, type WorkflowGraphV11 } from "./workflow-graph-v11";

export type WorkflowDetailForExportV11 = {
  id: number;
  name: string;
  workflowMd: string;
  graphJson: string;
  stepFilesJson: string;
};

export type PackageAssetsV11 = Record<string, string | Uint8Array>;

export type ExportFilesByPathV11 = Record<string, string | Uint8Array>;

export type BmadExportFilesV11BuildResult = {
  filename: string;
  filesByPath: ExportFilesByPathV11 | null;
  errors: string[];
  warnings: string[];
};

export type BmadZipBundleV11BuildResult = {
  filename: string;
  zipBytes: Uint8Array | null;
  errors: string[];
  warnings: string[];
};

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function normalizeZipPath(input: string): string {
  return input.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isSafeZipPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\u0000")) return false;
  if (path.split("/").some((part) => part === ".." || part === "." || part.length === 0)) return false;
  return true;
}

export function sanitizeFilename(input: string): string {
  const raw = input.trim() || "Untitled";
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  const base = cleaned || "Untitled";
  return base.length > 120 ? base.slice(0, 120).trim() : base;
}

function parseJsonObject(raw: string, label: string, errors: string[]): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.push(`${label} 为空`);
    return null;
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} 格式不正确（应为对象）`);
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    errors.push(`${label} 解析失败（非法 JSON）`);
    return null;
  }
}

function parseStepFilesJson(raw: string, workflowLabel: string, errors: string[]): Record<string, string> | null {
  const obj = parseJsonObject(raw, `${workflowLabel}.stepFilesJson`, errors);
  if (!obj) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k !== "string") continue;
    if (typeof v !== "string") {
      errors.push(`${workflowLabel}.stepFilesJson 中存在非字符串内容：${k}`);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function parseBuilderGraphJson(raw: string, workflowLabel: string, errors: string[]): { nodes: BuilderGraphNode[]; edges: BuilderGraphEdge[] } | null {
  const obj = parseJsonObject(raw, `${workflowLabel}.graphJson`, errors);
  if (!obj) return null;

  const nodesRaw = obj.nodes;
  const edgesRaw = obj.edges;
  const nodes = Array.isArray(nodesRaw) ? (nodesRaw as BuilderGraphNode[]) : [];
  const edges = Array.isArray(edgesRaw) ? (edgesRaw as BuilderGraphEdge[]) : [];
  if (!nodes.length) {
    errors.push(`${workflowLabel}.graphJson.nodes 为空`);
    return null;
  }
  return { nodes, edges };
}

function extractEntryPaths(bmadJson: Record<string, unknown>, errors: string[]): { workflow: string; graph: string; agents: string } | null {
  const entry = bmadJson.entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push("bmad.json.entry 缺失或不合法");
    return null;
  }
  const entryObj = entry as Record<string, unknown>;
  const workflow = typeof entryObj.workflow === "string" ? entryObj.workflow.trim() : "";
  const graph = typeof entryObj.graph === "string" ? entryObj.graph.trim() : "";
  const agents = typeof entryObj.agents === "string" ? entryObj.agents.trim() : "";
  if (!workflow || !graph || !agents) {
    errors.push("bmad.json.entry.workflow/graph/agents 缺失");
    return null;
  }
  return { workflow, graph, agents };
}

export async function buildZipBytesFromFiles(filesByPath: ExportFilesByPathV11): Promise<Uint8Array> {
  const zip = new JSZip();
  Object.entries(filesByPath).forEach(([path, value]) => {
    zip.file(path, value);
  });
  return zip.generateAsync({ type: "uint8array" });
}

export function buildBmadExportFilesV11(params: {
  projectName: string;
  bmadJson: string;
  agentsJson: string;
  workflows: WorkflowDetailForExportV11[];
  assets?: PackageAssetsV11;
}): BmadExportFilesV11BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const projectName = params.projectName?.trim() ?? "";
  const filename = `${sanitizeFilename(projectName)}.bmad`;

  const bmadObj = parseJsonObject(params.bmadJson, "bmad.json", errors);
  const agentsObj = parseJsonObject(params.agentsJson, "agents.json", errors);
  if (!bmadObj || !agentsObj) {
    return { filename, filesByPath: null, errors, warnings };
  }

  const entryPaths = extractEntryPaths(bmadObj, errors);
  if (!entryPaths) {
    return { filename, filesByPath: null, errors, warnings };
  }

  const agentsValue = agentsObj.agents;
  const agents = Array.isArray(agentsValue) ? (agentsValue as Array<Record<string, unknown>>) : [];
  const agentIds = new Set(
    agents
      .map((a) => (a && typeof a === "object" && !Array.isArray(a) ? (a.id as unknown) : null))
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );

  const workflows = Array.isArray(params.workflows) ? params.workflows : [];
  if (!workflows.length) {
    return { filename, filesByPath: null, errors: ["没有可导出的 workflow（workflows 为空）"], warnings };
  }

  const filesByPath: ExportFilesByPathV11 = {};
  const filePaths = new Set<string>();

  filesByPath["bmad.json"] = params.bmadJson;
  filePaths.add("bmad.json");

  filesByPath["agents.json"] = params.agentsJson;
  filePaths.add("agents.json");

  const assets = params.assets ?? null;
  if (assets) {
    for (const [rawPath, value] of Object.entries(assets)) {
      const normalized = normalizeZipPath(rawPath);
      if (!normalized.startsWith("assets/")) {
        warnings.push(`跳过非 assets/ 路径：${normalized}`);
        continue;
      }
      if (!isSafeZipPath(normalized)) {
        errors.push(`assets 路径不合法：${normalized}`);
        continue;
      }
      filesByPath[normalized] = value;
      filePaths.add(normalized);
    }
  }

  for (const wf of workflows) {
    const workflowId = String(wf.id).trim();
    const workflowLabel = `workflow(${wf.name || workflowId},ID:${wf.id})`;
    if (!workflowId || !WORKFLOW_ID_PATTERN.test(workflowId)) {
      errors.push(`${workflowLabel} 的 workflowId 不合法：${workflowId}`);
      continue;
    }

    const workflowMd = wf.workflowMd?.trim() ?? "";
    if (!workflowMd) {
      errors.push(`${workflowLabel} 缺少 workflowMd：请在 Editor 保存以生成 v1.1 workflow.md`);
      continue;
    }
    const workflowMdPath = `workflows/${workflowId}/workflow.md`;
    filesByPath[workflowMdPath] = wf.workflowMd;
    filePaths.add(workflowMdPath);

    const stepFiles = parseStepFilesJson(wf.stepFilesJson ?? "", workflowLabel, errors);
    const graphPayload = parseBuilderGraphJson(wf.graphJson ?? "", workflowLabel, errors);
    if (!stepFiles || !graphPayload) continue;

    const stepFilesNormalized: Record<string, string> = {};
    for (const [rawKey, content] of Object.entries(stepFiles)) {
      const key = normalizeZipPath(rawKey);
      if (!key.startsWith("steps/")) {
        errors.push(`${workflowLabel} 的 stepFilesJson key 不合法（必须以 steps/ 开头）：${key}`);
        continue;
      }
      if (!isSafeZipPath(key)) {
        errors.push(`${workflowLabel} 的 stepFilesJson key 不合法：${key}`);
        continue;
      }
      if (!content.trim()) {
        errors.push(`${workflowLabel} 的 step 文件内容为空：${key}`);
        continue;
      }
      stepFilesNormalized[key] = content;
    }

    const stepFullPaths = new Set<string>();
    for (const [key, content] of Object.entries(stepFilesNormalized)) {
      const fullPath = `workflows/${workflowId}/${key}`;
      filesByPath[fullPath] = content;
      filePaths.add(fullPath);
      stepFullPaths.add(fullPath);
    }

    const graphBuild = buildWorkflowGraphV11({
      nodes: graphPayload.nodes,
      edges: graphPayload.edges,
    });
    if (!graphBuild.graph) {
      errors.push(`${workflowLabel} 无法生成 workflow.graph.json：${graphBuild.errors.join("；")}`);
      continue;
    }
    graphBuild.warnings.forEach((w) => warnings.push(`${workflowLabel}: ${w}`));

    const rewrittenNodes: WorkflowGraphV11["nodes"] = graphBuild.graph.nodes.map((node) => {
      const file = normalizeZipPath(node.file);
      if (!file.startsWith("steps/")) {
        errors.push(`${workflowLabel} node.file 不合法（必须以 steps/ 开头）：${node.id}:${file}`);
      } else if (!isSafeZipPath(file)) {
        errors.push(`${workflowLabel} node.file 不合法：${node.id}:${file}`);
      } else if (!stepFilesNormalized[file]) {
        errors.push(`${workflowLabel} 缺少 step 文件：${file}（nodeId=${node.id}）`);
      } else {
        const full = `workflows/${workflowId}/${file}`;
        if (!stepFullPaths.has(full)) {
          errors.push(`${workflowLabel} ZIP 中缺少 step 文件：${full}`);
        }
      }

      const agentId = node.agentId?.trim() ?? "";
      if (agentId && !agentIds.has(agentId)) {
        errors.push(`${workflowLabel} 引用了不存在的 agentId：${agentId}（nodeId=${node.id}）`);
      }

      return {
        ...node,
        file: `workflows/${workflowId}/${file}`,
      };
    });

    const exportedGraph: WorkflowGraphV11 = {
      ...graphBuild.graph,
      nodes: rewrittenNodes,
    };

    const graphPath = `workflows/${workflowId}/workflow.graph.json`;
    filesByPath[graphPath] = JSON.stringify(exportedGraph, null, 2);
    filePaths.add(graphPath);
  }

  if (errors.length) {
    return { filename, filesByPath: null, errors, warnings };
  }

  const expected = [entryPaths.workflow, entryPaths.graph, entryPaths.agents].map(normalizeZipPath);
  expected.forEach((path) => {
    if (!filePaths.has(path)) errors.push(`ZIP 缺少 bmad.json.entry 指向的文件：${path}`);
  });

  if (errors.length) {
    return { filename, filesByPath: null, errors, warnings };
  }

  return { filename, filesByPath, errors, warnings };
}

export async function buildBmadZipBundleV11(params: {
  projectName: string;
  bmadJson: string;
  agentsJson: string;
  workflows: WorkflowDetailForExportV11[];
  assets?: PackageAssetsV11;
}): Promise<BmadZipBundleV11BuildResult> {
  const build = buildBmadExportFilesV11(params);
  if (!build.filesByPath) {
    return { filename: build.filename, zipBytes: null, errors: build.errors, warnings: build.warnings };
  }

  try {
    const zipBytes = await buildZipBytesFromFiles(build.filesByPath);
    return { filename: build.filename, zipBytes, errors: build.errors, warnings: build.warnings };
  } catch {
    return { filename: build.filename, zipBytes: null, errors: ["导出失败：无法生成 ZIP bytes"], warnings: build.warnings };
  }
}
