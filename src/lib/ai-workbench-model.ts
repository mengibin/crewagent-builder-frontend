import type { AiChangeSetPayload, RevisionBase } from "@/lib/ai-workbench-client";

export type ChangeOperation = {
  op: string;
  targetType: string;
  target: Record<string, unknown>;
  payload?: Record<string, unknown> | null;
};

export type WorkbenchChangedFileItem = {
  path: string;
  changeType: "A" | "M" | "D";
  targetType: string;
};

export type WorkbenchDiffModel = {
  path: string;
  before: string;
  after: string;
  added: number;
  removed: number;
};

export type WorkbenchImpactCounts = {
  workflow: number;
  step: number;
  agent: number;
  asset: number;
};

export type WorkbenchImpactSummary = {
  objects: string[];
  counts: WorkbenchImpactCounts;
  riskFlags: string[];
  requiresConfirmation: boolean;
};

export type WorkbenchPreviewModel = {
  files: WorkbenchChangedFileItem[];
  diffByPath: Record<string, WorkbenchDiffModel>;
  impact: WorkbenchImpactSummary;
};

export type WorkbenchSnapshotState = {
  workflowMarkdownById: Record<string, string>;
  stepMarkdownByPath: Record<string, string>;
  stepPathByNodeId: Record<string, string>;
  agentsById: Record<string, Record<string, unknown>>;
  assetsByPath: Record<string, string>;
};

