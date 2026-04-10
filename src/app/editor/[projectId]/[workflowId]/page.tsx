"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";

import { clearAccessToken } from "@/lib/auth";
import { buildAiWorkbenchUrl } from "@/lib/ai-workbench-client";
import { normalizeAssetsPath, parseAssetsJson } from "@/lib/assets-v11";
import workflowGraphSchemaV11 from "@/lib/bmad-spec/v1.1/workflow-graph.schema.json";
import { getApiBaseUrl, getJson, putJson } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { isValidAgentId, uniqueAgentId } from "@/lib/utils";
import { buildWorkflowGraphV11 } from "@/lib/workflow-graph-v11";
import { parseStepMarkdown, serializeStepMarkdown, type StepSections } from "@/lib/step-parser";
import { StepEditorPanel } from "@/components/StepEditorPanel";

import type { Edge, Node } from "reactflow";
import ReactFlow, {
  applyEdgeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  type Connection,
  type NodeProps,
  type ReactFlowInstance,
  useNodesState,
} from "reactflow";

type ProjectDetail = {
  id: number;
  name: string;
  agentsJson: string;
  artifactsJson: string;
};

type WorkflowDetail = {
  id: number;
  projectId: number;
  name: string;
  workflowMd: string;
  graphJson: string;
  stepFilesJson: string;
};

type PackageAssetsOut = {
  assetsJson: string;
};

type AiStepMode = "create" | "optimize";

type WorkflowNodeType = "step" | "decision" | "merge" | "end" | "subworkflow";

type WorkflowNodeData = {
  title: string;
  instructions: string;
  agentId: string;
  inputs: string[];
  outputs: string[];
  setsVariables: string[];
  stepFilePath?: string;
  subworkflowId?: number | null;
  goal?: string;
  completion?: string;
};

type ProjectAgent = {
  id: string;
  name: string;
  title: string;
  icon: string;
  role: string;
};

function stripMarkdownPreview(markdown: string): string {
  const raw = markdown ?? "";
  if (!raw.trim()) return "";

  let text = raw;

  // Drop fenced code blocks completely (too noisy for node cards).
  text = text.replace(/```[\s\S]*?```/g, " ");

  // Links: [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // Inline code: `code` -> code
  text = text.replace(/`([^`]+)`/g, "$1");

  // Headings, quotes, lists
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^>\s+/gm, "");
  text = text.replace(/^\s*([-*+]|\d+\.)\s+/gm, "");

  // Basic emphasis markers
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/__(.*?)__/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/_(.*?)_/g, "$1");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function truncateWithDots(text: string, maxChars: number): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars)).trimEnd()}...`;
}

function StepNode({
  id,
  data,
  agentLookup,
  type,
  onOpenAiWorkbench,
}: NodeProps<WorkflowNodeData> & {
  agentLookup: Map<string, ProjectAgent>;
  onOpenAiWorkbench?: (nodeId: string) => void;
}) {
  const nodeType = (type ?? "step") as WorkflowNodeType;
  const agent = data.agentId ? agentLookup.get(data.agentId) : null;
  const label =
    nodeType === "decision"
      ? "Decision"
      : nodeType === "merge"
        ? "Merge"
        : nodeType === "end"
          ? "End"
          : nodeType === "subworkflow"
            ? "Subworkflow"
            : "Step";
  const accent =
    nodeType === "decision"
      ? "bg-[#FFF4E5] text-[#9A5B1A] border-[#F2D5A6]"
      : nodeType === "merge"
        ? "bg-[#EAF5FF] text-[#2B6CB0] border-[#CFE5FF]"
        : nodeType === "end"
          ? "bg-[#FFEFF0] text-[#B23A48] border-[#F5C8CB]"
          : nodeType === "subworkflow"
            ? "bg-[#F3E9FF] text-[#6B4BC7] border-[#D9C4FF]"
            : "bg-[#EEF2F8] text-[#1F2937] border-[#DDE3EE]";
  const canOpenAi = Boolean(onOpenAiWorkbench);

  return (
    <div className="w-72 rounded-xl border border-[#DDE3EE] bg-white px-3 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.08)]">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            <span className={`rounded-full border px-2 py-0.5 ${accent}`}>{label}</span>
          </p>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-[#1F2937]">{data.title}</p>
        </div>
        {data.agentId ? (
          <span
            title={agent ? `${agent.icon || "🧩"} ${agent.title || agent.name}` : `${data.agentId} (missing)`}
            className="max-w-36 truncate rounded-full border border-[#DDE3EE] bg-[#EEF2F8] px-2 py-0.5 text-[10px] text-[#5F6B82]"
          >
            {agent ? `${agent.icon || "🧩"} ${agent.title || agent.name}` : `${data.agentId} (missing)`}
          </span>
        ) : null}
      </div>
      {(() => {
        const goalPreview = stripMarkdownPreview(data.goal ?? "");
        const fallback = stripMarkdownPreview(data.instructions ?? "");
        const snippet = truncateWithDots(goalPreview || fallback, 24);
        if (!snippet) return <p className="mt-2 text-xs text-[#94A0B8]">Click to edit…</p>;
        return <p className="mt-2 line-clamp-2 text-xs text-[#5F6B82]">{snippet}</p>;
      })()}
      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenAiWorkbench?.(id);
          }}
          disabled={!canOpenAi}
          className="nodrag rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2.5 py-0.5 text-[10px] font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Open AI workbench"
        >
          AI workbench
        </button>
      </div>
      {nodeType === "end" ? null : <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

function parseProjectAgentsJson(raw: string): { agents: ProjectAgent[]; error: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { agents: [], error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    const existing = new Set<string>();

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const rawAgents = Array.isArray(obj.agents) ? obj.agents : [];

      const agents = rawAgents
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const agent = item as Record<string, unknown>;
          const id = typeof agent.id === "string" ? agent.id : "";
          const metadata = (agent.metadata as Record<string, unknown> | undefined) ?? {};
          const persona = (agent.persona as Record<string, unknown> | undefined) ?? {};

          const name = typeof metadata.name === "string" ? metadata.name : "";
          const title = typeof metadata.title === "string" ? metadata.title : name;
          const icon = typeof metadata.icon === "string" ? metadata.icon : "🧩";
          const role = typeof persona.role === "string" ? persona.role : "Agent";

          if (!name) return null;
          const ensuredId = isValidAgentId(id) ? id : uniqueAgentId(name, existing);
          existing.add(ensuredId);

          return {
            id: ensuredId,
            name,
            title: title || name,
            icon: icon || "🧩",
            role: role || "Agent",
          } satisfies ProjectAgent;
        })
        .filter((item): item is ProjectAgent => Boolean(item));

      return { agents, error: null };
    }

    if (Array.isArray(parsed)) {
      const legacy = parsed as unknown[];
      const agents = legacy
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const obj = item as Record<string, unknown>;
          const name = typeof obj.name === "string" ? obj.name : "";
          const role = typeof obj.role === "string" ? obj.role : "Agent";
          if (!name) return null;

          const id = uniqueAgentId(name, existing);
          existing.add(id);
          return { id, name, title: name, icon: "🧩", role: role || "Agent" } satisfies ProjectAgent;
        })
        .filter((item): item is ProjectAgent => Boolean(item));

      return { agents, error: null };
    }

    return { agents: [], error: "Invalid agentsJson format (expected a v1.1 manifest or an array)." };
  } catch {
    return { agents: [], error: "Failed to parse agents.json (invalid JSON)." };
  }
}

type WorkflowGraph = {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge<WorkflowEdgeData>[];
};

type WorkflowEdgeData = {
  labelMode?: "auto" | "manual";
  conditionText?: string;
  isDefault?: boolean;
};

type WorkflowVariable = {
  key: string;
  value: string;
};

