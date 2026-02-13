import { getAccessToken } from "@/lib/auth";
import { type ApiError, type ApiResponse, getApiBaseUrl, postJson } from "@/lib/api-client";

export type WorkbenchTargetType = "workflow" | "step" | "agent" | "asset";
export type WorkbenchMode = "create" | "optimize";

type BuildAiWorkbenchUrlOptions = {
  projectId: string;
  targetType: WorkbenchTargetType;
  targetId: string;
  mode?: WorkbenchMode;
  workflowId?: number | null;
  source?: string | null;
  returnTo?: string;
};

export function buildAiWorkbenchUrl({
  projectId,
  targetType,
  targetId,
  mode = "optimize",
  workflowId,
  source,
  returnTo,
}: BuildAiWorkbenchUrlOptions): string {
  const params = new URLSearchParams({
    targetType,
    targetId,
    mode,
  });
  if (typeof workflowId === "number" && Number.isFinite(workflowId) && workflowId > 0) {
    params.set("workflowId", String(Math.floor(workflowId)));
  }
  const normalizedSource = (source ?? "").trim();
  if (normalizedSource) {
    params.set("source", normalizedSource);
  }
  const normalizedReturnTo = (returnTo ?? "").trim();
  if (normalizedReturnTo) {
    params.set("returnTo", normalizedReturnTo);
  }
  return `/builder/${projectId}/ai-workbench?${params.toString()}`;
}

export type AiChangeSetPayload = Record<string, unknown>;

export type WorkflowNodeType = "step" | "decision" | "merge" | "end" | "subworkflow";

export type AiStepNodeDraft = {
  id: string;
  type: WorkflowNodeType;
  title: string;
  agentId: string;
  inputs: string[];
  outputs: string[];
  setsVariables: string[];
  goal: string;
  instructions: string;
  completion: string;
};

export type AiStepContextDraft = {
  workflowName?: string | null;
  workflowVariables?: string[];
  incomingEdges?: Array<Record<string, unknown>>;
  outgoingEdges?: Array<Record<string, unknown>>;
};

export type AiWorkflowContextDraft = {
  workflowId?: number | string | null;
  targetId?: string;
  id?: string;
  [key: string]: unknown;
};

export type AiAgentContextDraft = {
  agentId?: string;
  targetId?: string;
  id?: string;
  [key: string]: unknown;
};

export type AiAssetContextDraft = {
  path?: string;
  targetId?: string;
  id?: string;
  [key: string]: unknown;
};