const TARGET_ORDER: Record<string, number> = {
  workflow: 0,
  step: 1,
  agent: 2,
  asset: 3,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function deepMergeRecords(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    const existingRecord = asRecord(existing);
    const valueRecord = asRecord(value);
    if (existingRecord && valueRecord) {
      merged[key] = deepMergeRecords(existingRecord, valueRecord);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizeAgentPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const wrappedAgent = asRecord(payload.agent);
  const candidate: Record<string, unknown> = wrappedAgent ? { ...wrappedAgent } : {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "agent") continue;
    candidate[key] = value;
  }

  const metadata = asRecord(candidate.metadata) ? { ...(candidate.metadata as Record<string, unknown>) } : {};
  const persona = asRecord(candidate.persona) ? { ...(candidate.persona as Record<string, unknown>) } : {};
  const tools = asRecord(candidate.tools) ? { ...(candidate.tools as Record<string, unknown>) } : {};

  if (typeof metadata.source_id === "string" && typeof metadata.sourceId !== "string") {
    metadata.sourceId = metadata.source_id;
  }
  if (typeof persona.communicationStyle === "string" && typeof persona.communication_style !== "string") {
    persona.communication_style = persona.communicationStyle;
  }

  const take = (key: string): { present: boolean; value: unknown } => {
    const present = Object.prototype.hasOwnProperty.call(candidate, key);
    const value = present ? candidate[key] : undefined;
    if (present) delete candidate[key];
    return { present, value };
  };

  for (const [rawKey, normalizedKey] of [
    ["name", "name"],
    ["title", "title"],
    ["icon", "icon"],
    ["module", "module"],
    ["description", "description"],
    ["sourceId", "sourceId"],
    ["source_id", "sourceId"],
  ]) {
    const { present, value } = take(rawKey);
    if (!present) continue;
    if (typeof value === "string") metadata[normalizedKey] = value;
  }

  for (const [rawKey, normalizedKey] of [
    ["role", "role"],
    ["identity", "identity"],
    ["communication_style", "communication_style"],
    ["communicationStyle", "communication_style"],
    ["principles", "principles"],
  ]) {
    const { present, value } = take(rawKey);
    if (!present) continue;
    if (normalizedKey === "principles") {
      if (typeof value === "string" || Array.isArray(value)) persona[normalizedKey] = value;
      continue;
    }
    if (typeof value === "string") persona[normalizedKey] = value;
  }

  const fsValue = take("fs").value;
  const fsRecord = asRecord(fsValue);
  if (fsRecord) {
    const fsBase = asRecord(tools.fs) ? (tools.fs as Record<string, unknown>) : {};
    tools.fs = deepMergeRecords(fsBase, fsRecord);
  }

  const mcpValue = take("mcp").value;
  const mcpRecord = asRecord(mcpValue);
  if (mcpRecord) {
    const mcpBase = asRecord(tools.mcp) ? (tools.mcp as Record<string, unknown>) : {};
    tools.mcp = deepMergeRecords(mcpBase, mcpRecord);
  }

  for (const [rawKey, normalizedKey] of [
    ["criticalActions", "critical_actions"],
    ["system_prompt", "systemPrompt"],
    ["user_prompt_template", "userPromptTemplate"],
    ["conversationalKnowledge", "conversational_knowledge"],
  ]) {
    if (Object.prototype.hasOwnProperty.call(candidate, rawKey) && !Object.prototype.hasOwnProperty.call(candidate, normalizedKey)) {
      candidate[normalizedKey] = candidate[rawKey];
    }
    delete candidate[rawKey];
  }

  delete candidate.agentId;
  delete candidate.id;

  if (Object.keys(metadata).length > 0) candidate.metadata = metadata;
  if (Object.keys(persona).length > 0) candidate.persona = persona;
  if (Object.keys(tools).length > 0) candidate.tools = tools;
  return candidate;
}

export function listChangeOperations(changeSet: AiChangeSetPayload | null | undefined): ChangeOperation[] {
  const root = asRecord(changeSet);
  if (!root) return [];
  const operationsValue = root.operations;
  if (!Array.isArray(operationsValue)) return [];

  const operations: ChangeOperation[] = [];
  for (const item of operationsValue) {
    const raw = asRecord(item);
    if (!raw) continue;
    const target = asRecord(raw.target);
    if (!target) continue;
    operations.push({
      op: asString(raw.op),
      targetType: asString(raw.targetType),
      target,
      payload: asRecord(raw.payload),
    });
  }
  return operations;
}

function targetIdentifier(op: ChangeOperation): string {
  if (op.targetType === "step") return `step:${asString(op.target.nodeId) || "unknown"}`;
  if (op.targetType === "asset") return `asset:${asString(op.target.path) || "unknown"}`;
  if (op.targetType === "agent") return `agent:${asString(op.target.agentId) || "unknown"}`;
  if (op.targetType === "workflow") return `workflow:${String(op.target.workflowId ?? "unknown")}`;
  return `${op.targetType || "unknown"}:unknown`;
}

function deriveImpactFromOperations(operations: ChangeOperation[]): WorkbenchImpactSummary {
  const counts: WorkbenchImpactCounts = { workflow: 0, step: 0, agent: 0, asset: 0 };
  const objects: string[] = [];
  const seenTargetTypes = new Set<string>();

  for (const op of operations) {
    const type = op.targetType;
    if (type in counts) {
      counts[type as keyof WorkbenchImpactCounts] += 1;
      seenTargetTypes.add(type);
    }
    objects.push(targetIdentifier(op));
  }

  const riskFlags: string[] = [];
  if (seenTargetTypes.size > 1) riskFlags.push("cross-object");
  if (operations.length >= 5) riskFlags.push("high-churn");

  return {
    objects,
    counts,
    riskFlags,
    requiresConfirmation: true,
  };
}

function parseImpact(changeSet: AiChangeSetPayload | null | undefined, operations: ChangeOperation[]): WorkbenchImpactSummary {
  const root = asRecord(changeSet);
  const impact = asRecord(root?.impact);
  if (!impact) return deriveImpactFromOperations(operations);

  const countsRaw = asRecord(impact.counts);
  const counts: WorkbenchImpactCounts = {
    workflow: Number.isFinite(countsRaw?.workflow) ? Number(countsRaw?.workflow) : 0,
    step: Number.isFinite(countsRaw?.step) ? Number(countsRaw?.step) : 0,
    agent: Number.isFinite(countsRaw?.agent) ? Number(countsRaw?.agent) : 0,
    asset: Number.isFinite(countsRaw?.asset) ? Number(countsRaw?.asset) : 0,
  };

  const objects = Array.isArray(impact.objects) ? impact.objects.map((item) => String(item ?? "")).filter(Boolean) : [];
  const riskFlags = Array.isArray(impact.riskFlags) ? impact.riskFlags.map((item) => String(item ?? "")).filter(Boolean) : [];

  return {
    objects: objects.length ? objects : operations.map((op) => targetIdentifier(op)),
    counts,
    riskFlags,
    requiresConfirmation: impact.requiresConfirmation !== false,
  };
}

function resolveStepPath(op: ChangeOperation, snapshot: WorkbenchSnapshotState): string {
  const fromPayload = asString(op.payload?.stepPath);
  if (fromPayload) return fromPayload;
  const nodeId = asString(op.target.nodeId);
  if (nodeId && snapshot.stepPathByNodeId[nodeId]) return snapshot.stepPathByNodeId[nodeId];
  if (nodeId) return `steps/${nodeId}.md`;
  return "steps/unknown.md";
}

function resolvePath(op: ChangeOperation, snapshot: WorkbenchSnapshotState): string {
  if (op.targetType === "workflow") return `workflows/${String(op.target.workflowId ?? "unknown")}.md`;
  if (op.targetType === "step") return resolveStepPath(op, snapshot);
  if (op.targetType === "agent") return `agents/${asString(op.target.agentId) || "unknown"}.json`;
  if (op.targetType === "asset") return asString(op.target.path) || "assets/unknown.txt";
  return `${op.targetType || "unknown"}/unknown`;
}

function resolveAgentBeforeAfter(op: ChangeOperation, snapshot: WorkbenchSnapshotState): { before: string; after: string } {
  const agentId = asString(op.target.agentId);
  const current = agentId ? snapshot.agentsById[agentId] : undefined;
  const before = current ? safeStringify(current) : "";
  if (op.op === "delete") return { before, after: "" };
  if (!op.payload) return { before, after: before || "{}" };
  const normalizedPayload = normalizeAgentPayload(op.payload);
  const next = current ? deepMergeRecords({ ...current }, normalizedPayload) : { ...normalizedPayload };
  return { before, after: safeStringify(next) };
}

function resolveWorkflowBeforeAfter(op: ChangeOperation, snapshot: WorkbenchSnapshotState): { before: string; after: string } {
  const workflowId = String(op.target.workflowId ?? "");
  const before = snapshot.workflowMarkdownById[workflowId] ?? "";
  if (op.op === "delete") return { before, after: "" };
  const payload = op.payload ?? {};
  const markdownAfter =
    asString(payload.workflowMarkdown) ||
    asString(payload.workflowMd) ||
    asString(payload.workflow_md) ||
    asString(payload.markdown);
  if (markdownAfter) {
    return { before, after: markdownAfter };
  }
  const hasGraphOrStepFilesOnly =
    "graph" in payload ||
    "graph_json" in payload ||
    "stepFiles" in payload ||
    "step_files" in payload;
  const after = hasGraphOrStepFilesOnly
    ? before
    : (Object.keys(payload).length ? safeStringify(payload) : before);
  return { before, after };
}

function extractWorkflowStepFilesPatch(op: ChangeOperation): Record<string, string> {
  const payload = op.payload ?? null;
  if (!payload) return {};
  const raw = payload.stepFiles ?? payload.step_files;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const patch: Record<string, string> = {};
  for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof path !== "string" || typeof content !== "string") continue;
    const normalized = path.trim();
    if (!normalized) continue;
    patch[normalized] = content;
  }
  return patch;
}

