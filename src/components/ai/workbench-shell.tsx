"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApplyCancelBar } from "@/components/ai/apply-cancel-bar";
import { ChangePreviewPane } from "@/components/ai/change-preview-pane";
import { ConversationPane, type ConversationMessage, type ConversationStatus } from "@/components/ai/conversation-pane";
import { MarkdownDiffPanel, type RevisionConflictDetail } from "@/components/ai/markdown-diff-panel";
import { getJson } from "@/lib/api-client";
import {
  applyAiChange,
  createAiSession,
  cancelAiChange,
  cancelAiChangeBestEffort,
  type AiChangeSetPayload,
  streamAiSessionMessage,
  type RevisionBase,
  type WorkbenchMode,
  type WorkbenchTargetType,
  type WorkflowNodeType,
} from "@/lib/ai-workbench-client";
import {
  buildPreviewModelFromChangeSet,
  buildValidationLabel,
  estimateTokenUsage,
  formatBudgetHint,
  formatImpactSummary,
  normalizeRevisionBase,
  type WorkbenchPreviewModel,
  type WorkbenchSnapshotState,
} from "@/lib/ai-workbench-model";
import { parseStepMarkdown } from "@/lib/step-parser";

export type WorkbenchTarget = {
  type: WorkbenchTargetType;
  id: string;
  mode: WorkbenchMode;
};

type WorkbenchShellProps = {
  projectId: string;
  target: WorkbenchTarget | null;
  error: string | null;
  workflowId: number | null;
  source?: string | null;
  returnHref?: string;
  onLogout: () => void;
};

type PackageDetail = {
  id: number;
  name: string;
  workflowMd: string;
  agentsJson: string;
  artifactsJson: string;
  graphJson: string;
  stepFilesJson: string;
  workflowsJson: string;
  assetsJson?: string;
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

type WorkflowGraphNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
};

type WorkflowGraphEdge = {
  source: string;
  target: string;
  label?: unknown;
  data?: Record<string, unknown>;
};

type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

type StepContext = {
  nodeId: string;
  stepPath: string;
  stepMarkdown: string;
  type: WorkflowNodeType;
  title: string;
  agentId: string;
  inputs: string[];
  outputs: string[];
  setsVariables: string[];
  goal: string;
  instructions: string;
  completion: string;
  incomingEdges: Array<Record<string, unknown>>;
  outgoingEdges: Array<Record<string, unknown>>;
};

type WorkspaceContext = {
  projectName: string;
  workflowName: string | null;
  graph: WorkflowGraph;
  stepContext: StepContext | null;
  snapshot: WorkbenchSnapshotState;
};

type PreviewState = {
  changeSet: AiChangeSetPayload;
  changeSetId: string | null;
  valid: boolean;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  revisionBase: Required<RevisionBase>;
  preview: WorkbenchPreviewModel;
};

type StepSuggestionResult = {
  hasChange: boolean;
  previewState: PreviewState | null;
};

type RuntimeToolStatus = "running" | "ok" | "failed";

type RuntimeIndicatorState = {
  streaming: boolean;
  phaseText: string | null;
  thinkingText: string | null;
  toolName: string | null;
  toolStatus: RuntimeToolStatus | null;
};

const EMPTY_RUNTIME_INDICATOR: RuntimeIndicatorState = {
  streaming: false,
  phaseText: null,
  thinkingText: null,
  toolName: null,
  toolStatus: null,
};

const TARGET_LABELS: Record<WorkbenchTargetType, string> = {
  workflow: "Workflow",
  step: "Step",
  agent: "Agent",
  asset: "Asset",
};

const MODE_LABELS: Record<WorkbenchMode, string> = {
  create: "Create",
  optimize: "Optimize",
};
const FUNCTION_CALL_MIN_VISIBLE_MS = 700;

function resolveRuntimePhaseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phase = value.trim().toLowerCase();
  if (!phase) return null;
  if (phase === "validating") return "Validating...";
  if (phase === "validation_repair") return "Repairing...";
  return null;
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonValue(raw: string | null | undefined): unknown {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseStringMap(raw: string | null | undefined): Record<string, string> {
  const parsed = parseJsonRecord(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizeNodeType(value: unknown): WorkflowNodeType {
  if (value === "step" || value === "decision" || value === "merge" || value === "end" || value === "subworkflow") {
    return value;
  }
  return "step";
}

function parseWorkflowGraph(raw: string | null | undefined): WorkflowGraph {
  const parsed = parseJsonRecord(raw);
  const nodesValue = parsed.nodes;
  const edgesValue = parsed.edges;
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];

  if (Array.isArray(nodesValue)) {
    for (const item of nodesValue) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const node = item as Record<string, unknown>;
      const id = typeof node.id === "string" ? node.id.trim() : "";
      if (!id) continue;
      const data = node.data && typeof node.data === "object" && !Array.isArray(node.data) ? (node.data as Record<string, unknown>) : undefined;
      nodes.push({
        id,
        type: typeof node.type === "string" ? node.type : undefined,
        data,
      });
    }
  }

  if (Array.isArray(edgesValue)) {
    for (const item of edgesValue) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const edge = item as Record<string, unknown>;
      const source = typeof edge.source === "string" ? edge.source.trim() : "";
      const target = typeof edge.target === "string" ? edge.target.trim() : "";
      if (!source || !target) continue;
      const data = edge.data && typeof edge.data === "object" && !Array.isArray(edge.data) ? (edge.data as Record<string, unknown>) : undefined;
      edges.push({
        source,
        target,
        label: edge.label,
        data,
      });
    }
  }

  return { nodes, edges };
}

function buildStepPathIndex(stepFiles: Record<string, string>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [path, content] of Object.entries(stepFiles)) {
    const parsed = parseStepMarkdown(content);
    if (parsed.success && parsed.data?.frontmatter?.nodeId) {
      const nodeId = parsed.data.frontmatter.nodeId.trim();
      if (nodeId && !index[nodeId]) {
        index[nodeId] = path;
      }
      continue;
    }
    const fallback = path.split("/").at(-1)?.replace(/\.md$/i, "").trim();
    if (fallback && !index[fallback]) {
      index[fallback] = path;
    }
  }
  return index;
}

function parseAgentsById(raw: string | null | undefined): Record<string, Record<string, unknown>> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    const out: Record<string, Record<string, unknown>> = {};

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.agents)) {
        for (const item of obj.agents) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const agent = item as Record<string, unknown>;
          const id = typeof agent.id === "string" ? agent.id.trim() : "";
          if (!id) continue;
          out[id] = agent;
        }
        return out;
      }
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const agent = item as Record<string, unknown>;
        const id = typeof agent.id === "string" ? agent.id.trim() : "";
        if (!id) continue;
        out[id] = agent;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function extractFirstError(errors: Array<Record<string, unknown>>): string | null {
  for (const item of errors) {
    const message = item.message;
    if (typeof message === "string" && message.trim()) {
      const path = typeof item.path === "string" ? item.path.trim() : "";
      if (path) {
        return `${path}: ${message}`;
      }
      return message;
    }
  }
  return null;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `as_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }
  return `as_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function createInitialImpact(): WorkbenchPreviewModel["impact"] {
  return {
    objects: [],
    counts: { workflow: 0, step: 0, agent: 0, asset: 0 },
    riskFlags: [],
    requiresConfirmation: true,
  };
}

function buildStepContext(params: {
  targetId: string;
  graph: WorkflowGraph;
  stepFiles: Record<string, string>;
  stepPathByNodeId: Record<string, string>;
}): StepContext {
  const nodeId = params.targetId.trim();
  const graphNode = params.graph.nodes.find((node) => node.id === nodeId);
  const stepPath = params.stepPathByNodeId[nodeId] || `steps/${nodeId}.md`;
  const stepMarkdown = params.stepFiles[stepPath] ?? "";
  const parsed = stepMarkdown ? parseStepMarkdown(stepMarkdown) : null;
  const frontmatter = parsed?.success ? parsed.data?.frontmatter : null;
  const sections = parsed?.success ? parsed.data?.sections : null;
  const graphData = graphNode?.data ?? {};

  const incomingEdges = params.graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => ({
      from: edge.source,
      to: edge.target,
      label: typeof edge.label === "string" ? edge.label : "",
      conditionText: typeof edge.data?.conditionText === "string" ? edge.data.conditionText : "",
      isDefault: Boolean(edge.data?.isDefault),
    }));
  const outgoingEdges = params.graph.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => ({
      from: edge.source,
      to: edge.target,
      label: typeof edge.label === "string" ? edge.label : "",
      conditionText: typeof edge.data?.conditionText === "string" ? edge.data.conditionText : "",
      isDefault: Boolean(edge.data?.isDefault),
    }));

  return {
    nodeId,
    stepPath,
    stepMarkdown,
    type: normalizeNodeType(frontmatter?.type ?? graphNode?.type),
    title:
      (typeof frontmatter?.title === "string" ? frontmatter.title : "") ||
      (typeof graphData.title === "string" ? graphData.title : "") ||
      nodeId,
    agentId:
      (typeof frontmatter?.agentId === "string" ? frontmatter.agentId : "") ||
      (typeof graphData.agentId === "string" ? graphData.agentId : ""),
    inputs: Array.isArray(frontmatter?.inputs) ? asStringArray(frontmatter.inputs) : asStringArray(graphData.inputs),
    outputs: Array.isArray(frontmatter?.outputs) ? asStringArray(frontmatter.outputs) : asStringArray(graphData.outputs),
    setsVariables: Array.isArray(frontmatter?.setsVariables) ? asStringArray(frontmatter.setsVariables) : asStringArray(graphData.setsVariables),
    goal: sections?.goal ?? (typeof graphData.goal === "string" ? graphData.goal : ""),
    instructions: sections?.instructions ?? (typeof graphData.instructions === "string" ? graphData.instructions : ""),
    completion: sections?.completion ?? (typeof graphData.completion === "string" ? graphData.completion : ""),
    incomingEdges,
    outgoingEdges,
  };
}