export type AiSessionOut = {
  sessionId: string;
  projectId: number;
  workflowId: number | null;
  targetType: string;
  targetId: string;
  mode: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AiSessionMessageOut = {
  sessionId: string;
  suggestionVersion: number;
  assistantSummary: string;
  hasChange: boolean;
  valid: boolean;
  changeSetId: string | null;
  normalizedChangeSet: Record<string, unknown> | null;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  thinkingText?: string | null;
  runtimeTrace?: Array<Record<string, unknown>>;
};

export type AiRuntimeEvent = {
  kind: string;
  payload: Record<string, unknown>;
};

export type AiChangeValidateResponse = {
  valid: boolean;
  changeSetId: string | null;
  normalizedChangeSet: Record<string, unknown> | null;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  sessionId: string;
};

export type AiChangeApplyResponse = {
  applied: boolean;
  sessionId: string;
  changeSetId: string;
  summary: Record<string, unknown>;
  warnings: Array<Record<string, unknown>>;
  newRevision: Record<string, number>;
  targetType: string;
};

export type RevisionBase = {
  workflowRevision?: number;
  agentsRevision?: number;
  assetsRevision?: number;
};

export type AiChangeCancelResponse = {
  cancelled: boolean;
  sessionId: string;
  rejectedCount: number;
};

export async function createAiSession(params: {
  projectId: string;
  sessionId: string;
  workflowId?: number | null;
  targetType: WorkbenchTargetType;
  targetId: string;
  mode: WorkbenchMode;
}): Promise<ApiResponse<AiSessionOut>> {
  return postJson<AiSessionOut>(
    `/packages/${params.projectId}/ai/sessions`,
    {
      sessionId: params.sessionId,
      workflowId: params.workflowId ?? null,
      targetType: params.targetType,
      targetId: params.targetId,
      mode: params.mode,
    },
    { auth: true },
  );
}

export async function sendAiSessionMessage(params: {
  projectId: string;
  sessionId: string;
  content: string;
  stepNode?: AiStepNodeDraft | null;
  stepContext?: AiStepContextDraft | null;
  workflowContext?: AiWorkflowContextDraft | null;
  agentContext?: AiAgentContextDraft | null;
  assetContext?: AiAssetContextDraft | null;
}): Promise<ApiResponse<AiSessionMessageOut>> {
  return postJson<AiSessionMessageOut>(
    `/packages/${params.projectId}/ai/sessions/${encodeURIComponent(params.sessionId)}/messages`,
    {
      content: params.content,
      stepNode: params.stepNode ?? null,
      stepContext: params.stepContext ?? null,
      workflowContext: params.workflowContext ?? null,
      agentContext: params.agentContext ?? null,
      assetContext: params.assetContext ?? null,
    },
    { auth: true, timeoutMs: 95_000 },
  );
}

type StreamMessageHandlers = {
  onRuntimeEvent?: (event: AiRuntimeEvent) => void;
};

function parseStreamErrorPayload(payload: unknown): ApiError {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { code: "STREAM_ERROR", message: "Streaming request failed." };
  }
  const record = payload as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : "STREAM_ERROR";
  const message = typeof record.message === "string" && record.message.trim()
    ? record.message
    : "Streaming request failed.";
  return { code, message };
}

function parseSseEventBlock(block: string): { event: string; data: string } | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  return {
    event: eventName,
    data: dataLines.join("\n"),
  };
}

function buildAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function streamAiSessionMessage(
  params: {
    projectId: string;
    sessionId: string;
    content: string;
    stepNode?: AiStepNodeDraft | null;
    stepContext?: AiStepContextDraft | null;
    workflowContext?: AiWorkflowContextDraft | null;
    agentContext?: AiAgentContextDraft | null;
    assetContext?: AiAssetContextDraft | null;
  },
  handlers?: StreamMessageHandlers,
): Promise<ApiResponse<AiSessionMessageOut>> {
  const { baseUrl, error: envError } = getApiBaseUrl();
  if (!baseUrl) {
    return {
      data: null,
      error: { code: "ENV_NOT_CONFIGURED", message: envError ?? "API base URL not configured." },
    };
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, 95_000);

  const response = await fetch(
    `${baseUrl}/packages/${params.projectId}/ai/sessions/${encodeURIComponent(params.sessionId)}/messages?stream=1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        content: params.content,
        stepNode: params.stepNode ?? null,
        stepContext: params.stepContext ?? null,
        workflowContext: params.workflowContext ?? null,
        agentContext: params.agentContext ?? null,
        assetContext: params.assetContext ?? null,
      }),
      signal: abortController.signal,
    },
  ).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "timeout";
    }
    return null;
  });
  clearTimeout(timeoutId);

  if (response === "timeout") {
    return { data: null, error: { code: "REQUEST_TIMEOUT", message: "Request timed out. Please try again later." } };
  }
  if (!response) {
    return { data: null, error: { code: "NETWORK_ERROR", message: "Network error. Please try again later." } };
  }
  if (!response.ok) {
    let errorPayload: unknown = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }
    if (errorPayload && typeof errorPayload === "object" && !Array.isArray(errorPayload)) {
      const maybeDetail = (errorPayload as { detail?: unknown }).detail;
      if (maybeDetail && typeof maybeDetail === "object" && !Array.isArray(maybeDetail)) {
        return { data: null, error: parseStreamErrorPayload(maybeDetail) };
      }
    }
    return {
      data: null,
      error: { code: "STREAM_HTTP_ERROR", message: `Streaming request failed (${response.status}).` },
    };
  }
  if (!response.body) {
    return { data: null, error: { code: "STREAM_ERROR", message: "Streaming response body is empty." } };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: ApiResponse<AiSessionMessageOut> | null = null;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEventBlock(rawBlock);
      if (!parsed) {
        boundary = buffer.indexOf("\n\n");
        continue;
      }
      let parsedJson: unknown = null;
      try {
        parsedJson = JSON.parse(parsed.data) as unknown;
      } catch {
        parsedJson = null;
      }
      if (parsed.event === "runtime") {
        const payload = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
          ? (parsedJson as { kind?: unknown; payload?: unknown })
          : null;
        const kind = typeof payload?.kind === "string" ? payload.kind.trim() : "";
        const eventPayload = payload?.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
          ? (payload.payload as Record<string, unknown>)
          : {};
        if (kind) {
          handlers?.onRuntimeEvent?.({ kind, payload: eventPayload });
        }
      } else if (parsed.event === "result") {
        if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
          const envelope = parsedJson as ApiResponse<AiSessionMessageOut>;
          if ("data" in envelope && "error" in envelope) {
            finalResult = envelope;
          }
        }
      } else if (parsed.event === "error") {
        finalResult = {
          data: null,
          error: parseStreamErrorPayload(parsedJson),
        };
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (finalResult) return finalResult;
  return { data: null, error: { code: "STREAM_ERROR", message: "Streaming response ended unexpectedly." } };
}

export async function validateAiChange(params: {
  projectId: string;
  sessionId: string;
  workflowId?: number | null;
  suggestionVersion: number;
  changeSet?: AiChangeSetPayload | null;
  changeSetId?: string | null;
}): Promise<ApiResponse<AiChangeValidateResponse>> {
  return postJson<AiChangeValidateResponse>(
    `/packages/${params.projectId}/ai/change/validate`,
    {
      sessionId: params.sessionId,
      workflowId: params.workflowId ?? null,
      suggestionVersion: params.suggestionVersion,
      changeSet: params.changeSet ?? null,
      changeSetId: params.changeSetId ?? null,
    },
    { auth: true },
  );
}

export async function applyAiChange(params: {
  projectId: string;
  sessionId: string;
  workflowId?: number | null;
  changeSetId: string;
  revisionBase?: RevisionBase | null;
}): Promise<ApiResponse<AiChangeApplyResponse>> {
  return postJson<AiChangeApplyResponse>(
    `/packages/${params.projectId}/ai/sessions/${encodeURIComponent(params.sessionId)}/apply`,
    {
      sessionId: params.sessionId,
      workflowId: params.workflowId ?? null,
      changeSetId: params.changeSetId,
      confirmSource: "ui_manual_apply",
      revisionBase: params.revisionBase ?? null,
    },
    { auth: true },
  );
}

export async function cancelAiChange(params: {
  projectId: string;
  sessionId: string;
}): Promise<ApiResponse<AiChangeCancelResponse>> {
  return postJson<AiChangeCancelResponse>(
    `/packages/${params.projectId}/ai/sessions/${encodeURIComponent(params.sessionId)}/cancel`,
    { sessionId: params.sessionId },
    { auth: true },
  );
}

export function cancelAiChangeBestEffort(params: {
  projectId: string;
  sessionId: string;
}): void {
  const sessionId = (params.sessionId || "").trim();
  if (!sessionId) return;

  const { baseUrl } = getApiBaseUrl();
  if (!baseUrl) return;

  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  void fetch(
    `${baseUrl}/packages/${params.projectId}/ai/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    },
  ).catch(() => undefined);
}