function resolveStepBeforeAfter(op: ChangeOperation, path: string, snapshot: WorkbenchSnapshotState): { before: string; after: string } {
  const before = snapshot.stepMarkdownByPath[path] ?? "";
  if (op.op === "delete") return { before, after: "" };
  const after =
    asString(op.payload?.stepMarkdown) ||
    asString(op.payload?.markdown) ||
    before;
  return { before, after };
}

function resolveAssetBeforeAfter(op: ChangeOperation, path: string, snapshot: WorkbenchSnapshotState): { before: string; after: string } {
  const before = snapshot.assetsByPath[path] ?? "";
  if (op.op === "delete") return { before, after: "" };
  return { before, after: asString(op.payload?.content) };
}

function lineDelta(before: string, after: string): { added: number; removed: number } {
  const beforeLines = (before ?? "").split("\n");
  const afterLines = (after ?? "").split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);

  let added = 0;
  let removed = 0;
  for (let index = 0; index < max; index += 1) {
    const prev = beforeLines[index];
    const next = afterLines[index];
    if (prev === next) continue;
    if (prev !== undefined) removed += 1;
    if (next !== undefined) added += 1;
  }
  return { added, removed };
}

function diffForOperation(op: ChangeOperation, path: string, snapshot: WorkbenchSnapshotState): WorkbenchDiffModel {
  let before = "";
  let after = "";

  if (op.targetType === "workflow") {
    ({ before, after } = resolveWorkflowBeforeAfter(op, snapshot));
  } else if (op.targetType === "step") {
    ({ before, after } = resolveStepBeforeAfter(op, path, snapshot));
  } else if (op.targetType === "agent") {
    ({ before, after } = resolveAgentBeforeAfter(op, snapshot));
  } else if (op.targetType === "asset") {
    ({ before, after } = resolveAssetBeforeAfter(op, path, snapshot));
  } else {
    const payload = op.payload;
    before = "";
    after = payload ? safeStringify(payload) : "";
  }

  const delta = lineDelta(before, after);
  return {
    path,
    before,
    after,
    added: delta.added,
    removed: delta.removed,
  };
}