function workflowVariablesSignature(variables: WorkflowVariable[]): string {
  const normalized = new Map<string, string>();
  for (const item of variables) {
    const key = item.key.trim();
    if (!key) continue;
    normalized.set(key, item.value ?? "");
  }
  return JSON.stringify(
    Array.from(normalized.entries()).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function graphSignatureFor(nodes: Node<WorkflowNodeData>[], edges: Edge<WorkflowEdgeData>[]): string {
  const nodeSignature = nodes
    .map((n) => ({
      id: n.id,
      type: isWorkflowNodeType(n.type) ? n.type : ("step" satisfies WorkflowNodeType),
      position: {
        x: typeof n.position?.x === "number" ? n.position.x : 0,
        y: typeof n.position?.y === "number" ? n.position.y : 0,
      },
      data: {
        title: n.data?.title ?? "",
        instructions: n.data?.instructions ?? "",
        agentId: n.data?.agentId ?? "",
        inputs: Array.isArray(n.data?.inputs) ? n.data.inputs : [],
        outputs: Array.isArray(n.data?.outputs) ? n.data.outputs : [],
        setsVariables: Array.isArray(n.data?.setsVariables) ? n.data.setsVariables : [],
        stepFilePath: n.data?.stepFilePath ?? "",
        goal: n.data?.goal ?? "",
        completion: n.data?.completion ?? "",
        ...(typeof n.data?.subworkflowId === "number" ? { subworkflowId: n.data.subworkflowId } : {}),
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edgeSignature = edges
    .map((e, idx) => {
      const label = typeof e.label === "string" ? e.label : "";
      const labelModeRaw = e.data?.labelMode;
      const labelMode: WorkflowEdgeData["labelMode"] =
        labelModeRaw === "auto" || labelModeRaw === "manual" ? labelModeRaw : label ? "manual" : "auto";

      return {
        id: e.id ?? `e-${e.source}-${e.target}-${idx}`,
        source: e.source,
        target: e.target,
        label,
        conditionText: e.data?.conditionText ?? "",
        isDefault: Boolean(e.data?.isDefault),
        labelMode,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({ nodes: nodeSignature, edges: edgeSignature });
}

function isWorkflowNodeType(value: unknown): value is WorkflowNodeType {
  return (
    value === "step" ||
    value === "decision" ||
    value === "merge" ||
    value === "end" ||
    value === "subworkflow"
  );
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v): v is string => Boolean(v));
}

function parseGraphJson(
  raw: string,
  agents: ProjectAgent[],
): {
  graph: WorkflowGraph;
  error: string | null;
  unmappedAgentRefs: string[];
  legacyAgentMigrationCount: number;
  signatureBeforeMigration: string;
  signatureAfterMigration: string;
} {
  const trimmed = raw?.trim();
  const emptySignature = JSON.stringify({ nodes: [], edges: [] });
  if (!trimmed) {
    return {
      graph: { nodes: [], edges: [] },
      error: null,
      unmappedAgentRefs: [],
      legacyAgentMigrationCount: 0,
      signatureBeforeMigration: emptySignature,
      signatureAfterMigration: emptySignature,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        graph: { nodes: [], edges: [] },
        error: "Invalid graphJson format (expected an object).",
        unmappedAgentRefs: [],
        legacyAgentMigrationCount: 0,
        signatureBeforeMigration: emptySignature,
        signatureAfterMigration: emptySignature,
      };
    }

    const obj = parsed as Record<string, unknown>;
    const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
    const unmappedAgentRefs: string[] = [];
    let legacyAgentMigrationCount = 0;

    const byId = new Map(agents.map((a) => [a.id, a.id] as const));
    const byName = new Map(agents.map((a) => [a.name.trim().toLowerCase(), a.id] as const));
    const byTitle = new Map(agents.map((a) => [a.title.trim().toLowerCase(), a.id] as const));

    function resolveAgentId(rawRef: string): string {
      const idRef = rawRef.trim();
      if (!idRef) return "";
      const exact = byId.get(idRef);
      if (exact) return exact;
      const lower = idRef.toLowerCase();
      return byName.get(lower) ?? byTitle.get(lower) ?? "";
    }

    const nodesForSignature: Array<{
      id: string;
      type: WorkflowNodeType;
      position: { x: number; y: number };
      data: {
        title: string;
        instructions: string;
        agentId: string;
        inputs: string[];
        outputs: string[];
        setsVariables: string[];
        stepFilePath?: string;

        subworkflowId?: number | null;
        goal?: string;
        completion?: string;
      };
    }> = [];

    const nodes: Node<WorkflowNodeData>[] = rawNodes
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const node = item as Record<string, unknown>;
        const id = typeof node.id === "string" ? node.id : "";
        const rawType = node.type;
        const nodeType: WorkflowNodeType = isWorkflowNodeType(rawType) ? rawType : "step";
        const pos = node.position as Record<string, unknown> | undefined;
        const x = typeof pos?.x === "number" ? pos.x : 0;
        const y = typeof pos?.y === "number" ? pos.y : 0;
        const dataObj = node.data as Record<string, unknown> | undefined;
        const titleRaw = typeof dataObj?.title === "string" ? dataObj.title : "";
        const legacyName = typeof dataObj?.name === "string" ? dataObj.name : "";
        const title = (titleRaw || legacyName || id || "Untitled").trim() || "Untitled";
        const filePathRaw = typeof node.file === "string"
          ? node.file.trim()
          : typeof dataObj?.stepFilePath === "string"
            ? dataObj.stepFilePath.trim()
            : "";
        const instructions = typeof dataObj?.instructions === "string" ? dataObj.instructions : "";
        const goal = typeof dataObj?.goal === "string" ? dataObj.goal : "";
        const completion = typeof dataObj?.completion === "string" ? dataObj.completion : "";
        const agentIdRaw = typeof dataObj?.agentId === "string" ? dataObj.agentId : "";
        const legacyAgentRaw = typeof dataObj?.agent === "string" ? dataObj.agent : "";
        const mappedLegacyId = legacyAgentRaw ? resolveAgentId(legacyAgentRaw) : "";
        if (!agentIdRaw && mappedLegacyId) legacyAgentMigrationCount += 1;
        const agentId = agentIdRaw || mappedLegacyId;
        if (!agentId && legacyAgentRaw) unmappedAgentRefs.push(`${id}:${legacyAgentRaw}`);
        const inputs = parseStringList(dataObj?.inputs);
        const outputs = parseStringList(dataObj?.outputs);
        const setsVariables = parseStringList(dataObj?.setsVariables);
        const subworkflowId =
          typeof dataObj?.subworkflowId === "number" ? dataObj.subworkflowId : null;
        if (!id) return null;

        nodesForSignature.push({
          id,
          type: nodeType,
          position: { x, y },
          data: {
            title,
            instructions,
            agentId: agentIdRaw,
            inputs,
            outputs,
            setsVariables,
            ...(filePathRaw ? { stepFilePath: filePathRaw } : {}),
            goal,
            completion,
            ...(subworkflowId !== null ? { subworkflowId } : {}),
          },
        });

        return {
          id,
          type: nodeType,
          position: { x, y },
          data: {
            title,
            instructions,
            agentId,
            inputs,
            outputs,
            setsVariables,
            ...(filePathRaw ? { stepFilePath: filePathRaw } : {}),
            goal,
            completion,
            ...(subworkflowId !== null ? { subworkflowId } : {}),
          },
        } as Node<WorkflowNodeData>;
      })
      .filter((item): item is Node<WorkflowNodeData> => item !== null);

    const edgesForSignature: Array<{
      id: string;
      source: string;
      target: string;
      label: string;
      conditionText: string;
      isDefault: boolean;
      labelMode: "auto" | "manual";
    }> = [];

    let edges: Edge<WorkflowEdgeData>[] = rawEdges
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const edge = item as Record<string, unknown>;
        const source =
          typeof edge.source === "string"
            ? edge.source
            : typeof edge.from === "string"
              ? edge.from
              : "";
        const target =
          typeof edge.target === "string"
            ? edge.target
            : typeof edge.to === "string"
              ? edge.to
              : "";
        const id = typeof edge.id === "string" && edge.id ? edge.id : `e-${source}-${target}-${index}`;
        if (!source || !target) return null;
        const rawLabel = typeof edge.label === "string" ? edge.label : "";
        const dataObj = edge.data as Record<string, unknown> | undefined;
        const label = rawLabel || (typeof dataObj?.label === "string" ? (dataObj.label as string) : "");
        const conditionText =
          typeof edge.conditionText === "string"
            ? edge.conditionText
            : typeof dataObj?.conditionText === "string"
              ? (dataObj.conditionText as string)
              : "";
        const isDefaultRaw =
          typeof edge.isDefault === "boolean"
            ? edge.isDefault
            : typeof dataObj?.isDefault === "boolean"
              ? (dataObj.isDefault as boolean)
              : false;
        const labelModeRaw =
          typeof dataObj?.labelMode === "string" && (dataObj.labelMode === "auto" || dataObj.labelMode === "manual")
            ? (dataObj.labelMode as "auto" | "manual")
            : label
              ? "manual"
              : "auto";

        edgesForSignature.push({
          id,
          source,
          target,
          label,
          conditionText,
          isDefault: isDefaultRaw,
          labelMode: labelModeRaw,
        });

        return {
          id,
          source,
          target,
          label,
          data: {
            ...(conditionText ? { conditionText } : {}),
            ...(isDefaultRaw ? { isDefault: true } : {}),
            ...(labelModeRaw ? { labelMode: labelModeRaw } : {}),
          },
        } as Edge<WorkflowEdgeData>;
      })
      .filter((item): item is Edge<WorkflowEdgeData> => item !== null);

    const outgoingBySource = new Map<string, Edge<WorkflowEdgeData>[]>();
    for (const edge of edges) {
      const bucket = outgoingBySource.get(edge.source) ?? [];
      bucket.push(edge);
      outgoingBySource.set(edge.source, bucket);
    }

    for (const [, outgoing] of outgoingBySource) {
      const autoEdges = outgoing.filter((e) => (e.data?.labelMode ?? "auto") === "auto" && !e.label);
      if (!autoEdges.length) continue;
      if (outgoing.length === 1) {
        autoEdges[0].label = "next";
      } else {
        autoEdges.forEach((e, idx) => {
          e.label = `branch-${idx + 1}`;
        });
      }
    }

    for (const node of nodes) {
      if (node.type !== "decision") continue;
      const outgoing = outgoingBySource.get(node.id) ?? [];
      if (!outgoing.length) continue;
      const defaults = outgoing.filter((e) => Boolean(e.data?.isDefault));
      const keep = defaults[0] ?? outgoing[0];
      edges = edges.map((e) => {
        if (e.source !== node.id) return e;
        const isDefault = e.id === keep.id;
        return {
          ...e,
          data: { ...(e.data ?? {}), isDefault },
        };
      });
    }

    const signatureBeforeMigration = JSON.stringify({
      nodes: nodesForSignature.sort((a, b) => a.id.localeCompare(b.id)),
      edges: edgesForSignature
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          conditionText: e.conditionText,
          isDefault: e.isDefault,
          labelMode: e.labelMode,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });

    const signatureAfterMigration = graphSignatureFor(nodes, edges);

    return {
      graph: { nodes, edges },
      error: null,
      unmappedAgentRefs,
      legacyAgentMigrationCount,
      signatureBeforeMigration,
      signatureAfterMigration,
    };
  } catch {
    return {
      graph: { nodes: [], edges: [] },
      error: "Failed to parse graphJson (invalid JSON).",
      unmappedAgentRefs: [],
      legacyAgentMigrationCount: 0,
      signatureBeforeMigration: emptySignature,
      signatureAfterMigration: emptySignature,
    };
  }
}

function parseStepFilesJson(raw: string): { files: Record<string, string>; error: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { files: {}, error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { files: {}, error: "Invalid stepFilesJson format (expected an object)." };
    }
    const obj = parsed as Record<string, unknown>;
    const files: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") files[key] = value;
    }
    return { files, error: null };
  } catch {
    return { files: {}, error: "Failed to parse stepFilesJson (invalid JSON)." };
  }
}