function buildApplyMeta(previewState: PreviewState | null): string {
  if (!previewState) return "No validated change set";
  const counts = previewState.preview.impact.counts;
  return `Includes ${counts.asset} asset · ${counts.step} step · ${counts.agent} agent · ${counts.workflow} workflow`;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function extractHints(error: { hints?: unknown; details?: unknown } | null | undefined): string[] {
  const topLevelHints = parseStringList(error?.hints);
  if (topLevelHints.length) return topLevelHints;
  const details = error?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return parseStringList((details as { hints?: unknown }).hints);
}

function toRevisionText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "-";
}

function extractRevisionConflictDetails(details: unknown): RevisionConflictDetail[] {
  if (!Array.isArray(details)) return [];
  const out: RevisionConflictDetail[] = [];
  for (const item of details) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { field?: unknown; provided?: unknown; current?: unknown };
    const field = typeof record.field === "string" ? record.field.trim() : "";
    if (!field) continue;
    out.push({
      field,
      provided: toRevisionText(record.provided),
      current: toRevisionText(record.current),
    });
  }
  return out;
}

export function WorkbenchShell({ projectId, target, error, workflowId, source, returnHref, onLogout }: WorkbenchShellProps) {
  const router = useRouter();

  const targetTypeLabel = target ? TARGET_LABELS[target.type] : "Unknown Target";
  const modeLabel = target ? MODE_LABELS[target.mode] : "";
  const returnLink = returnHref || (projectId ? `/builder/${projectId}` : "/dashboard");

  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("waiting");
  const [composerValue, setComposerValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [contextBudgetHint, setContextBudgetHint] = useState("Context budget: ~0/16000 tokens (0%)");
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [runtimeIndicator, setRuntimeIndicator] = useState<RuntimeIndicatorState>(EMPTY_RUNTIME_INDICATOR);

  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<"idle" | "submitting" | "success" | "failed" | "conflict">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [revisionConflictDetails, setRevisionConflictDetails] = useState<RevisionConflictDetail[]>([]);

  const targetDisplayName = (() => {
    if (!target) return "Unknown";
    if (target.type === "workflow") {
      const workflowName = (workspace?.workflowName ?? "").trim();
      if (workflowName) return workflowName;
    }
    return target.id?.trim() || targetTypeLabel;
  })();

  const suggestionVersionRef = useRef(0);
  const streamingAssistantMessageIdRef = useRef<string | null>(null);
  const runtimeIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const functionCallVisibleUntilRef = useRef(0);
  const delayedThinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExplicitCancellingRef = useRef(false);

  useEffect(() => {
    setWorkspace(null);
    setContextError(null);
    setSessionId(null);
    setMessages([]);
    setStatus("waiting");
    setComposerValue("");
    setBusy(false);
    setLastRequest(null);
    setContextBudgetHint("Context budget: ~0/16000 tokens (0%)");
    setConversationError(null);
    setRuntimeIndicator(EMPTY_RUNTIME_INDICATOR);
    setPreviewState(null);
    setSelectedPath(null);
    setApplyState("idle");
    setApplyError(null);
    setRevisionConflictDetails([]);
    suggestionVersionRef.current = 0;
    streamingAssistantMessageIdRef.current = null;
    if (runtimeIndicatorTimerRef.current) {
      clearTimeout(runtimeIndicatorTimerRef.current);
      runtimeIndicatorTimerRef.current = null;
    }
    functionCallVisibleUntilRef.current = 0;
    if (delayedThinkingTimerRef.current) {
      clearTimeout(delayedThinkingTimerRef.current);
      delayedThinkingTimerRef.current = null;
    }
    isExplicitCancellingRef.current = false;
  }, [projectId, target?.type, target?.id, target?.mode, workflowId]);

  useEffect(() => {
    if (!sessionId) return;
    const activeProjectId = projectId;
    const activeSessionId = sessionId;

    const handleBeforeUnload = () => {
      if (isExplicitCancellingRef.current) return;
      cancelAiChangeBestEffort({ projectId: activeProjectId, sessionId: activeSessionId });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (isExplicitCancellingRef.current) return;
      cancelAiChangeBestEffort({ projectId: activeProjectId, sessionId: activeSessionId });
    };
  }, [projectId, sessionId]);

  const setThinkingIndicator = useCallback(() => {
    setRuntimeIndicator({
      streaming: true,
      phaseText: "Thinking...",
      thinkingText: null,
      toolName: null,
      toolStatus: null,
    });
  }, []);

  const scheduleThinkingAfterFunctionCallWindow = useCallback(() => {
    const now = Date.now();
    const remaining = functionCallVisibleUntilRef.current - now;
    if (remaining <= 0) {
      setThinkingIndicator();
      return;
    }
    if (delayedThinkingTimerRef.current) {
      clearTimeout(delayedThinkingTimerRef.current);
      delayedThinkingTimerRef.current = null;
    }
    delayedThinkingTimerRef.current = setTimeout(() => {
      delayedThinkingTimerRef.current = null;
      setThinkingIndicator();
    }, remaining);
  }, [setThinkingIndicator]);

  useEffect(() => {
    if (!projectId || !target || error) return;

    let cancelled = false;
    setContextLoading(true);
    setContextError(null);

    Promise.all([
      getJson<PackageDetail>(`/packages/${projectId}`, { auth: true }),
      typeof workflowId === "number" && workflowId > 0
        ? getJson<WorkflowDetail>(`/packages/${projectId}/workflows/${workflowId}`, { auth: true })
        : Promise.resolve({ data: null, error: null }),
      getJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { auth: true }),
    ])
      .then(([projectRes, workflowRes, assetsRes]) => {
        if (cancelled) return;

        if (projectRes.error || !projectRes.data) {
          setContextError(projectRes.error?.message ?? "Failed to load project context.");
          setWorkspace(null);
          return;
        }

        if ((target.type === "step" || target.type === "workflow") && (!workflowId || workflowId < 1)) {
          setContextError("workflowId query param is required for current target.");
          setWorkspace(null);
          return;
        }

        if (workflowId && workflowId > 0 && (workflowRes.error || !workflowRes.data)) {
          setContextError(workflowRes.error?.message ?? "Failed to load workflow context.");
          setWorkspace(null);
          return;
        }

        const project = projectRes.data;
        const workflow = workflowRes.data;

        const stepFiles = parseStringMap(workflow?.stepFilesJson ?? project.stepFilesJson);
        const stepPathByNodeId = buildStepPathIndex(stepFiles);
        const graph = parseWorkflowGraph(workflow?.graphJson ?? project.graphJson);
        const assetsByPath = parseStringMap(assetsRes.data?.assetsJson ?? project.assetsJson ?? "{}");
        const agentsById = parseAgentsById(project.agentsJson);

        const workflowMarkdownById: Record<string, string> = {};
        if (workflow) {
          workflowMarkdownById[String(workflow.id)] = workflow.workflowMd ?? "";
        }

        const workflowsParsed = (() => {
          const raw = parseJsonValue(project.workflowsJson);
          if (Array.isArray(raw)) return raw;
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const record = raw as { workflows?: unknown };
            if (Array.isArray(record.workflows)) return record.workflows;
          }
          return [];
        })();
        if (Array.isArray(workflowsParsed)) {
          for (const item of workflowsParsed) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const entry = item as Record<string, unknown>;
            const id = entry.id;
            const workflowMd = typeof entry.workflow_md === "string" ? entry.workflow_md : typeof entry.workflowMd === "string" ? entry.workflowMd : "";
            if ((typeof id === "number" || typeof id === "string") && workflowMd) {
              workflowMarkdownById[String(id)] = workflowMd;
            }
          }
        }

        const snapshot: WorkbenchSnapshotState = {
          workflowMarkdownById,
          stepMarkdownByPath: stepFiles,
          stepPathByNodeId,
          agentsById,
          assetsByPath,
        };

        const stepContext = target.type === "step"
          ? buildStepContext({
            targetId: target.id,
            graph,
            stepFiles,
            stepPathByNodeId,
          })
          : null;

        setWorkspace({
          projectName: project.name,
          workflowName: workflow?.name ?? null,
          graph,
          stepContext,
          snapshot,
        });

      })
      .finally(() => {
        if (cancelled) return;
        setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, target, error, workflowId, source]);

  const appendMessage = useCallback((message: Omit<ConversationMessage, "id">) => {
    const idPrefix = message.role === "assistant" ? "a" : message.role === "user" ? "u" : "s";
    setMessages((prev) => [...prev, { id: createMessageId(idPrefix), ...message }]);
  }, []);

  const upsertAssistantMessage = useCallback((messageId: string, content: string) => {
    setMessages((prev) => {
      let found = false;
      const next = prev.map((message) => {
        if (message.id !== messageId) return message;
        found = true;
        return {
          ...message,
          role: "assistant" as const,
          kind: "chat" as const,
          content,
        };
      });
      if (found) return next;
      return [
        ...next,
        {
          id: messageId,
          role: "assistant" as const,
          kind: "chat" as const,
          content,
        },
      ];
    });
  }, []);

  const streamAssistantMessage = useCallback(
    async (messageId: string, content: string): Promise<void> => {
      const text = content || "";
      upsertAssistantMessage(messageId, "");
      if (!text) return;

      const totalLength = text.length;
      const frames = Math.max(18, Math.min(96, Math.ceil(totalLength / 12)));
      const chunkSize = Math.max(1, Math.ceil(totalLength / frames));
      let cursor = 0;

      while (cursor < totalLength) {
        cursor = Math.min(totalLength, cursor + chunkSize);
        upsertAssistantMessage(messageId, text.slice(0, cursor));
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 16);
        });
      }
    },
    [upsertAssistantMessage],
  );

  const runSuggestion = useCallback(
    async (prompt: string, activeSessionId: string): Promise<StepSuggestionResult> => {
      if (!target) {
        throw new Error("Target is required for AI generation.");
      }
      if ((target.type === "step" || target.type === "workflow") && (!workflowId || workflowId < 1)) {
        throw new Error("Missing workflowId for current target.");
      }
      if (!workspace) {
        throw new Error("Workspace context is not ready yet, please refresh and retry.");
      }

      const requestPayload: Parameters<typeof streamAiSessionMessage>[0] = {
        projectId,
        sessionId: activeSessionId,
        content: prompt,
      };
      let contextTokenSource = "";
      if (target.type === "step") {
        const step = workspace.stepContext;
        if (!step) {
          throw new Error("Step context is not ready yet, please refresh and retry.");
        }
        requestPayload.stepNode = {
          id: step.nodeId,
          type: step.type,
          title: step.title,
          agentId: step.agentId,
          inputs: step.inputs,
          outputs: step.outputs,
          setsVariables: step.setsVariables,
          goal: step.goal,
          instructions: step.instructions,
          completion: step.completion,
        };
        requestPayload.stepContext = {
          workflowName: workspace.workflowName,
          workflowVariables: [],
          incomingEdges: step.incomingEdges,
          outgoingEdges: step.outgoingEdges,
        };
        contextTokenSource = step.stepMarkdown;
      } else if (target.type === "workflow") {
        requestPayload.workflowContext = {
          workflowId,
          targetId: target.id,
          id: target.id,
          workflowName: workspace.workflowName,
        };
        contextTokenSource = workspace.snapshot.workflowMarkdownById[target.id] ?? "";
      } else if (target.type === "agent") {
        requestPayload.agentContext = {
          agentId: target.id,
          targetId: target.id,
          id: target.id,
        };
        contextTokenSource = JSON.stringify(workspace.snapshot.agentsById[target.id] ?? {});
      } else {
        requestPayload.assetContext = {
          path: target.id,
          targetId: target.id,
          id: target.id,
        };
        contextTokenSource = workspace.snapshot.assetsByPath[target.id] ?? "";
      }

      const messageRes = await streamAiSessionMessage(
        requestPayload,
        {
          onRuntimeEvent: (event) => {
            const kind = (event.kind || "").trim().toLowerCase();
            if (kind === "function_call") {
              if (delayedThinkingTimerRef.current) {
                clearTimeout(delayedThinkingTimerRef.current);
                delayedThinkingTimerRef.current = null;
              }
              functionCallVisibleUntilRef.current = Date.now() + FUNCTION_CALL_MIN_VISIBLE_MS;
              const toolName = typeof event.payload.name === "string" ? event.payload.name.trim() : "";
              setRuntimeIndicator({
                streaming: true,
                phaseText: null,
                thinkingText: null,
                toolName: toolName || "function_call",
                toolStatus: "running",
              });
              return;
            }
            if (kind === "thinking") {
              const phaseText = resolveRuntimePhaseText(event.payload?.phase);
              if (phaseText) {
                if (delayedThinkingTimerRef.current) {
                  clearTimeout(delayedThinkingTimerRef.current);
                  delayedThinkingTimerRef.current = null;
                }
                functionCallVisibleUntilRef.current = 0;
                setRuntimeIndicator({
                  streaming: true,
                  phaseText,
                  thinkingText: null,
                  toolName: null,
                  toolStatus: null,
                });
                return;
              }
              scheduleThinkingAfterFunctionCallWindow();
            }
          },
        },
      );
      if (messageRes.error || !messageRes.data) {
        throw new Error(messageRes.error?.message ?? "AI generation failed.");
      }
      const response = messageRes.data;
      const finalAssistantMessage = (response.assistantSummary || "").trim() || `Updated ${target.type} \`${target.id}\`.`;
      const streamMessageId = streamingAssistantMessageIdRef.current || createMessageId("a");
      streamingAssistantMessageIdRef.current = streamMessageId;
      await streamAssistantMessage(streamMessageId, finalAssistantMessage);
      streamingAssistantMessageIdRef.current = null;

      const usageTokens = estimateTokenUsage(prompt) + estimateTokenUsage(contextTokenSource);
      setContextBudgetHint(formatBudgetHint(usageTokens));

      if (!response.hasChange) {
        return {
          hasChange: false,
          previewState: null,
        };
      }

      const normalizedChangeSet = (response.normalizedChangeSet ?? null) as AiChangeSetPayload | null;
      if (!normalizedChangeSet) {
        const detailsMessage = extractFirstError(Array.isArray(response.errors) ? response.errors : [])
          ?? "Server did not return normalizedChangeSet.";
        return {
          hasChange: true,
          previewState: {
            changeSet: {
              schemaVersion: "1.0",
              targetType: target.type,
              mode: target.mode,
              operations: [],
              impact: createInitialImpact(),
              revisions: normalizeRevisionBase(null),
              extensions: {},
            },
            changeSetId: response.changeSetId,
            valid: false,
            errors: Array.isArray(response.errors) && response.errors.length > 0
              ? response.errors
              : [{ message: detailsMessage }],
            warnings: Array.isArray(response.warnings) ? response.warnings : [],
            revisionBase: normalizeRevisionBase(null),
            preview: buildPreviewModelFromChangeSet(
              {
                schemaVersion: "1.0",
                targetType: target.type,
                mode: target.mode,
                operations: [],
                impact: createInitialImpact(),
                revisions: normalizeRevisionBase(null),
                extensions: {},
              } as AiChangeSetPayload,
              workspace.snapshot,
            ),
          },
        };
      }
      const revisionBase = normalizeRevisionBase(
        (normalizedChangeSet as { revisions?: RevisionBase }).revisions ?? null,
      );
      const preview = buildPreviewModelFromChangeSet(normalizedChangeSet, workspace.snapshot);

      return {
        hasChange: true,
        previewState: {
          changeSet: normalizedChangeSet,
          changeSetId: response.changeSetId,
          valid: Boolean(response.valid),
          errors: Array.isArray(response.errors) ? response.errors : [],
          warnings: Array.isArray(response.warnings) ? response.warnings : [],
          revisionBase,
          preview,
        },
      };
    },
    [projectId, scheduleThinkingAfterFunctionCallWindow, streamAssistantMessage, target, workflowId, workspace],
  );

  const sendPrompt = useCallback(
    async (rawPrompt: string, opts?: { retry?: boolean }) => {
      const prompt = rawPrompt.trim();
      if (!prompt) return;
      if (!target || error) return;
      if (busy) return;

      const retry = Boolean(opts?.retry);
      const activeSessionId = sessionId ?? createSessionId();
      if (!sessionId) setSessionId(activeSessionId);

      if (!retry) {
        appendMessage({ role: "user", content: prompt });
      }

      setLastRequest(prompt);
      setBusy(true);
      setStatus("running");
      setConversationError(null);
      setApplyError(null);
      setApplyState("idle");
      setRevisionConflictDetails([]);
      if (!retry) setComposerValue("");
      streamingAssistantMessageIdRef.current = null;
      setRuntimeIndicator({
        streaming: true,
        phaseText: retry ? "Retrying request..." : "Sending message...",
        thinkingText: null,
        toolName: null,
        toolStatus: null,
      });
      if (runtimeIndicatorTimerRef.current) {
        clearTimeout(runtimeIndicatorTimerRef.current);
      }
      runtimeIndicatorTimerRef.current = setTimeout(() => {
        setRuntimeIndicator((prev) => {
          if (!prev.streaming) return prev;
          return {
            ...prev,
            phaseText: "Thinking...",
            thinkingText: null,
          };
        });
      }, 1200);

      try {
        if (!sessionId) {
          const sessionRes = await createAiSession({
            projectId,
            sessionId: activeSessionId,
            workflowId,
            targetType: target.type,
            targetId: target.id,
            mode: target.mode,
          });
          if (sessionRes.error || !sessionRes.data) {
            throw new Error(sessionRes.error?.message ?? "Failed to create AI session.");
          }
        }
        const suggestionResult = await runSuggestion(prompt, activeSessionId);
        if (suggestionResult.hasChange && suggestionResult.previewState) {
          const nextPreview = suggestionResult.previewState;
          setPreviewState(nextPreview);
          setSelectedPath(nextPreview.preview.files[0]?.path ?? null);
          if (!nextPreview.valid) {
            setConversationError(extractFirstError(nextPreview.errors) ?? "Validation failed, review change details.");
          }
        }
        setStatus("waiting");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Request failed.";
        setStatus("failed");
        setConversationError(message);
      } finally {
        if (runtimeIndicatorTimerRef.current) {
          clearTimeout(runtimeIndicatorTimerRef.current);
          runtimeIndicatorTimerRef.current = null;
        }
        if (delayedThinkingTimerRef.current) {
          clearTimeout(delayedThinkingTimerRef.current);
          delayedThinkingTimerRef.current = null;
        }
        functionCallVisibleUntilRef.current = 0;
        streamingAssistantMessageIdRef.current = null;
        setRuntimeIndicator(EMPTY_RUNTIME_INDICATOR);
        setBusy(false);
      }
    },
    [appendMessage, busy, error, projectId, runSuggestion, sessionId, target, workflowId],
  );

  const onRetry = useCallback(() => {
    if (!lastRequest || busy) return;
    void sendPrompt(lastRequest, { retry: true });
  }, [lastRequest, busy, sendPrompt]);

  const onResolveConflict = useCallback(() => {
    if (!lastRequest || busy) return;
    setApplyState("idle");
    setApplyError(null);
    setRevisionConflictDetails([]);
    void sendPrompt(lastRequest, { retry: true });
  }, [busy, lastRequest, sendPrompt]);

  const onApply = useCallback(async () => {
    if (!previewState || !previewState.changeSetId || !sessionId || !target) return;
    if (!previewState.valid) return;
    if (busy || applyState === "submitting") return;

    setApplyState("submitting");
    setApplyError(null);
    setRevisionConflictDetails([]);

    const res = await applyAiChange({
      projectId,
      sessionId,
      workflowId,
      changeSetId: previewState.changeSetId,
      revisionBase: previewState.revisionBase,
    });

    if (res.error || !res.data || !res.data.applied) {
      const hints = extractHints(res.error);
      const base = res.error?.message ?? "Apply failed.";
      const message = hints.length ? `${base} (${hints.join(" / ")})` : base;
      setRevisionConflictDetails([]);
      setApplyState("failed");
      setApplyError(message);
      return;
    }

    const mismatchWarnings = (res.data.warnings ?? []).filter((item) => item?.code === "AI_REVISION_BASE_MISMATCH");
    if (mismatchWarnings.length > 0) {
      setRevisionConflictDetails(extractRevisionConflictDetails(mismatchWarnings));
      setApplyState("conflict");
      setApplyError("Applied with revision mismatch warning. You can refresh/regenerate in current page.");
      setStatus("waiting");
      return;
    }

    setApplyState("success");
    setRevisionConflictDetails([]);
    setStatus("waiting");
    setPreviewState(null);
    setSelectedPath(null);
    setConversationError(null);
  }, [applyState, busy, previewState, projectId, sessionId, target, workflowId]);

  const onCancel = useCallback(async () => {
    isExplicitCancellingRef.current = true;
    if (sessionId) {
      await cancelAiChange({ projectId, sessionId });
    }
    router.push(returnLink);
  }, [projectId, returnLink, router, sessionId]);

  const blockingError = error || contextError;
  const canRetry = Boolean(lastRequest) && status === "failed" && !busy;
  const canApply = Boolean(previewState?.valid && previewState?.changeSetId && sessionId)
    && applyState !== "submitting"
    && applyState !== "conflict"
    && !busy;

  const preview = previewState?.preview ?? {
    files: [],
    diffByPath: {},
    impact: createInitialImpact(),
  };

  const validationTone = previewState == null ? "neutral" : previewState.valid ? "valid" : "invalid";
  const validationLabel = previewState
    ? buildValidationLabel({
      valid: previewState.valid,
      filesCount: preview.files.length,
      errorsCount: previewState.errors.length,
      warningsCount: previewState.warnings.length,
    })
    : "Validation pending";

  const selectedDiffPath = selectedPath && preview.diffByPath[selectedPath] ? selectedPath : preview.files[0]?.path ?? null;
  const diffModel = selectedDiffPath ? preview.diffByPath[selectedDiffPath] ?? null : null;
  const applyGateError = previewState && !previewState.valid
    ? (extractFirstError(previewState.errors) ?? "Validation failed. Apply is disabled.")
    : null;
  const footerError = applyError || applyGateError;

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="w-full px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
              <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold">CrewAgent Builder</p>
              <p className="text-xs text-[#94A0B8]">AI workbench</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href={returnLink} className="text-[#4F46E5]">
              ← Back
            </Link>
            <button type="button" onClick={onLogout} className="text-[#5F6B82]">
              Logout
            </button>
          </div>
        </header>

        <section className="mt-8 rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
          <span className="inline-flex rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5]">
            AI workbench
          </span>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold leading-tight">{targetDisplayName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#5F6B82]">
                <span className="rounded-full border border-[#DDE3EE] bg-[#F8FAFC] px-3 py-1 text-xs font-semibold text-[#5F6B82]">
                  Target
                </span>
                <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-xs font-semibold text-[#1F2937]">
                  {targetDisplayName}
                </span>
                <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-xs font-semibold text-[#5F6B82]">
                  workflowId: {workflowId ?? "-"}
                </span>
                <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-xs font-semibold text-[#5F6B82]">
                  source: {(source ?? "").trim() || "-"}
                </span>
                <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-xs font-semibold text-[#5F6B82]">
                  session: {sessionId ?? "not-started"}
                </span>
              </div>
            </div>
            <div className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-4 py-2 text-xs font-semibold text-[#4F46E5]">
              Mode: {modeLabel || "Unknown"}
            </div>
          </div>
        </section>

        {blockingError ? (
          <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
            <p className="font-semibold">Workbench is unavailable</p>
            <p className="mt-1">{blockingError}</p>
            <Link
              href={returnLink}
              className="mt-3 inline-flex rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700"
            >
              Back
            </Link>
          </section>
        ) : null}

        {!blockingError ? (
          <>
            {contextLoading ? (
              <section className="mt-6 rounded-2xl border border-[#DDE3EE] bg-white px-4 py-3 text-xs text-[#5F6B82]">
                Loading target context...
              </section>
            ) : null}

            <section className="mt-6 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="h-[640px]">
                <ConversationPane
                  messages={messages}
                  status={status}
                  composerValue={composerValue}
                  onComposerChange={setComposerValue}
                  onSend={() => void sendPrompt(composerValue)}
                  onRetry={onRetry}
                  canRetry={canRetry}
                  busy={busy}
                  contextBudgetHint={contextBudgetHint}
                  errorMessage={conversationError}
                  runtimeIndicator={runtimeIndicator}
                />
              </div>

              <div className="min-h-[640px]">
                <ChangePreviewPane
                  files={preview.files}
                  selectedPath={selectedDiffPath}
                  onSelectPath={setSelectedPath}
                  validationLabel={validationLabel}
                  validationTone={validationTone}
                  fileHint="Only changed files are listed here. Inspect detailed before/after below."
                  impactSummary={formatImpactSummary(preview.impact)}
                  impactObjects={preview.impact.objects}
                  riskFlags={preview.impact.riskFlags}
                />
              </div>
            </section>

            <div className="mt-4">
              <MarkdownDiffPanel diffModel={diffModel} revisionConflictDetails={revisionConflictDetails} />
            </div>

            <div className="mt-4">
              <ApplyCancelBar
                policyTitle="Apply policy: validate -> revision check -> atomic commit"
                contextHint={`targetType=${target?.type ?? "unknown"} · targetId=${target?.id ?? "unknown"} · mode=${target?.mode ?? "unknown"} · source=${(source ?? "").trim() || "-"}`}
                applyMetaText={buildApplyMeta(previewState)}
                canApply={canApply}
                applying={applyState === "submitting"}
                conflict={applyState === "conflict"}
                onResolveConflict={applyState === "conflict" ? onResolveConflict : null}
                onCancel={() => void onCancel()}
                onApply={() => void onApply()}
                errorMessage={footerError}
              />
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