function fileChangeType(op: ChangeOperation, before: string): "A" | "M" | "D" {
  if (op.op === "delete") return "D";
  if (before.trim()) return "M";
  return "A";
}

function dedupeFiles(files: WorkbenchChangedFileItem[]): WorkbenchChangedFileItem[] {
  const byPath = new Map<string, WorkbenchChangedFileItem>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()];
}

export function buildPreviewModelFromChangeSet(
  changeSet: AiChangeSetPayload | null | undefined,
  snapshot: WorkbenchSnapshotState,
): WorkbenchPreviewModel {
  const operations = listChangeOperations(changeSet);
  const files: WorkbenchChangedFileItem[] = [];
  const diffByPath: Record<string, WorkbenchDiffModel> = {};

  for (const op of operations) {
    if (op.targetType === "workflow" && op.op !== "delete") {
      const stepFilesPatch = extractWorkflowStepFilesPatch(op);
      for (const [stepPath, stepMarkdown] of Object.entries(stepFilesPatch)) {
        const before = snapshot.stepMarkdownByPath[stepPath] ?? "";
        const delta = lineDelta(before, stepMarkdown);
        files.push({
          path: stepPath,
          changeType: before.trim() ? "M" : "A",
          targetType: "step",
        });
        diffByPath[stepPath] = {
          path: stepPath,
          before,
          after: stepMarkdown,
          added: delta.added,
          removed: delta.removed,
        };
      }
    }

    const path = resolvePath(op, snapshot);
    const diff = diffForOperation(op, path, snapshot);
    files.push({
      path,
      changeType: fileChangeType(op, diff.before),
      targetType: op.targetType || "unknown",
    });
    diffByPath[path] = diff;
  }

  const deduped = dedupeFiles(files).sort((a, b) => {
    const targetOrderA = TARGET_ORDER[a.targetType] ?? 99;
    const targetOrderB = TARGET_ORDER[b.targetType] ?? 99;
    if (targetOrderA !== targetOrderB) return targetOrderA - targetOrderB;
    return a.path.localeCompare(b.path);
  });

  const impact = parseImpact(changeSet, operations);
  const countsFromFiles: WorkbenchImpactCounts = { workflow: 0, step: 0, agent: 0, asset: 0 };
  for (const file of deduped) {
    if (file.targetType in countsFromFiles) {
      countsFromFiles[file.targetType as keyof WorkbenchImpactCounts] += 1;
    }
  }
  impact.counts = {
    workflow: Math.max(impact.counts.workflow, countsFromFiles.workflow),
    step: Math.max(impact.counts.step, countsFromFiles.step),
    agent: Math.max(impact.counts.agent, countsFromFiles.agent),
    asset: Math.max(impact.counts.asset, countsFromFiles.asset),
  };

  return {
    files: deduped,
    diffByPath,
    impact,
  };
}

export function buildValidationLabel(params: {
  valid: boolean;
  filesCount: number;
  errorsCount: number;
  warningsCount: number;
}): string {
  if (params.valid) {
    const warningPart = params.warningsCount > 0 ? ` · ${params.warningsCount} warning${params.warningsCount > 1 ? "s" : ""}` : "";
    return `${params.filesCount} files · validation passed${warningPart}`;
  }
  return `Validation failed · ${params.errorsCount} error${params.errorsCount > 1 ? "s" : ""}`;
}

export function normalizeRevisionBase(input: RevisionBase | null | undefined): Required<RevisionBase> {
  return {
    workflowRevision: typeof input?.workflowRevision === "number" && input.workflowRevision >= 1 ? Math.floor(input.workflowRevision) : 1,
    agentsRevision: typeof input?.agentsRevision === "number" && input.agentsRevision >= 1 ? Math.floor(input.agentsRevision) : 1,
    assetsRevision: typeof input?.assetsRevision === "number" && input.assetsRevision >= 1 ? Math.floor(input.assetsRevision) : 1,
  };
}

export function estimateTokenUsage(value: string): number {
  const text = (value ?? "").trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function formatBudgetHint(usedTokens: number, maxTokens = 16000): string {
  const used = Math.max(0, Math.floor(usedTokens));
  const max = Math.max(1, Math.floor(maxTokens));
  const percentage = Math.min(999, Math.round((used / max) * 100));
  return `Context budget: ~${used}/${max} tokens (${percentage}%)`;
}

export function formatImpactSummary(impact: WorkbenchImpactSummary): string {
  const counts = impact.counts;
  const parts = [
    `${counts.workflow} workflow`,
    `${counts.step} step`,
    `${counts.agent} agent`,
    `${counts.asset} asset`,
  ];
  return parts.join(" · ");
}