function findStepFileForNode(
  stepFiles: Record<string, string>,
  nodeId: string,
): { path: string; content: string } | null {
  const targetNodeId = nodeId.trim();
  if (!targetNodeId) return null;

  for (const [path, content] of Object.entries(stepFiles)) {
    if (typeof content !== "string") continue;
    const parsed = parseStepMarkdown(content);
    if (parsed.success && parsed.data?.frontmatter?.nodeId?.trim() === targetNodeId) {
      return { path, content };
    }
  }

  const fallbackPath = `steps/${targetNodeId}.md`;
  const fallback = stepFiles[fallbackPath];
  if (typeof fallback === "string") {
    return { path: fallbackPath, content: fallback };
  }
  return null;
}

function applyStepFilesToNodes(
  nodes: Node<WorkflowNodeData>[],
  stepFiles: Record<string, string>,
): Node<WorkflowNodeData>[] {
  const parsedByNodeId = new Map<
    string,
    { data: ReturnType<typeof parseStepMarkdown>["data"]; path: string }
  >();

  for (const [path, content] of Object.entries(stepFiles)) {
    if (typeof content !== "string") continue;
    const parsed = parseStepMarkdown(content);
    if (!parsed.success || !parsed.data) continue;
    const nodeId = parsed.data.frontmatter?.nodeId;
    if (typeof nodeId !== "string" || !nodeId.trim()) continue;
    parsedByNodeId.set(nodeId.trim(), { data: parsed.data, path });
  }

  if (!parsedByNodeId.size) return nodes;

  return nodes.map((node) => {
    const step = parsedByNodeId.get(node.id);
    if (!step || !step.data) return node;
    const fm = step.data.frontmatter;
    const sections = step.data.sections ?? ({ goal: "", instructions: "" } as StepSections);
    const nextType = isWorkflowNodeType(fm.type) ? fm.type : node.type;

    return {
      ...node,
      type: nextType,
      data: {
        ...node.data,
        title: fm.title?.trim() || node.data?.title || node.id,
        agentId: fm.agentId?.trim() || "",
        inputs: Array.isArray(fm.inputs) ? fm.inputs : [],
        outputs: Array.isArray(fm.outputs) ? fm.outputs : [],
        setsVariables: Array.isArray(fm.setsVariables) ? fm.setsVariables : [],
        stepFilePath: step.path,
        goal: sections.goal ?? "",
        instructions: sections.instructions ?? "",
        completion: sections.completion ?? "",
      },
    };
  });
}

function parseArtifactsJson(raw: string): { dirs: string[]; error: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { dirs: [], error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return { dirs: [], error: "Invalid artifactsJson format (expected an array)." };

    const dirs = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
      .filter((v) => Boolean(v))
      .filter((v) => v.startsWith("artifacts/"));

    return { dirs, error: null };
  } catch {
    return { dirs: [], error: "Failed to parse artifactsJson (invalid JSON)." };
  }
}

function normalizeArtifactsDir(input: string): { value: string | null; error: string | null } {
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw) return { value: null, error: "Directory cannot be empty." };
  if (raw.startsWith("/")) return { value: null, error: "Directory must be a relative path." };

  const withoutPrefix = raw.replace(/^\.\/+/, "").replace(/^artifacts\/+/, "");
  const cleaned = withoutPrefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return { value: null, error: "Directory cannot be empty." };
  if (cleaned.split("/").some((part) => part === ".."))
    return { value: null, error: "Directory cannot contain '..'." };

  return { value: `artifacts/${cleaned}`, error: null };
}

function graphForSave(nodes: Node<WorkflowNodeData>[], edges: Edge<WorkflowEdgeData>[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => {
      const stepFilePath = (n.data?.stepFilePath ?? `steps/${n.id}.md`).trim() || `steps/${n.id}.md`;
      return {
        id: n.id,
        type: isWorkflowNodeType(n.type) ? n.type : "step",
        position: n.position,
        file: stepFilePath,
        data: {
          title: n.data?.title ?? "",
          instructions: n.data?.instructions ?? "",
          agentId: n.data?.agentId ?? "",
          inputs: Array.isArray(n.data?.inputs) ? n.data.inputs : [],
          outputs: Array.isArray(n.data?.outputs) ? n.data.outputs : [],
          setsVariables: Array.isArray(n.data?.setsVariables) ? n.data.setsVariables : [],
          goal: n.data?.goal ?? "",
          completion: n.data?.completion ?? "",
          ...(typeof n.data?.subworkflowId === "number" ? { subworkflowId: n.data.subworkflowId } : {}),
        },
      } as unknown as Node<WorkflowNodeData>;
    }),
    edges: edges.map((e, idx) => ({
      id: e.id ?? `e-${e.source}-${e.target}-${idx}`,
      source: e.source,
      target: e.target,
      label: e.label ?? "",
      data: {
        ...(e.data?.labelMode ? { labelMode: e.data.labelMode } : {}),
        ...(e.data?.conditionText ? { conditionText: e.data.conditionText } : {}),
        ...(typeof e.data?.isDefault === "boolean" ? { isDefault: e.data.isDefault } : {}),
      },
    })),
  };
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "";
  return errors
    .map((err) => {
      const path = err.instancePath || err.schemaPath || "value";
      return `${path}: ${err.message ?? "invalid"}`;
    })
    .join("; ");
}

function extractYamlFrontmatter(markdown: string): string | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(markdown);
  return match ? match[1] : null;
}

function decodeYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseWorkflowVariablesFromWorkflowMd(workflowMd: string): WorkflowVariable[] {
  const frontmatter = extractYamlFrontmatter(workflowMd);
  if (!frontmatter) return [];

  const lines = frontmatter.split(/\r?\n/);
  let inVariables = false;
  const vars: WorkflowVariable[] = [];

  for (const line of lines) {
    if (!inVariables) {
      const match = /^variables:\s*(\{\})?\s*$/.exec(line);
      if (!match) continue;
      if (match[1]) return [];
      inVariables = true;
      continue;
    }

    if (!line.trim()) continue;
    if (!line.startsWith("  ")) break;

    const entry = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (!entry) continue;

    const key = decodeYamlScalar(entry[1] ?? "");
    if (!key) continue;
    const value = decodeYamlScalar(entry[2] ?? "");
    vars.push({ key, value });
  }

  return vars;
}

function serializeWorkflowVariablesToFrontmatter(variables: WorkflowVariable[]): string[] {
  const deduped = new Map<string, string>();
  for (const item of variables) {
    const key = item.key.trim();
    if (!key) continue;
    deduped.set(key, item.value ?? "");
  }

  if (!deduped.size) return ["variables: {}"];

  const keySafePattern = /^[A-Za-z0-9_][A-Za-z0-9_]*$/;
  const lines = ["variables:"];
  for (const [key, value] of deduped) {
    const safeKey = keySafePattern.test(key) ? key : JSON.stringify(key);
    lines.push(`  ${safeKey}: ${JSON.stringify(value ?? "")}`);
  }
  return lines;
}

export default function EditorPage() {

  const router = useRouter();
  const params = useParams<{ projectId: string; workflowId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const projectId = params?.projectId;
  const workflowId = params?.workflowId;
  const workflowKey = projectId && workflowId ? `${projectId}:${workflowId}` : null;
  const searchQuery = searchParams.toString();
  const returnTo = useMemo(() => {
    if (!pathname) return "";
    return searchQuery ? `${pathname}?${searchQuery}` : pathname;
  }, [pathname, searchQuery]);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedWorkflowKey, setLoadedWorkflowKey] = useState<string | null>(null);
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([]);
  const [agentsJsonError, setAgentsJsonError] = useState<string | null>(null);
  const [unmappedAgentsWarning, setUnmappedAgentsWarning] = useState<string | null>(null);
  const [graphJsonError, setGraphJsonError] = useState<string | null>(null);
  const [storedStepFiles, setStoredStepFiles] = useState<Record<string, string>>({});
  const [stepFilesJsonError, setStepFilesJsonError] = useState<string | null>(null);

  const [lastSavedSignature, setLastSavedSignature] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "saving" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const nodeIdCountersRef = useRef<Record<WorkflowNodeType, number>>({
    step: 2,
    decision: 1,
    merge: 1,
    end: 1,
    subworkflow: 1,
  });
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialNodes = useMemo<Node<WorkflowNodeData>[]>(
    () => [
      {
        id: "step-1",
        type: "step",
        position: { x: 0, y: 0 },
        data: {
          title: "Step 1",
          instructions: "",
          agentId: "",
          inputs: [],
          outputs: [],
          setsVariables: [],
          stepFilePath: "steps/step-1.md",
        },
      },
    ],
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeData>(initialNodes);
  const [edges, setEdges] = useState<Edge<WorkflowEdgeData>[]>([]);

  const agentsById = useMemo(
    () => new Map(projectAgents.map((a) => [a.id, a] as const)),
    [projectAgents],
  );
  const openAiWorkbenchForNode = useCallback(
    (nodeId: string, mode: AiStepMode = "optimize") => {
      if (!projectId) return;
      const normalized = nodeId.trim();
      if (!normalized) return;
      const parsedWorkflowId = Number.parseInt(workflowId, 10);
      router.push(
        buildAiWorkbenchUrl({
          projectId,
          targetType: "step",
          targetId: normalized,
          mode,
          workflowId: Number.isFinite(parsedWorkflowId) && parsedWorkflowId > 0 ? parsedWorkflowId : null,
          source: "editor",
          returnTo,
        }),
      );
    },
    [projectId, returnTo, router, workflowId],
  );
  const nodeTypes = useMemo(
    () => ({
      step: (props: NodeProps<WorkflowNodeData>) => (
        <StepNode {...props} agentLookup={agentsById} onOpenAiWorkbench={openAiWorkbenchForNode} />
      ),
      decision: (props: NodeProps<WorkflowNodeData>) => (
        <StepNode {...props} agentLookup={agentsById} onOpenAiWorkbench={openAiWorkbenchForNode} />
      ),
      merge: (props: NodeProps<WorkflowNodeData>) => (
        <StepNode {...props} agentLookup={agentsById} onOpenAiWorkbench={openAiWorkbenchForNode} />
      ),
      end: (props: NodeProps<WorkflowNodeData>) => (
        <StepNode {...props} agentLookup={agentsById} onOpenAiWorkbench={openAiWorkbenchForNode} />
      ),
      subworkflow: (props: NodeProps<WorkflowNodeData>) => (
        <StepNode {...props} agentLookup={agentsById} onOpenAiWorkbench={openAiWorkbenchForNode} />
      ),
    }),
    [agentsById, openAiWorkbenchForNode],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"node" | "workflow" | "artifacts">("node");
  const [nodeIdDraft, setNodeIdDraft] = useState("");
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [workflowVariables, setWorkflowVariables] = useState<WorkflowVariable[]>([]);
  const [projectArtifacts, setProjectArtifacts] = useState<string[]>([]);
  const [artifactsDraft, setArtifactsDraft] = useState("");
  const [artifactsSaving, setArtifactsSaving] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [assetsJsonRaw, setAssetsJsonRaw] = useState<string>("{}");
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [paletteOpen, setPaletteOpen] = useState(true);

  const assetsParsed = useMemo(() => parseAssetsJson(assetsJsonRaw), [assetsJsonRaw]);
  const assetsList = assetsParsed.assets;
  const assetsParseError = assetsParsed.error;

  const editorAgents = useMemo(() => projectAgents.map((a) => ({ id: a.id, name: a.name })), [projectAgents]);
  const storedStepFileByNodeId = useMemo(() => {
    const byNodeId = new Map<string, { path: string; content: string }>();
    for (const [path, content] of Object.entries(storedStepFiles)) {
      if (typeof content !== "string") continue;
      const parsed = parseStepMarkdown(content);
      if (parsed.success && parsed.data?.frontmatter?.nodeId?.trim()) {
        byNodeId.set(parsed.data.frontmatter.nodeId.trim(), { path, content });
      } else {
        const stem = path.endsWith(".md") ? path.slice(0, -3).split("/").pop() ?? "" : "";
        if (stem) byNodeId.set(stem, { path, content });
      }
    }
    return byNodeId;
  }, [storedStepFiles]);

  const handleStepEditorChange = useCallback(
    (newMd: string) => {
      // Find the current selected node ID from closure or rely on state
      // selectedNodeId is available in scope
      if (!selectedNodeId) return;

      setStoredStepFiles((prev) => {
        const next = { ...prev };
        const selectedNode = nodes.find((n) => n.id === selectedNodeId);
        const existingPath = findStepFileForNode(prev, selectedNodeId)?.path;
        const path =
          selectedNode?.data?.stepFilePath?.trim() ||
          existingPath ||
          `steps/${selectedNodeId}.md`;
        next[path] = newMd;
        return next;
      });

      const result = parseStepMarkdown(newMd);
      if (!result.success || !result.data) {
        return;
      }
      const { frontmatter, sections } = result.data;
      const nextType = frontmatter.type as WorkflowNodeType | undefined;

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          return {
            ...n,
            type: nextType ?? n.type,
            data: {
              ...n.data,
              title: frontmatter.title || n.data.title,
              agentId: frontmatter.agentId ?? "",
              inputs: frontmatter.inputs || [],
              outputs: frontmatter.outputs || [],
              setsVariables: frontmatter.setsVariables || [],
              goal: sections.goal,
              instructions: sections.instructions,
              completion: sections.completion,
            },
          };
        }),
      );

      if (nextType) {
        setEdges((eds) => normalizeDecisionDefaultForSource(eds, selectedNodeId, nextType === "decision"));
      }
    },
    [nodes, selectedNodeId, setEdges, setNodes],
  );

  const selectedNodeMarkdown = useMemo(() => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return "";
    const fromStored = storedStepFileByNodeId.get(node.id);
    if (fromStored?.content) return fromStored.content;
    return serializeStepMarkdown({
      frontmatter: {
        schemaVersion: "1.1",
        nodeId: node.id,
        type: (node.type ?? "step") as "step" | "decision" | "merge" | "end" | "subworkflow",
        title: node.data.title,
        agentId: node.data.agentId,
        inputs: node.data.inputs,
        outputs: node.data.outputs,
        setsVariables: node.data.setsVariables,
      },
      sections: {
        goal: node.data.goal || "",
        instructions: node.data.instructions || "",
        completion: node.data.completion || "",
      },
      rawContent: "",
    });
  }, [nodes, selectedNodeId, storedStepFileByNodeId]);

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;
    if (!projectId || !workflowId || !workflowKey) return;

    let cancelled = false;
    Promise.all([
      getJson<ProjectDetail>(`/packages/${projectId}`, { auth: true }),
      getJson<WorkflowDetail>(`/packages/${projectId}/workflows/${workflowId}`, { auth: true }),
      getJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { auth: true }),
    ])
      .then(([projectRes, workflowRes, assetsRes]) => {
        if (cancelled) return;
        if (projectRes.error || workflowRes.error) {
          setError((projectRes.error ?? workflowRes.error)?.message ?? "Failed to load. Please try again later.");
          setProject(null);
          setWorkflow(null);
          setWorkflowVariables([]);
          setProjectArtifacts([]);
          setArtifactsError(null);
          setAssetsJsonRaw("{}");
          setAssetsError(null);
          setProjectAgents([]);
          setAgentsJsonError(null);
          setUnmappedAgentsWarning(null);
          setGraphJsonError(null);
          setStoredStepFiles({});
          setStepFilesJsonError(null);
          setLastSavedSignature(null);
          setSaveStatus("idle");
          setSaveError(null);
          setLoadedWorkflowKey(workflowKey);
          return;
        }
        if (!projectRes.data || !workflowRes.data) {
          setError("Unexpected server response.");
          setProject(null);
          setWorkflow(null);
          setWorkflowVariables([]);
          setProjectArtifacts([]);
          setArtifactsError(null);
          setAssetsJsonRaw("{}");
          setAssetsError(null);
          setProjectAgents([]);
          setAgentsJsonError(null);
          setUnmappedAgentsWarning(null);
          setGraphJsonError(null);
          setStoredStepFiles({});
          setStepFilesJsonError(null);
          setLastSavedSignature(null);
          setSaveStatus("idle");
          setSaveError(null);
          setLoadedWorkflowKey(workflowKey);
          return;
        }
        setError(null);
        setProject(projectRes.data);
        const parsedAgents = parseProjectAgentsJson(projectRes.data.agentsJson);
        setProjectAgents(parsedAgents.agents);
        setAgentsJsonError(parsedAgents.error);
        const parsedArtifacts = parseArtifactsJson(projectRes.data.artifactsJson);
        setProjectArtifacts(parsedArtifacts.dirs);
        setArtifactsError(parsedArtifacts.error);
        if (assetsRes.error) {
          setAssetsError(assetsRes.error.message || "Failed to load assets.");
          setAssetsJsonRaw("{}");
        } else if (!assetsRes.data) {
          setAssetsError("Unexpected server response.");
          setAssetsJsonRaw("{}");
        } else {
          setAssetsJsonRaw(assetsRes.data.assetsJson || "{}");
          setAssetsError(null);
        }

        setWorkflow(workflowRes.data);
        const loadedVariables = parseWorkflowVariablesFromWorkflowMd(workflowRes.data.workflowMd);
        setWorkflowVariables(loadedVariables);

        const parsedGraph = parseGraphJson(workflowRes.data.graphJson, parsedAgents.agents);
        setGraphJsonError(parsedGraph.error);
        const agentWarnings: string[] = [];
        if (parsedGraph.legacyAgentMigrationCount) {
          agentWarnings.push(
            `Auto-migrated legacy agent references to agentId for ${parsedGraph.legacyAgentMigrationCount} nodes (will autosave).`,
          );
        }
        if (parsedGraph.unmappedAgentRefs.length) {
          agentWarnings.push(`Unmapped agent references: ${parsedGraph.unmappedAgentRefs.join(", ")}`);
        }
        const parsedSteps = parseStepFilesJson(workflowRes.data.stepFilesJson);
        const stepKeys = Object.keys(parsedSteps.files);
        const hasLegacyStepFiles = stepKeys.some((k) => k.endsWith(".md") && !k.startsWith("steps/"));
        const frontmatter = extractYamlFrontmatter(workflowRes.data.workflowMd) ?? "";
        const workflowMdIsV11 = /^schemaVersion:\s*["']?1\.1(\.\d+)?["']?\s*$/m.test(frontmatter);
        const shouldAutosaveFiles = Boolean(parsedSteps.error) || !workflowMdIsV11 || hasLegacyStepFiles;
        if (shouldAutosaveFiles) {
          agentWarnings.push("Detected legacy workflow.md / step files: will auto-upgrade to v1.1 and save.");
        }
        setUnmappedAgentsWarning(agentWarnings.length ? agentWarnings.join("; ") : null);

        const nodesWithStepFiles = applyStepFilesToNodes(parsedGraph.graph.nodes, parsedSteps.files);

        if (parsedGraph.graph.nodes.length) {
          setNodes(nodesWithStepFiles);
          setEdges(parsedGraph.graph.edges);
          const nextCounters: Record<WorkflowNodeType, number> = {
            step: 1,
            decision: 1,
            merge: 1,
            end: 1,
            subworkflow: 1,
          };
          parsedGraph.graph.nodes.forEach((node) => {
            const nodeType: WorkflowNodeType = isWorkflowNodeType(node.type) ? node.type : "step";
            const match = new RegExp(`^${nodeType}-(\\d+)$`).exec(node.id);
            if (!match) return;
            nextCounters[nodeType] = Math.max(nextCounters[nodeType], Number(match[1]) + 1);
          });
          nodeIdCountersRef.current = nextCounters;
        } else {
          setNodes(initialNodes);
          setEdges([]);
          nodeIdCountersRef.current = { step: 2, decision: 1, merge: 1, end: 1, subworkflow: 1 };
        }
        setSelectedNodeId(null);

        setStoredStepFiles(parsedSteps.files);
        setStepFilesJsonError(parsedSteps.error);

        const shouldAutosaveGraph = parsedGraph.signatureAfterMigration !== parsedGraph.signatureBeforeMigration;
        setLastSavedSignature(
          JSON.stringify({
            graph: shouldAutosaveGraph ? parsedGraph.signatureBeforeMigration : parsedGraph.signatureAfterMigration,
            variables: workflowVariablesSignature(loadedVariables),
            format: shouldAutosaveFiles ? "legacy" : "v1.1",
          }),
        );
        setSaveStatus("saved");
        setSaveError(null);
        setLoadedWorkflowKey(workflowKey);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load. Please try again later.");
        setProject(null);
        setWorkflow(null);
        setWorkflowVariables([]);
        setProjectArtifacts([]);
        setArtifactsError(null);
        setAssetsJsonRaw("{}");
        setAssetsError(null);
        setProjectAgents([]);
        setAgentsJsonError(null);
        setUnmappedAgentsWarning(null);
        setGraphJsonError(null);
        setStoredStepFiles({});
        setStepFilesJsonError(null);
        setLastSavedSignature(null);
        setSaveStatus("idle");
        setSaveError(null);
        setLoadedWorkflowKey(workflowKey);
      });

    return () => {
      cancelled = true;
    };
  }, [apiEnvError, initialNodes, projectId, ready, setEdges, setNodes, workflowId, workflowKey]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  useEffect(() => {
    setNodeIdDraft(selectedNode?.id ?? "");
    setInspectorError(null);
  }, [selectedNode?.id]);

  const nodeIdPattern = useMemo(() => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/, []);

  const workflowVariablesIssues = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    let emptyKeys = 0;
    for (const item of workflowVariables) {
      const key = item.key.trim();
      if (!key) {
        emptyKeys += 1;
        continue;
      }
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    return { duplicates: Array.from(duplicates), emptyKeys };
  }, [workflowVariables]);

  function nextNodeId(type: WorkflowNodeType, existingIds: Set<string>): string {
    let counter = nodeIdCountersRef.current[type] ?? 1;
    while (existingIds.has(`${type}-${counter}`)) counter += 1;
    nodeIdCountersRef.current = { ...nodeIdCountersRef.current, [type]: counter + 1 };
    return `${type}-${counter}`;
  }

  function onEdgesChange(changes: Parameters<typeof applyEdgeChanges>[0]) {
    setEdges((eds) => {
      let next = applyEdgeChanges(changes, eds);
      const sources = new Set(next.map((e) => e.source));
      for (const source of sources) {
        next = normalizeAutoEdgeLabelsForSource(next, source);
        next = normalizeDecisionDefaultForSource(next, source);
      }
      return next;
    });
  }

  function normalizeAutoEdgeLabelsForSource(
    eds: Edge<WorkflowEdgeData>[],
    sourceId: string,
  ): Edge<WorkflowEdgeData>[] {
    const outgoing = eds.filter((e) => e.source === sourceId);
    const autoOutgoing = outgoing.filter((e) => (e.data?.labelMode ?? "auto") === "auto");
    if (!autoOutgoing.length) return eds;

    if (outgoing.length === 1) {
      const only = autoOutgoing[0];
      if (!only) return eds;
      return eds.map((e) =>
        e.id === only.id
          ? { ...e, label: "next", data: { ...(e.data ?? {}), labelMode: "auto" } }
          : e,
      );
    }

    let idx = 1;
    const relabel = new Map(autoOutgoing.map((e) => [e.id, `branch-${idx++}`] as const));
    return eds.map((e) => {
      const nextLabel = relabel.get(e.id);
      if (!nextLabel) return e;
      return { ...e, label: nextLabel, data: { ...(e.data ?? {}), labelMode: "auto" } };
    });
  }

  function normalizeDecisionDefaultForSource(
    eds: Edge<WorkflowEdgeData>[],
    sourceId: string,
    sourceIsDecision?: boolean,
  ): Edge<WorkflowEdgeData>[] {
    const isDecision =
      typeof sourceIsDecision === "boolean"
        ? sourceIsDecision
        : nodes.find((n) => n.id === sourceId)?.type === "decision";
    if (!isDecision) return eds;

    const outgoing = eds.filter((e) => e.source === sourceId);
    if (!outgoing.length) return eds;

    const keep = outgoing.find((e) => Boolean(e.data?.isDefault)) ?? outgoing[0];
    if (!keep) return eds;

    return eds.map((e) =>
      e.source === sourceId ? { ...e, data: { ...(e.data ?? {}), isDefault: e.id === keep.id } } : e,
    );
  }

  function uniqueEdgeId(source: string, target: string, eds: Edge<WorkflowEdgeData>[]): string {
    const existing = new Set(eds.map((e) => e.id));
    const base = `e-${source}-${target}`;
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  function onDragStart(e: React.DragEvent<HTMLDivElement>, type: WorkflowNodeType) {
    e.dataTransfer.setData("application/reactflow", type);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const rawType = e.dataTransfer.getData("application/reactflow");
    if (!isWorkflowNodeType(rawType)) return;
    if (!reactFlowInstance) return;

    const position = reactFlowInstance.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });

    setNodes((nds) => {
      const existingIds = new Set(nds.map((n) => n.id));
      const nextId = nextNodeId(rawType, existingIds);
      const match = new RegExp(`^${rawType}-(\\d+)$`).exec(nextId);
      const suffix = match ? Number(match[1]) : nds.length + 1;
      const titlePrefix =
        rawType === "decision"
          ? "Decision"
          : rawType === "merge"
            ? "Merge"
            : rawType === "end"
              ? "End"
              : rawType === "subworkflow"
                ? "Subworkflow"
                : "Step";

      return nds.concat({
        id: nextId,
        type: rawType,
        position,
        data: {
          title: `${titlePrefix} ${suffix}`,
          instructions: "",
          agentId: "",
          inputs: [],
          outputs: [],
          setsVariables: [],
          stepFilePath: `steps/${nextId}.md`,
          ...(rawType === "subworkflow" ? { subworkflowId: null } : {}),
        },
      });
    });
  }

  function onConnect(connection: Connection) {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target) return;

    setEdges((eds) => {
      const sourceIsDecision = nodes.find((n) => n.id === source)?.type === "decision";
      const id = uniqueEdgeId(source, target, eds);
      const next = eds.concat({
        id,
        source,
        target,
        label: "",
        data: { labelMode: "auto" },
      });
      const labeled = normalizeAutoEdgeLabelsForSource(next, source);
      return normalizeDecisionDefaultForSource(labeled, source, sourceIsDecision);
    });
  }

  function renameNodeId(oldId: string, nextId: string) {
    const trimmed = nextId.trim();
    if (!trimmed) {
      setInspectorError("nodeId cannot be empty.");
      return;
    }
    if (!nodeIdPattern.test(trimmed)) {
      setInspectorError("Invalid nodeId: must match ^[A-Za-z0-9][A-Za-z0-9._:-]*$");
      return;
    }
    if (nodes.some((n) => n.id === trimmed && n.id !== oldId)) {
      setInspectorError(`nodeId already exists: ${trimmed}`);
      return;
    }

    setInspectorError(null);
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== oldId) return n;
        const currentPath = (n.data?.stepFilePath ?? "").trim();
        const nextPath =
          !currentPath || currentPath === `steps/${oldId}.md` ? `steps/${trimmed}.md` : currentPath;
        return {
          ...n,
          id: trimmed,
          data: {
            ...(n.data ?? {
              title: "",
              instructions: "",
              agentId: "",
              inputs: [],
              outputs: [],
              setsVariables: [],
            }),
            stepFilePath: nextPath,
          },
        };
      }),
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        source: e.source === oldId ? trimmed : e.source,
        target: e.target === oldId ? trimmed : e.target,
      })),
    );
    setSelectedNodeId(trimmed);
  }

  function setEdgeLabel(edgeId: string, nextLabel: string) {
    setEdges((eds) => {
      const trimmed = nextLabel.trim();
      const edge = eds.find((e) => e.id === edgeId);
      if (!edge) return eds;
      const labelMode: WorkflowEdgeData["labelMode"] = trimmed ? "manual" : "auto";
      const updated = eds.map((e) =>
        e.id === edgeId
          ? { ...e, label: trimmed, data: { ...(e.data ?? {}), labelMode } }
          : e,
      );
      if (!trimmed) {
        return normalizeAutoEdgeLabelsForSource(updated, edge.source);
      }
      return updated;
    });
  }

  function setEdgeConditionText(edgeId: string, nextCondition: string) {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === edgeId
          ? { ...e, data: { ...(e.data ?? {}), conditionText: nextCondition.trim() } }
          : e,
      ),
    );
  }

  function setDecisionDefaultEdge(sourceId: string, edgeId: string) {
    setEdges((eds) =>
      eds.map((e) =>
        e.source === sourceId ? { ...e, data: { ...(e.data ?? {}), isDefault: e.id === edgeId } } : e,
      ),
    );
  }

  function addWorkflowVariableKeys(keys: string[]) {
    setWorkflowVariables((vars) => {
      const existing = new Set(vars.map((v) => v.key.trim()).filter((v) => Boolean(v)));
      const additions = keys
        .map((k) => k.trim())
        .filter((k) => Boolean(k) && !existing.has(k))
        .map((k) => ({ key: k, value: "" } satisfies WorkflowVariable));
      if (!additions.length) return vars;
      return vars.concat(additions);
    });
  }

  const execution = useMemo(() => {
    const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const incomingCount = new Map<string, number>();
    const outgoingCount = new Map<string, number>();

    nodes.forEach((node) => {
      indegree.set(node.id, 0);
      outgoing.set(node.id, []);
      incomingCount.set(node.id, 0);
      outgoingCount.set(node.id, 0);
    });

    edges.forEach((edge) => {
      if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) return;

      outgoing.get(edge.source)?.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
      incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
      outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1);
    });

    const warnings: string[] = [];
    const hasEdges = edges.length > 0;
    if (!hasEdges) {
      return { orderedNodes: nodes, warnings, error: null };
    }

    const startNodes = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
    if (startNodes.length !== 1) {
      warnings.push("Detected multiple/no start nodes: order may not be unique (MVP uses topological-sort preview).");
    }

    const hasBranching = nodes.some(
      (n) => (incomingCount.get(n.id) ?? 0) > 1 || (outgoingCount.get(n.id) ?? 0) > 1,
    );
    if (hasBranching) {
      warnings.push("Detected branching/merging: order may not be unique (MVP uses topological-sort preview).");
    }

    const order: Node<WorkflowNodeData>[] = [];
    const queue = startNodes.map((n) => n.id);
    const nextIndegree = new Map(indegree);

    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      const node = nodesById.get(id);
      if (!node) continue;
      order.push(node);

      for (const next of outgoing.get(id) ?? []) {
        const value = (nextIndegree.get(next) ?? 0) - 1;
        nextIndegree.set(next, value);
        if (value === 0) {
          queue.push(next);
        }
      }
    }

    if (order.length !== nodes.length) {
      return { orderedNodes: nodes, warnings, error: "Cycle detected: remove cyclic edges before previewing." };
    }

    return { orderedNodes: order, warnings, error: null };
  }, [edges, nodes]);

  const workflowMdPreview = useMemo(() => {
    const safeName = (workflow?.name ?? "Untitled Workflow").trim() || "Untitled Workflow";
    const currentNodeId = (() => {
      if (!nodes.length) return "";
      if (!edges.length) return nodes.length === 1 ? nodes[0]?.id ?? "" : "";

      const indegree = new Map<string, number>();
      nodes.forEach((n) => indegree.set(n.id, 0));
      edges.forEach((e) => {
        if (!indegree.has(e.source) || !indegree.has(e.target)) return;
        indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
      });

      const startNodes = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
      return startNodes.length === 1 ? startNodes[0]?.id ?? "" : "";
    })();

    const stepsIndex = execution.orderedNodes.map((node) => {
      const file = (node.data?.stepFilePath ?? `steps/${node.id}.md`).trim() || `steps/${node.id}.md`;
      const title = (node.data?.title ?? node.id).trim() || node.id;
      return `- [${node.id}](${file}) — ${title}`;
    });
    const variableLines = serializeWorkflowVariablesToFrontmatter(workflowVariables);
    return (
      "---\n" +
      'schemaVersion: "1.1"\n' +
      'workflowType: "workflow"\n' +
      `currentNodeId: ${JSON.stringify(currentNodeId)}\n` +
      "stepsCompleted: []\n" +
      `${variableLines.join("\n")}\n` +
      "decisionLog: []\n" +
      "artifacts: []\n" +
      "---\n\n" +
      `# ${safeName}\n\n` +
      "## Steps Index\n\n" +
      (stepsIndex.length ? `${stepsIndex.join("\n")}\n` : "")
    );
  }, [edges, execution.orderedNodes, nodes, workflow?.name, workflowVariables]);

  const agentsJsonPreview = useMemo(() => {
    const raw = project?.agentsJson?.trim() || "[]";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, [project?.agentsJson]);

  const stepFilesPreview = useMemo(() => {
    const files: Record<string, string> = {};
    const outgoingBySource = new Map<string, Edge<WorkflowEdgeData>[]>();
    edges.forEach((edge) => {
      const bucket = outgoingBySource.get(edge.source) ?? [];
      bucket.push(edge);
      outgoingBySource.set(edge.source, bucket);
    });

    execution.orderedNodes.forEach((node) => {
      const filename = (node.data?.stepFilePath ?? `steps/${node.id}.md`).trim() || `steps/${node.id}.md`;
      const title = (node.data?.title ?? node.id).trim() || node.id;
      const agentId = (node.data?.agentId ?? "").trim();
      const instructions = (node.data?.instructions ?? "").trim();
      const goal = (node.data?.goal ?? "").trim();
      const completion = (node.data?.completion ?? "").trim();
      const type: WorkflowNodeType = isWorkflowNodeType(node.type) ? node.type : "step";
      const inputs = Array.isArray(node.data?.inputs) ? node.data.inputs : [];
      const outputs = Array.isArray(node.data?.outputs) ? node.data.outputs : [];
      const setsVariables = Array.isArray(node.data?.setsVariables) ? node.data.setsVariables : [];

      const outgoing = (outgoingBySource.get(node.id) ?? [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
      const anyDefault = outgoing.some((e) => Boolean(e.data?.isDefault));

      const transitionsLines: string[] = (() => {
        if (!outgoing.length) return ["transitions: []"];

        const lines = ["transitions:"];
        outgoing.forEach((edge, idx) => {
          const label =
            typeof edge.label === "string" && edge.label
              ? edge.label
              : outgoing.length === 1
                ? "next"
                : `branch-${idx + 1}`;
          const conditionText = edge.data?.conditionText?.trim() ?? "";
          const isDefault =
            outgoing.length === 1 ? true : anyDefault ? Boolean(edge.data?.isDefault) : idx === 0;
          lines.push(`  - to: ${JSON.stringify(edge.target)}`);
          lines.push(`    label: ${JSON.stringify(label)}`);
          if (isDefault) lines.push("    isDefault: true");
          if (conditionText) lines.push(`    conditionText: ${JSON.stringify(conditionText)}`);
        });
        return lines;
      })();

      const frontmatterLines = [
        "---",
        'schemaVersion: "1.1"',
        `nodeId: ${JSON.stringify(node.id)}`,
        `type: ${JSON.stringify(type)}`,
        `title: ${JSON.stringify(title)}`,
        `agentId: ${JSON.stringify(agentId)}`,
        `inputs: ${JSON.stringify(inputs)}`,
        `outputs: ${JSON.stringify(outputs)}`,
        `setsVariables: ${JSON.stringify(setsVariables)}`,
        ...transitionsLines,
        "---",
        "",
      ];

      const body =
        `# ${title}\n\n` +
        (goal ? `## Goal\n\n${goal}\n\n` : "## Goal\n\n") +
        (instructions ? `## Instructions\n\n${instructions}\n` : "## Instructions\n\n") +
        (completion ? `## Completion\n\n${completion}\n` : "");

      files[filename] = `${frontmatterLines.join("\n")}${body}`;
    });
    return files;
  }, [edges, execution.orderedNodes]);

  const graphDraft = useMemo(() => graphForSave(nodes, edges), [edges, nodes]);
  const graphSignature = useMemo(() => graphSignatureFor(nodes, edges), [edges, nodes]);
  const variablesSignature = useMemo(() => workflowVariablesSignature(workflowVariables), [workflowVariables]);
  const contentSignature = useMemo(
    () => JSON.stringify({ graph: graphSignature, variables: variablesSignature, format: "v1.1" }),
    [graphSignature, variablesSignature],
  );
  const dirty = lastSavedSignature !== null && contentSignature !== lastSavedSignature;

  const validateWorkflowGraphV11 = useMemo(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return ajv.compile(workflowGraphSchemaV11 as unknown as Record<string, unknown>);
  }, []);

  const workflowGraphBuild = useMemo(
    () => buildWorkflowGraphV11({ nodes, edges }),
    [edges, nodes],
  );
  const workflowGraphPreview = useMemo(() => {
    if (!workflowGraphBuild.graph) return "";
    return JSON.stringify(workflowGraphBuild.graph, null, 2);
  }, [workflowGraphBuild.graph]);
  const workflowGraphSchemaError = useMemo(() => {
    if (!workflowGraphBuild.graph) return "";
    const ok = validateWorkflowGraphV11(workflowGraphBuild.graph) as boolean;
    if (ok) return "";
    const errors = (validateWorkflowGraphV11.errors ?? []) as ErrorObject[] | null | undefined;
    return formatAjvErrors(errors);
  }, [validateWorkflowGraphV11, workflowGraphBuild.graph]);

  const saveProjectArtifacts = useCallback(
    async (nextArtifacts: string[]): Promise<ProjectDetail | null> => {
      if (!ready) return null;
      if (apiEnvError) return null;
      if (!projectId) return null;

      setArtifactsSaving(true);
      setArtifactsError(null);

      const res = await putJson<ProjectDetail>(
        `/packages/${projectId}/artifacts`,
        { artifacts: nextArtifacts },
        { auth: true },
      );

      if (res.error || !res.data) {
        setArtifactsSaving(false);
        setArtifactsError(res.error?.message ?? "Failed to save artifacts. Please try again later.");
        return null;
      }

      setProject(res.data);
      const parsed = parseArtifactsJson(res.data.artifactsJson);
      setProjectArtifacts(parsed.dirs);
      setArtifactsError(parsed.error);
      setArtifactsSaving(false);
      return res.data;
    },
    [apiEnvError, projectId, ready],
  );

  const saveContent = useCallback(
    async (reason: "auto" | "manual"): Promise<WorkflowDetail | null> => {
      if (!ready) return null;
      if (apiEnvError) return null;
      if (!projectId || !workflowId || !workflowKey) return null;
      if (loadedWorkflowKey !== workflowKey) return null;
      if (execution.error) {
        setSaveStatus("failed");
        setSaveError(execution.error);
        return null;
      }
      if (saveStatus === "saving") return null;

      setSaveStatus("saving");
      setSaveError(null);

      const res = await putJson<WorkflowDetail>(
        `/packages/${projectId}/workflows/${workflowId}/content`,
        {
          workflow_md: workflowMdPreview,
          graph: graphDraft,
          step_files: stepFilesPreview,
        },
        { auth: true },
      );

      if (res.error || !res.data) {
        setSaveStatus("failed");
        setSaveError(res.error?.message ?? "Save failed. Please try again.");
        return null;
      }

      setWorkflow(res.data);

      const parsedGraph = parseGraphJson(res.data.graphJson, projectAgents);
      setGraphJsonError(parsedGraph.error);
      const agentWarnings: string[] = [];
      if (parsedGraph.legacyAgentMigrationCount) {
        agentWarnings.push(
          `Auto-migrated legacy agent references to agentId for ${parsedGraph.legacyAgentMigrationCount} nodes (will autosave).`,
        );
      }
      if (parsedGraph.unmappedAgentRefs.length) {
        agentWarnings.push(`Unmapped agent references: ${parsedGraph.unmappedAgentRefs.join(", ")}`);
      }
      setUnmappedAgentsWarning(agentWarnings.length ? agentWarnings.join("; ") : null);

      const parsedSteps = parseStepFilesJson(res.data.stepFilesJson);
      setStoredStepFiles(parsedSteps.files);
      setStepFilesJsonError(parsedSteps.error);

      setLastSavedSignature(contentSignature);
      setSaveStatus("saved");
      if (reason === "manual") setSaveError(null);
      return res.data;
    },
    [
      apiEnvError,
      contentSignature,
      execution.error,
      graphDraft,
      loadedWorkflowKey,
      projectId,
      projectAgents,
      ready,
      saveStatus,
      stepFilesPreview,
      workflowId,
      workflowKey,
      workflowMdPreview,
    ],
  );

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;
    if (!workflowKey) return;
    if (loadedWorkflowKey !== workflowKey) return;
    if (execution.error) return;
    if (lastSavedSignature === null) return;
    if (!dirty) return;
    if (saveStatus === "saving") return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void saveContent("auto");
    }, 900);

    return () => {
      if (!autosaveTimerRef.current) return;
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    };
  }, [
    apiEnvError,
    dirty,
    execution.error,
    lastSavedSignature,
    loadedWorkflowKey,
    ready,
    saveContent,
    saveStatus,
    workflowKey,
  ]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-zinc-600">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="flex min-h-screen flex-col px-12 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
                <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-base font-semibold">CrewAgent Builder</p>
                <p className="text-xs text-[#94A0B8]">Workflow Editor</p>
              </div>
            </div>
            <p className="mt-2 text-sm text-[#5F6B82]">
              Project: <span className="font-medium text-[#1F2937]">{project?.name ?? "Loading…"}</span>{" "}
              <span className="text-[#94A0B8]">·</span> Workflow:{" "}
              <span className="font-medium text-[#1F2937]">{workflow?.name ?? "Loading…"}</span>{" "}
              <span className="text-[#94A0B8]">·</span>{" "}
              <span className="font-mono text-[#94A0B8]">
                {projectId}/{workflowId}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {execution.error ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  Cannot save: cycle detected
                </span>
              ) : saveStatus === "saving" ? (
                <span className="rounded-full border border-[#DDE3EE] bg-white px-2 py-0.5 text-xs text-[#5F6B82]">
                  Saving…
                </span>
              ) : saveStatus === "failed" ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  Save failed
                </span>
              ) : dirty ? (
                <span className="rounded-full border border-[#DDE3EE] bg-[#FFF4E5] px-2 py-0.5 text-xs text-[#9A5B1A]">
                  Unsaved
                </span>
              ) : (
                <span className="rounded-full border border-[#CDEBD9] bg-[#EAF7F0] px-2 py-0.5 text-xs text-[#2A7A4B]">
                  Saved
                </span>
              )}
              <button
                type="button"
                onClick={() => void saveContent("manual")}
                disabled={
                  !dirty ||
                  saveStatus === "saving" ||
                  Boolean(apiEnvError) ||
                  Boolean(execution.error) ||
                  loadedWorkflowKey !== workflowKey
                }
                className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save now
              </button>
            </div>
            <Link
              href={projectId ? `/builder/${projectId}` : "/dashboard"}
              className="text-xs font-semibold text-[#4F46E5]"
            >
              ← Builder
            </Link>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-xs font-semibold text-[#5F6B82]"
            >
              Logout
            </button>
          </div>
        </header>

        {apiEnvError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {apiEnvError}
          </div>
        ) : null}

        {ready && !apiEnvError && workflowKey && loadedWorkflowKey !== workflowKey ? (
          <p className="mt-6 text-sm text-zinc-600">Loading...</p>
        ) : null}

        {error && loadedWorkflowKey === workflowKey ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            {error}
          </div>
        ) : null}

        {saveStatus === "failed" && saveError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            {saveError}
          </div>
        ) : null}

        {graphJsonError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {graphJsonError}
          </div>
        ) : null}

        {unmappedAgentsWarning ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {unmappedAgentsWarning}
          </div>
        ) : null}

        {stepFilesJsonError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {stepFilesJsonError}
          </div>
        ) : null}

        <div className="mt-6 flex flex-1 min-h-0 gap-4">
          {paletteOpen ? (
            <aside className="w-[260px] shrink-0 space-y-4">
              <div className="rounded-2xl border border-[#DDE3EE] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#1F2937]">Palette</h2>
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(false)}
                    className="rounded-full border border-[#DDE3EE] bg-white px-2 py-1 text-[10px] font-semibold text-[#5F6B82]"
                  >
                    Collapse
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#94A0B8]">Drag nodes onto the canvas.</p>

                <div className="mt-4 space-y-2">
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, "step")}
                    className="cursor-grab select-none rounded-xl border border-[#DDE3EE] bg-[#EEF2F8] px-3 py-2 text-xs font-semibold text-[#1F2937] active:cursor-grabbing"
                  >
                    Step
                  </div>
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, "decision")}
                    className="cursor-grab select-none rounded-xl border border-[#F2D5A6] bg-[#FFF4E5] px-3 py-2 text-xs font-semibold text-[#9A5B1A] active:cursor-grabbing"
                  >
                    Decision
                  </div>
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, "merge")}
                    className="cursor-grab select-none rounded-xl border border-[#CFE5FF] bg-[#EAF5FF] px-3 py-2 text-xs font-semibold text-[#2B6CB0] active:cursor-grabbing"
                  >
                    Merge
                  </div>
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, "end")}
                    className="cursor-grab select-none rounded-xl border border-[#F5C8CB] bg-[#FFEFF0] px-3 py-2 text-xs font-semibold text-[#B23A48] active:cursor-grabbing"
                  >
                    End
                  </div>
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, "subworkflow")}
                    className="cursor-grab select-none rounded-xl border border-[#D9C4FF] bg-[#F3E9FF] px-3 py-2 text-xs font-semibold text-[#6B4BC7] active:cursor-grabbing"
                  >
                    Subworkflow
                  </div>
                </div>
              </div>
            </aside>
          ) : null}

          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[#DDE3EE] bg-white shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between border-b border-[#F1E8E2] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#1F2937]">Canvas</p>
                  <p className="text-xs text-[#94A0B8]">{nodes.length} nodes</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-[#94A0B8]">Drag & Drop · Click</p>
                  {!paletteOpen ? (
                    <button
                      type="button"
                      onClick={() => setPaletteOpen(true)}
                      className="rounded-full border border-[#DDE3EE] bg-white px-2 py-1 text-[10px] font-semibold text-[#5F6B82]"
                    >
                      Show Palette
                    </button>
                  ) : null}
                  {!inspectorOpen ? (
                    <button
                      type="button"
                      onClick={() => setInspectorOpen(true)}
                      className="rounded-full border border-[#DDE3EE] bg-white px-2 py-1 text-[10px] font-semibold text-[#5F6B82]"
                    >
                      Show Inspector
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 bg-white p-3">
                <ReactFlowProvider>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onInit={setReactFlowInstance}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={(_e, node) => {
                      setSelectedNodeId(node.id);
                      setInspectorTab("node");
                      if (!inspectorOpen) setInspectorOpen(true);
                    }}
                    onPaneClick={() => setSelectedNodeId(null)}
                    fitView
                    className="h-full"
                  >
                    <Background gap={18} size={1} color="rgba(232, 221, 216, 1)" />
                    <Controls />
                  </ReactFlow>
                </ReactFlowProvider>
              </div>
            </div>

          </section>

          {inspectorOpen ? (
            <aside className="nokey w-[640px] shrink-0 space-y-4">
              <div className="rounded-3xl border border-[#DDE3EE] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#1F2937]">Inspector</h2>
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(false)}
                    className="rounded-full border border-[#DDE3EE] bg-white px-2 py-1 text-[10px] font-semibold text-[#5F6B82]"
                  >
                    Collapse
                  </button>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectorTab("node")}
                    className={
                      inspectorTab === "node"
                        ? "rounded-full bg-[#4F46E5] px-3 py-1.5 text-xs font-semibold text-white"
                        : "rounded-full border border-[#DDE3EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5F6B82]"
                    }
                  >
                    Node
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectorTab("workflow")}
                    className={
                      inspectorTab === "workflow"
                        ? "rounded-full bg-[#4F46E5] px-3 py-1.5 text-xs font-semibold text-white"
                        : "rounded-full border border-[#DDE3EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5F6B82]"
                    }
                  >
                    Workflow
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectorTab("artifacts")}
                    className={
                      inspectorTab === "artifacts"
                        ? "rounded-full bg-[#4F46E5] px-3 py-1.5 text-xs font-semibold text-white"
                        : "rounded-full border border-[#DDE3EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5F6B82]"
                    }
                  >
                    Artifacts
                  </button>
                </div>

                {inspectorError ? (
                  <div
                    role="alert"
                    className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
                  >
                    {inspectorError}
                  </div>
                ) : null}

                {inspectorTab === "workflow" ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                      In Step instructions you can reference `variables.&lt;key&gt;`. This panel writes to the v1.1{" "}
                      <span className="font-mono">workflow.md</span> frontmatter <span className="font-mono">variables</span>.
                    </div>

                    {workflowVariablesIssues.emptyKeys || workflowVariablesIssues.duplicates.length ? (
                      <div
                        role="alert"
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                      >
                        {workflowVariablesIssues.emptyKeys
                          ? `${workflowVariablesIssues.emptyKeys} empty key(s) (won't be written to workflow.md).`
                          : null}
                        {workflowVariablesIssues.duplicates.length
                          ? `${workflowVariablesIssues.emptyKeys ? "; " : ""}Duplicate keys: ${workflowVariablesIssues.duplicates.join(", ")}`
                          : null}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-900">Variables</h3>
                      <button
                        type="button"
                        onClick={() => setWorkflowVariables((vars) => vars.concat({ key: "", value: "" }))}
                        className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                      >
                        Add
                      </button>
                    </div>

                    {workflowVariables.length ? (
                      <div className="space-y-2">
                        {workflowVariables.map((item, index) => (
                          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) =>
                                setWorkflowVariables((vars) =>
                                  vars.map((v, i) => (i === index ? { ...v, key: e.target.value } : v)),
                                )
                              }
                              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              placeholder="key (e.g. storyKey)"
                            />
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) =>
                                setWorkflowVariables((vars) =>
                                  vars.map((v, i) => (i === index ? { ...v, value: e.target.value } : v)),
                                )
                              }
                              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              placeholder="value (optional)"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setWorkflowVariables((vars) => vars.filter((_v, i) => i !== index))
                              }
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">No variables yet. Click Add to create one.</p>
                    )}

                    {selectedNode?.data.setsVariables?.length ? (
                      <button
                        type="button"
                        onClick={() => addWorkflowVariableKeys(selectedNode.data.setsVariables ?? [])}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Import keys from this node&apos;s setsVariables
                      </button>
                    ) : null}
                  </div>
                ) : inspectorTab === "artifacts" ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                      Manage project-level <span className="font-mono">artifacts/</span> directories (for outputs path
                      selection and validation). Runtime path is <span className="font-mono">@project/artifacts/...</span>.
                    </div>

                    {artifactsError ? (
                      <div
                        role="alert"
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                      >
                        {artifactsError}
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <label htmlFor="artifacts-dir" className="text-sm font-medium">
                        New directory
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="artifacts-dir"
                          type="text"
                          value={artifactsDraft}
                          onChange={(e) => setArtifactsDraft(e.target.value)}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          placeholder="create-story or artifacts/create-story"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const normalized = normalizeArtifactsDir(artifactsDraft);
                            if (normalized.error || !normalized.value) {
                              setArtifactsError(normalized.error ?? "Invalid directory.");
                              return;
                            }
                            if (projectArtifacts.includes(normalized.value)) {
                              setArtifactsError("Directory already exists.");
                              return;
                            }
                            void saveProjectArtifacts(projectArtifacts.concat(normalized.value));
                            setArtifactsDraft("");
                          }}
                          disabled={artifactsSaving || !artifactsDraft.trim()}
                          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {artifactsSaving ? "Saving…" : "Add"}
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500">Saved as `artifacts/&lt;dir&gt;` (directory-level).</p>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-zinc-900">Directories</h3>
                      {projectArtifacts.length ? (
                        <ul className="mt-3 space-y-2">
                          {projectArtifacts.map((dir) => (
                            <li key={dir} className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate font-mono text-xs text-zinc-700">{dir}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = window.prompt("Rename directory", dir);
                                  if (next === null) return;
                                  const normalized = normalizeArtifactsDir(next);
                                  if (normalized.error || !normalized.value) {
                                    setArtifactsError(normalized.error ?? "Invalid directory.");
                                    return;
                                  }
                                  if (projectArtifacts.includes(normalized.value) && normalized.value !== dir) {
                                    setArtifactsError("Directory already exists.");
                                    return;
                                  }
                                  void saveProjectArtifacts(
                                    projectArtifacts.map((d) => (d === dir ? normalized.value! : d)),
                                  );
                                }}
                                disabled={artifactsSaving}
                                className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Rename
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">No directories yet. Try adding `artifacts/create-story`.</p>
                      )}
                    </div>
                  </div>
                ) : selectedNode ? (
                  <div className="mt-4 space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="node-id" className="text-sm font-medium">Node ID (nodeId)</label>
                      <div className="flex gap-2">
                        <input
                          id="node-id"
                          type="text"
                          value={nodeIdDraft}
                          onChange={(e) => {
                            setNodeIdDraft(e.target.value);
                            if (inspectorError) setInspectorError(null);
                          }}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                        />
                        <button
                          type="button"
                          onClick={() => renameNodeId(selectedNode.id, nodeIdDraft)}
                          disabled={nodeIdDraft.trim() === selectedNode.id}
                          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Apply
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500">Used for exporting `steps/&lt;nodeId&gt;.md`.</p>
                    </div>

                    {(selectedNode.type === "step" || selectedNode.type === "decision" || selectedNode.type === "merge" || selectedNode.type === "end" || selectedNode.type === "subworkflow") ? (
                      <StepEditorPanel
                        content={selectedNodeMarkdown}
                        agents={editorAgents}
                        assets={{ items: assetsList, error: assetsError, parseError: assetsParseError }}
                        artifacts={{
                          dirs: projectArtifacts,
                          saving: artifactsSaving,
                          onAddDirs: (dirs) => void saveProjectArtifacts(projectArtifacts.concat(dirs)),
                        }}
                        onSyncWorkflowVariables={(keys) => {
                          addWorkflowVariableKeys(keys);
                          setInspectorTab("workflow");
                        }}
                        onChange={handleStepEditorChange}
                      />
                    ) : null}

                    {selectedNode.type === "subworkflow" ? (
                      <div className="space-y-1.5">
                        <label htmlFor="node-subworkflowId" className="text-sm font-medium">
                          subworkflowId
                        </label>
                        <input
                          id="node-subworkflowId"
                          type="number"
                          value={selectedNode.data.subworkflowId ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            const parsed = value ? Number(value) : null;
                            setNodes((nds) =>
                              nds.map((n) =>
                                n.id === selectedNode.id
                                  ? { ...n, data: { ...n.data, subworkflowId: Number.isFinite(parsed) ? parsed : null } }
                                  : n,
                              ),
                            );
                          }}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          placeholder="target workflow id"
                        />
                        <p className="text-xs text-zinc-500">
                          MVP: reference the target workflow by workflowId (number) for now.
                        </p>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-zinc-900">Outgoing edges</h3>
                      {edges.filter((e) => e.source === selectedNode.id).length ? (
                        <div className="mt-3 space-y-3">
                          {edges
                            .filter((e) => e.source === selectedNode.id)
                            .map((edge) => {
                              const targetTitle =
                                nodes.find((n) => n.id === edge.target)?.data.title ?? edge.target;
                              const isDecision = selectedNode.type === "decision";
                              return (
                                <div key={edge.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                                  <p className="text-xs font-medium text-zinc-700">
                                    → {edge.target}{" "}
                                    <span className="text-zinc-400">·</span>{" "}
                                    <span className="text-zinc-600">{targetTitle}</span>
                                  </p>

                                  <div className="mt-2 grid gap-2">
                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-zinc-700">Label (label)</label>
                                      <input
                                        type="text"
                                        value={typeof edge.label === "string" ? edge.label : ""}
                                        onChange={(e) => setEdgeLabel(edge.id, e.target.value)}
                                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                      />
                                      <p className="text-[11px] text-zinc-500">
                                        If empty, it will be auto-generated (single: next / multi: branch-n).
                                      </p>
                                    </div>

                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-zinc-700">
                                        Condition text (conditionText)
                                      </label>
                                      <input
                                        type="text"
                                        value={edge.data?.conditionText ?? ""}
                                        onChange={(e) => setEdgeConditionText(edge.id, e.target.value)}
                                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                        placeholder="variables.projectType == 'greenfield'"
                                      />
                                    </div>

                                    {isDecision ? (
                                      <label className="flex items-center gap-2 text-xs text-zinc-700">
                                        <input
                                          type="radio"
                                          name={`default-edge-${selectedNode.id}`}
                                          checked={Boolean(edge.data?.isDefault)}
                                          onChange={() => setDecisionDefaultEdge(selectedNode.id, edge.id)}
                                        />
                                        Default branch (isDefault)
                                      </label>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">No outgoing edges yet. Drag a connection to create one.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500">Click a node on the canvas to edit its configuration.</p>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
