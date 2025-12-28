"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { buildAgentsManifestV11, formatAgentsManifestV11 } from "@/lib/agents-manifest-v11";
import { deleteJson, deleteJsonWithBody, getApiBaseUrl, getJson, postJson, putJson, type ApiError } from "@/lib/api-client";
import { normalizeAssetsPath, parseAssetsJson, toRuntimeAssetPath } from "@/lib/assets-v11";
import { buildBmadManifestV11, formatBmadManifestV11 } from "@/lib/bmad-manifest-v11";
import { buildBmadExportFilesV11, buildZipBytesFromFiles } from "@/lib/bmad-zip-v11";
import { validateExportBundleV11, type ExportValidationIssue } from "@/lib/export/validate-export-bundle-v11";
import { useRequireAuth } from "@/lib/use-require-auth";
import { isValidAgentId, uniqueAgentId } from "@/lib/utils";

type PackageDetail = {
  id: number;
  name: string;
  workflowMd: string;
  agentsJson: string;
  artifactsJson: string;
  graphJson: string;
  stepFilesJson: string;
};

type PackageAssetsOut = {
  assetsJson: string;
};

type AgentListItem = {
  id: string;
  title: string;
  icon: string;
  role: string;
  name: string;
  identity: string;
  communication_style: string;
  principles: string[];
};

type WorkflowListItem = {
  id: number;
  name: string;
  isDefault: boolean;
};

type WorkflowDetail = {
  id: number;
  projectId: number;
  name: string;
  workflowMd: string;
  graphJson: string;
  stepFilesJson: string;
};

const EMPTY_WORKFLOWS: WorkflowListItem[] = [];

const EXPORT_ISSUE_LIMIT = 6;

function triggerBrowserDownload(params: { bytes: Uint8Array; filename: string }): void {
  const blob = new Blob([params.bytes as unknown as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function IssuesAlert(props: { variant: "error" | "warning"; title: string; items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const items = props.items.filter(Boolean);
  if (!items.length) return null;

  const isError = props.variant === "error";
  const visible = expanded ? items : items.slice(0, EXPORT_ISSUE_LIMIT);

  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          : "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      }
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold">{props.title}</p>
        {items.length > EXPORT_ISSUE_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium underline underline-offset-4 hover:text-zinc-700"
          >
            {expanded ? "收起" : `展开（${items.length}）`}
          </button>
        ) : null}
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {visible.map((message, idx) => (
          <li key={`${idx}-${message}`} className="break-words">
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ValidationIssuesAlert(props: { variant: "error" | "warning"; title: string; issues: ExportValidationIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  const issues = props.issues.filter((issue) => issue.severity === props.variant);
  const isError = props.variant === "error";
  if (!issues.length) return null;

  const visible = expanded ? issues : issues.slice(0, EXPORT_ISSUE_LIMIT);
  const groups = new Map<string, ExportValidationIssue[]>();
  visible.forEach((issue) => {
    const key = issue.filePath || "(unknown)";
    const bucket = groups.get(key) ?? [];
    bucket.push(issue);
    groups.set(key, bucket);
  });
  const orderedGroups = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const copyAll = async (): Promise<void> => {
    const text = issues
      .map((issue) => {
        const pointers = [
          issue.instancePath ? `instancePath=${issue.instancePath}` : null,
          issue.schemaPath ? `schemaPath=${issue.schemaPath}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const hint = issue.hint ? ` hint=${issue.hint}` : "";
        return `[${issue.filePath}] ${pointers ? `${pointers} ` : ""}${issue.message}${hint}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          : "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      }
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold">{props.title}</p>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void copyAll()}
            className="text-xs font-medium underline underline-offset-4 hover:text-zinc-700"
          >
            复制全部
          </button>
          {issues.length > EXPORT_ISSUE_LIMIT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium underline underline-offset-4 hover:text-zinc-700"
            >
              {expanded ? "收起" : `展开（${issues.length}）`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {orderedGroups.map(([filePath, group]) => (
          <div key={filePath} className="rounded-lg border border-zinc-200 bg-white/50 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-900">
              <code className="rounded bg-zinc-100 px-1 py-0.5">{filePath}</code>
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {group.map((issue, idx) => (
                <li key={`${filePath}-${idx}-${issue.schemaPath ?? issue.instancePath ?? issue.message}`} className="break-words">
                  <span className="font-medium">{issue.message}</span>
                  {issue.hint ? <span className="ml-1 text-xs text-zinc-700">（{issue.hint}）</span> : null}
                  <div className="mt-0.5 text-[11px] text-zinc-700">
                    {issue.instancePath ? (
                      <>
                        <code className="rounded bg-zinc-100 px-1 py-0.5">instancePath: {issue.instancePath}</code>
                      </>
                    ) : null}
                    {issue.schemaPath ? (
                      <>
                        {issue.instancePath ? <span className="mx-1 text-zinc-400">·</span> : null}
                        <code className="rounded bg-zinc-100 px-1 py-0.5">schemaPath: {issue.schemaPath}</code>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type AgentsManifestV11 = {
  schemaVersion: string;
  agents: Array<{
    id: string;
    metadata: {
      name: string;
      title: string;
      icon: string;
      module?: string;
      description?: string;
      sourceId?: string;
    };
    persona: {
      role: string;
      identity: string;
      communication_style: string;
      principles: string[] | string;
    };
    critical_actions?: string[];
    prompts?: Array<{ id: string; content: string; description?: string }>;
    menu?: unknown[];
    systemPrompt?: string;
    userPromptTemplate?: string;
    discussion?: boolean;
    webskip?: boolean;
    conversational_knowledge?: unknown[];
    tools?: {
      fs?: { enabled?: boolean; maxReadBytes?: number; maxWriteBytes?: number };
      mcp?: { enabled?: boolean; allowedServers?: string[] };
    };
  }>;
};

function parseAgentsJson(raw: string): { manifest: AgentsManifestV11; agents: AgentListItem[]; error: string | null } {
  const trimmed = raw?.trim();
  const empty: AgentsManifestV11 = { schemaVersion: "1.1", agents: [] };
  if (!trimmed) return { manifest: empty, agents: [], error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const existing = new Set<string>();

	    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
	      const obj = parsed as Record<string, unknown>;
	      const schemaVersion = typeof obj.schemaVersion === "string" ? obj.schemaVersion : "1.1";
	      const rawAgents = Array.isArray(obj.agents) ? obj.agents : [];
	      const errors: string[] = [];

	      const manifestAgents = rawAgents
	        .map((item, index) => {
	          if (!item || typeof item !== "object") {
	            errors.push(`agents[${index}] 不是有效对象`);
	            return null;
	          }
	          const agent = item as Record<string, unknown>;
	          const id = typeof agent.id === "string" ? agent.id : "";
	          if (!id) {
	            errors.push(`agents[${index}].id 不能为空`);
	            return null;
	          }
	          if (!isValidAgentId(id)) {
	            errors.push(`agents[${index}].id 不合法：${id}`);
	            return null;
	          }
	          if (existing.has(id)) {
	            errors.push(`存在重复 agentId：${id}`);
	            return null;
	          }
	          existing.add(id);
	          const metadata = (agent.metadata as Record<string, unknown> | undefined) ?? {};
	          const persona = (agent.persona as Record<string, unknown> | undefined) ?? {};

	          const rawName = typeof metadata.name === "string" ? metadata.name : "";
	          const rawTitle = typeof metadata.title === "string" ? metadata.title : "";
	          const rawIcon = typeof metadata.icon === "string" ? metadata.icon : "🧩";

	          const fallbackName = rawName || rawTitle || id || `agent-${index + 1}`;
	          const name = fallbackName;
	          const title = rawTitle || rawName || fallbackName;

          const role = typeof persona.role === "string" ? persona.role : "Agent";
          const identity = typeof persona.identity === "string" ? persona.identity : role || "TBD";
          const communication_style =
            typeof persona.communication_style === "string" ? persona.communication_style : "direct";
          const principlesRaw = persona.principles;
          const principles = Array.isArray(principlesRaw)
            ? principlesRaw.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            : typeof principlesRaw === "string"
              ? principlesRaw
                  .split("\n")
                  .map((p) => p.trim())
	                  .filter((p) => p.length > 0)
	              : [];

	          const normalizedMetadata: AgentsManifestV11["agents"][number]["metadata"] = {
	            name,
            title: title || name,
            icon: rawIcon || "🧩",
            ...(typeof metadata.module === "string" ? { module: metadata.module } : {}),
            ...(typeof metadata.description === "string" ? { description: metadata.description } : {}),
            ...(typeof metadata.sourceId === "string" ? { sourceId: metadata.sourceId } : {}),
          };

          const normalizedPersona: AgentsManifestV11["agents"][number]["persona"] = {
            role: role || "Agent",
            identity: identity || role || "TBD",
            communication_style: communication_style || "direct",
            principles: principles.length ? principles : ["TBD"],
          };

          const critical_actions = Array.isArray(agent.critical_actions)
            ? agent.critical_actions.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            : undefined;

          const prompts = Array.isArray(agent.prompts)
            ? agent.prompts.flatMap((p) => {
                if (!p || typeof p !== "object") return [];
                const obj = p as Record<string, unknown>;
                const pid = typeof obj.id === "string" ? obj.id : "";
                const content = typeof obj.content === "string" ? obj.content : "";
                if (!pid || !content) return [];
                const description = typeof obj.description === "string" ? obj.description : undefined;
                return [{ id: pid, content, ...(description ? { description } : {}) }];
              })
            : undefined;

          const tools: AgentsManifestV11["agents"][number]["tools"] = (() => {
            const rawTools = agent.tools;
            if (!rawTools || typeof rawTools !== "object" || Array.isArray(rawTools)) {
              return { fs: { enabled: true }, mcp: { enabled: false, allowedServers: [] } };
            }

            const toolsObj = rawTools as Record<string, unknown>;
            const rawFs = toolsObj.fs;
            const fsObj =
              rawFs && typeof rawFs === "object" && !Array.isArray(rawFs) ? (rawFs as Record<string, unknown>) : null;
            const rawMcp = toolsObj.mcp;
            const mcpObj =
              rawMcp && typeof rawMcp === "object" && !Array.isArray(rawMcp) ? (rawMcp as Record<string, unknown>) : null;

            const fsEnabled = typeof fsObj?.enabled === "boolean" ? fsObj.enabled : true;
            const maxReadBytes = typeof fsObj?.maxReadBytes === "number" ? fsObj.maxReadBytes : undefined;
            const maxWriteBytes = typeof fsObj?.maxWriteBytes === "number" ? fsObj.maxWriteBytes : undefined;

            const mcpEnabled = typeof mcpObj?.enabled === "boolean" ? mcpObj.enabled : false;
            const allowedServers = Array.isArray(mcpObj?.allowedServers)
              ? (mcpObj.allowedServers as unknown[]).filter((v): v is string => typeof v === "string")
              : [];

            return {
              fs: { enabled: fsEnabled, maxReadBytes, maxWriteBytes },
              mcp: { enabled: mcpEnabled, allowedServers },
            };
          })();

	          const normalized: AgentsManifestV11["agents"][number] = {
	            id,
	            metadata: normalizedMetadata,
	            persona: normalizedPersona,
	            tools,
            ...(critical_actions?.length ? { critical_actions } : {}),
            ...(prompts?.length ? { prompts } : {}),
            ...(Array.isArray(agent.menu) ? { menu: agent.menu } : {}),
            ...(typeof agent.systemPrompt === "string" ? { systemPrompt: agent.systemPrompt } : {}),
            ...(typeof agent.userPromptTemplate === "string" ? { userPromptTemplate: agent.userPromptTemplate } : {}),
            ...(typeof agent.discussion === "boolean" ? { discussion: agent.discussion } : {}),
            ...(typeof agent.webskip === "boolean" ? { webskip: agent.webskip } : {}),
            ...(Array.isArray(agent.conversational_knowledge)
              ? { conversational_knowledge: agent.conversational_knowledge }
              : {}),
          };

	          return normalized;
	        })
	        .filter((item): item is AgentsManifestV11["agents"][number] => Boolean(item));

      const manifest: AgentsManifestV11 = { schemaVersion, agents: manifestAgents };
      const agents: AgentListItem[] = manifestAgents.map((a) => ({
        id: a.id,
        name: a.metadata.name,
        title: a.metadata.title || a.metadata.name,
        icon: a.metadata.icon || "🧩",
        role: a.persona.role || "Agent",
        identity: a.persona.identity || a.persona.role || "TBD",
        communication_style: a.persona.communication_style || "direct",
        principles: Array.isArray(a.persona.principles)
          ? a.persona.principles.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          : typeof a.persona.principles === "string"
            ? a.persona.principles
                .split("\n")
                .map((p) => p.trim())
                .filter((p) => p.length > 0)
            : ["TBD"],
	      }));

	      if (errors.length) {
	        const summary = errors.slice(0, 3).join("；");
	        const suffix = errors.length > 3 ? `……（共 ${errors.length} 处）` : "";
	        return {
	          manifest,
	          agents,
	          error: `agentsJson 存在数据问题：${summary}${suffix}。请先修复后再编辑/保存。`,
	        };
	      }

	      return { manifest, agents, error: null };
	    }

    if (Array.isArray(parsed)) {
      const legacy = parsed as unknown[];
      const agents = legacy
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const obj = item as Record<string, unknown>;
          const name = typeof obj.name === "string" ? obj.name : "";
          const role = typeof obj.role === "string" ? obj.role : "";
          if (!name) return null;

          const id = uniqueAgentId(name, existing);
          existing.add(id);
          return {
            id,
            name,
            title: name,
            icon: "🧩",
            role,
            identity: role || "TBD",
            communication_style: "direct",
            principles: ["TBD"],
          } satisfies AgentListItem;
        })
        .filter((item): item is AgentListItem => Boolean(item));

      const manifest: AgentsManifestV11 = {
        schemaVersion: "1.1",
        agents: agents.map((a) => ({
          id: a.id,
          metadata: { name: a.name, title: a.title, icon: a.icon },
          persona: {
            role: a.role || "Agent",
            identity: a.identity || "TBD",
            communication_style: a.communication_style || "direct",
            principles: a.principles.length ? a.principles : ["TBD"],
          },
          tools: { fs: { enabled: true }, mcp: { enabled: false, allowedServers: [] } },
        })),
      };

      return { manifest, agents, error: null };
    }

    return { manifest: empty, agents: [], error: "agentsJson 格式不正确（应为 v1.1 manifest 或数组）" };
  } catch {
    return { manifest: empty, agents: [], error: "agentsJson 解析失败（非法 JSON）" };
  }
}

function formatLoadError(error: ApiError): { title: string; message: string } {
  switch (error.code) {
    case "PACKAGE_NOT_FOUND":
      return { title: "项目不存在", message: "该项目不存在、已被删除，或你没有权限访问。" };
    case "VALIDATION_ERROR":
      return { title: "项目 ID 无效", message: "URL 中的 projectId 不正确，请返回 Dashboard 重新打开。" };
    case "NETWORK_ERROR":
      return { title: "网络错误", message: "无法连接到后端服务，请稍后重试。" };
    default:
      return { title: "加载失败", message: error.message || "加载失败，请稍后重试。" };
  }
}

function parseArtifactsJson(raw: string): { dirs: string[]; error: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { dirs: [], error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return { dirs: [], error: "artifactsJson 格式不正确（应为数组）" };
    const dirs = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
      .filter((v) => Boolean(v))
      .filter((v) => v.startsWith("artifacts/"));
    return { dirs, error: null };
  } catch {
    return { dirs: [], error: "artifactsJson 解析失败（非法 JSON）" };
  }
}

function normalizeArtifactsDir(input: string): { value: string | null; error: string | null } {
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw) return { value: null, error: "目录不能为空" };
  if (raw.startsWith("/")) return { value: null, error: "目录必须是相对路径" };

  const withoutPrefix = raw.replace(/^\.\/+/, "").replace(/^artifacts\/+/, "");
  const cleaned = withoutPrefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return { value: null, error: "目录不能为空" };
  if (cleaned.split("/").some((part) => part === "..")) return { value: null, error: "目录不能包含 .." };

  return { value: `artifacts/${cleaned}`, error: null };
}

export default function ProjectBuilderPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const projectId = params?.projectId;

  const [data, setData] = useState<PackageDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [workflowsError, setWorkflowsError] = useState<ApiError | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [createWorkflowName, setCreateWorkflowName] = useState("");
  const [createWorkflowError, setCreateWorkflowError] = useState<string | null>(null);
  const [createWorkflowSaving, setCreateWorkflowSaving] = useState(false);
  const [workflowDeletingId, setWorkflowDeletingId] = useState<number | null>(null);

  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentEditingId, setAgentEditingId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentTitle, setAgentTitle] = useState("");
  const [agentIcon, setAgentIcon] = useState("🧩");
  const [agentRole, setAgentRole] = useState("");
  const [agentIdentity, setAgentIdentity] = useState("");
  const [agentCommunicationStyle, setAgentCommunicationStyle] = useState("");
  const [agentPrinciplesText, setAgentPrinciplesText] = useState("");
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentDeletingId, setAgentDeletingId] = useState<string | null>(null);
  const [agentsActionError, setAgentsActionError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportErrors, setExportErrors] = useState<string[]>([]);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [exportValidationIssues, setExportValidationIssues] = useState<ExportValidationIssue[]>([]);

  const [artifactDirs, setArtifactDirs] = useState<string[]>([]);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [artifactsSaving, setArtifactsSaving] = useState(false);

  const [assetsJsonRaw, setAssetsJsonRaw] = useState("{}");
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetEditingPath, setAssetEditingPath] = useState<string | null>(null);
  const [assetPathDraft, setAssetPathDraft] = useState("");
  const [assetContentDraft, setAssetContentDraft] = useState("");
  const [assetFormError, setAssetFormError] = useState<string | null>(null);
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetDeletingPath, setAssetDeletingPath] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;
    if (!projectId) return;

    let cancelled = false;
    Promise.all([
      getJson<PackageDetail>(`/packages/${projectId}`, { auth: true }),
      getJson<WorkflowListItem[]>(`/packages/${projectId}/workflows`, { auth: true }),
      getJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { auth: true }),
    ])
      .then(([projectRes, workflowsRes, assetsRes]) => {
        if (cancelled) return;

        if (projectRes.error) {
          setLoadError(projectRes.error);
          setData(null);
          setArtifactDirs([]);
          setArtifactsError(null);
          setAssetsJsonRaw("{}");
          setAssetsError(null);
        } else if (!projectRes.data) {
          setLoadError({ code: "BAD_RESPONSE", message: "服务返回格式不正确" });
          setData(null);
          setArtifactDirs([]);
          setArtifactsError(null);
          setAssetsJsonRaw("{}");
          setAssetsError(null);
        } else {
          setData(projectRes.data);
          setLoadError(null);
          const parsedArtifacts = parseArtifactsJson(projectRes.data.artifactsJson);
          setArtifactDirs(parsedArtifacts.dirs);
          setArtifactsError(parsedArtifacts.error);
        }

        if (workflowsRes.error) {
          setWorkflowsError(workflowsRes.error);
          setWorkflows([]);
        } else if (!workflowsRes.data) {
          setWorkflowsError({ code: "BAD_RESPONSE", message: "服务返回格式不正确" });
          setWorkflows([]);
        } else {
          setWorkflows(workflowsRes.data);
          setWorkflowsError(null);
        }

        if (assetsRes.error) {
          setAssetsError(assetsRes.error.message || "无法加载 Assets");
          setAssetsJsonRaw("{}");
        } else if (!assetsRes.data) {
          setAssetsError("服务返回格式不正确");
          setAssetsJsonRaw("{}");
        } else {
          setAssetsJsonRaw(assetsRes.data.assetsJson || "{}");
          setAssetsError(null);
        }

        setLoadedProjectId(projectId);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError({ code: "NETWORK_ERROR", message: "网络错误，请稍后重试" });
        setWorkflowsError({ code: "NETWORK_ERROR", message: "网络错误，请稍后重试" });
        setData(null);
        setArtifactDirs([]);
        setArtifactsError(null);
        setWorkflows([]);
        setAssetsError("网络错误，请稍后重试");
        setAssetsJsonRaw("{}");
        setLoadedProjectId(projectId);
      });
    return () => {
      cancelled = true;
    };
  }, [apiEnvError, projectId, ready, reloadSeq]);

  const isLoading = Boolean(ready && !apiEnvError && projectId && loadedProjectId !== projectId);
  const activeError = loadedProjectId === projectId ? loadError : null;
  const activeData = loadedProjectId === projectId ? data : null;
  const activeWorkflows = loadedProjectId === projectId ? workflows : EMPTY_WORKFLOWS;
  const activeWorkflowsError = loadedProjectId === projectId ? workflowsError : null;
  const formattedLoadError = activeError ? formatLoadError(activeError) : null;

  const { manifest: agentsManifest, agents, error: agentsError } = useMemo(
    () => parseAgentsJson(activeData?.agentsJson ?? ""),
    [activeData?.agentsJson],
  );

  const assetsParsed = useMemo(() => parseAssetsJson(assetsJsonRaw), [assetsJsonRaw]);
  const assetsList = assetsParsed.assets;
  const assetsMap = assetsParsed.map;
  const assetsParseError = assetsParsed.error;

  const bmadCreatedAt = useMemo(() => new Date().toISOString(), []);
  const bmadBuild = useMemo(() => {
    if (!activeData) return { manifest: null, warnings: [], errors: [] };
    return buildBmadManifestV11({
      projectName: activeData.name,
      workflows: activeWorkflows,
      createdAt: bmadCreatedAt,
    });
  }, [activeData, activeWorkflows, bmadCreatedAt]);
  const bmadJsonPreview = useMemo(() => {
    if (!bmadBuild.manifest) return "";
    return formatBmadManifestV11(bmadBuild.manifest);
  }, [bmadBuild.manifest]);
  const [bmadCopyStatus, setBmadCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyBmadJson(): Promise<void> {
    if (!bmadJsonPreview) return;
    try {
      await navigator.clipboard.writeText(bmadJsonPreview);
      setBmadCopyStatus("copied");
      window.setTimeout(() => setBmadCopyStatus("idle"), 1500);
    } catch {
      setBmadCopyStatus("failed");
      window.setTimeout(() => setBmadCopyStatus("idle"), 2500);
    }
  }

  const agentsExportBuild = useMemo(() => {
    if (!activeData) return { manifest: null, warnings: [], errors: [] };
    return buildAgentsManifestV11({ agentsJsonRaw: activeData.agentsJson ?? "" });
  }, [activeData]);
  const agentsJsonPreview = useMemo(() => {
    if (!agentsExportBuild.manifest) return "";
    return formatAgentsManifestV11(agentsExportBuild.manifest);
  }, [agentsExportBuild.manifest]);
  const [agentsCopyStatus, setAgentsCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyAgentsJson(): Promise<void> {
    if (!agentsJsonPreview) return;
    try {
      await navigator.clipboard.writeText(agentsJsonPreview);
      setAgentsCopyStatus("copied");
      window.setTimeout(() => setAgentsCopyStatus("idle"), 1500);
    } catch {
      setAgentsCopyStatus("failed");
      window.setTimeout(() => setAgentsCopyStatus("idle"), 2500);
    }
  }

  async function copyTextSilent(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  function resetAgentForm(): void {
    setAgentEditingId(null);
    setAgentName("");
    setAgentTitle("");
    setAgentIcon("🧩");
    setAgentRole("");
    setAgentIdentity("");
    setAgentCommunicationStyle("direct");
    setAgentPrinciplesText("TBD");
    setAgentFormError(null);
  }

  function openCreateAgent(): void {
    if (agentsError) {
      setAgentFormError(`${agentsError}（请先修复 agentsJson 后再创建/编辑）`);
      return;
    }
    resetAgentForm();
    setAgentModalOpen(true);
  }

  function openEditAgent(agentId: string): void {
    if (agentsError) return;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    setAgentEditingId(agentId);
    setAgentName(agent.name);
    setAgentTitle(agent.title);
    setAgentIcon(agent.icon || "🧩");
    setAgentRole(agent.role || "Agent");
    setAgentIdentity(agent.identity || agent.role || "TBD");
    setAgentCommunicationStyle(agent.communication_style || "direct");
    setAgentPrinciplesText((agent.principles?.length ? agent.principles : ["TBD"]).join("\n"));
    setAgentFormError(null);
    setAgentModalOpen(true);
  }

  async function deleteAgent(agentId: string): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (agentDeletingId) return;
    if (agentsError) return;

    setAgentsActionError(null);

    if (agentsManifest.agents.length <= 1) {
      setAgentsActionError("至少需要保留 1 个 Agent");
      return;
    }

    setAgentDeletingId(agentId);

    const refs: Array<{ workflowName: string; workflowId: number; count: number }> = [];
    for (const wf of activeWorkflows) {
      const detail = await getJson<WorkflowDetail>(`/packages/${projectId}/workflows/${wf.id}`, { auth: true });
      if (detail.error || !detail.data) continue;
      try {
        const graph = JSON.parse(detail.data.graphJson) as unknown;
        const nodes = (graph as { nodes?: unknown })?.nodes;
        if (!Array.isArray(nodes)) continue;
        const count = nodes.filter((n) => {
          if (!n || typeof n !== "object") return false;
          const data = (n as { data?: unknown }).data;
          if (!data || typeof data !== "object" || Array.isArray(data)) return false;
          return (data as Record<string, unknown>).agentId === agentId;
        }).length;
        if (count > 0) refs.push({ workflowId: wf.id, workflowName: wf.name, count });
      } catch {
        continue;
      }
    }

    if (refs.length) {
      const summary = refs
        .slice(0, 3)
        .map((r) => `${r.workflowName}(ID:${r.workflowId}) 引用 ${r.count} 次`)
        .join("；");
      setAgentsActionError(`该 Agent 正在被 workflow 节点引用：${summary}。请先在 Editor 解除绑定后再删除。`);
      setAgentDeletingId(null);
      return;
    }

    const target = agentsManifest.agents.find((a) => a.id === agentId);
    const title = target?.metadata?.title || target?.metadata?.name || agentId;
    if (!window.confirm(`确定删除 Agent “${title}” (id: ${agentId}) 吗？`)) {
      setAgentDeletingId(null);
      return;
    }

    const nextManifest: AgentsManifestV11 = {
      schemaVersion: "1.1",
      agents: agentsManifest.agents.filter((a) => a.id !== agentId),
    };

    const res = await putJson<PackageDetail>(`/packages/${projectId}/agents`, { agents: nextManifest }, { auth: true });
    setAgentDeletingId(null);

    if (res.error || !res.data) {
      setAgentsActionError(res.error?.message ?? "删除失败，请稍后重试");
      return;
    }

    setData(res.data);
    setAgentsActionError(null);
  }

  function buildPrinciples(text: string): string[] {
    const lines = text
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return lines.length ? lines : [];
  }

  function agentIdPreview(): string {
    if (agentEditingId) return agentEditingId;
    const base = agentName.trim();
    const ids = new Set(agentsManifest.agents.map((a) => a.id));
    return uniqueAgentId(base || "agent", ids);
  }

  function openCreateWorkflow(): void {
    setCreateWorkflowName("");
    setCreateWorkflowError(null);
    setCreateWorkflowOpen(true);
  }

  async function deleteWorkflow(workflow: WorkflowListItem): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (workflowDeletingId) return;
    if (activeWorkflows.length <= 1) {
      window.alert("至少需要保留 1 个工作流");
      return;
    }

    setWorkflowDeletingId(workflow.id);

    const refs: Array<{ workflowName: string; workflowId: number; count: number }> = [];
    for (const wf of activeWorkflows) {
      if (wf.id === workflow.id) continue;
      const detail = await getJson<WorkflowDetail>(`/packages/${projectId}/workflows/${wf.id}`, { auth: true });
      if (detail.error || !detail.data) continue;
      try {
        const graph = JSON.parse(detail.data.graphJson) as unknown;
        const nodes = (graph as { nodes?: unknown })?.nodes;
        if (!Array.isArray(nodes)) continue;
        const count = nodes.filter((n) => {
          if (!n || typeof n !== "object") return false;
          const data = (n as { data?: unknown }).data;
          if (!data || typeof data !== "object" || Array.isArray(data)) return false;
          return (data as Record<string, unknown>).subworkflowId === workflow.id;
        }).length;
        if (count > 0) refs.push({ workflowId: wf.id, workflowName: wf.name, count });
      } catch {
        continue;
      }
    }

    if (refs.length) {
      const summary = refs
        .slice(0, 3)
        .map((r) => `${r.workflowName}(ID:${r.workflowId}) 引用 ${r.count} 次`)
        .join("；");
      window.alert(`该 workflow 正在被 subworkflow 节点引用：${summary}。请先移除引用后再删除。`);
      setWorkflowDeletingId(null);
      return;
    }

    const label = workflow.isDefault ? `${workflow.name}（默认）` : workflow.name;
    if (!window.confirm(`确定删除工作流 “${label}” (ID: ${workflow.id}) 吗？`)) {
      setWorkflowDeletingId(null);
      return;
    }
    const res = await deleteJson<{ id: number }>(`/packages/${projectId}/workflows/${workflow.id}`, { auth: true });
    setWorkflowDeletingId(null);

    if (res.error) {
      window.alert(res.error.message ?? "删除失败，请稍后重试");
      return;
    }

    onRetry();
  }

  async function createWorkflow(): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (createWorkflowSaving) return;

    const name = createWorkflowName.trim();
    if (!name) {
      setCreateWorkflowError("请填写工作流名称");
      return;
    }
    if (name.length > 200) {
      setCreateWorkflowError("工作流名称过长（最多 200 字符）");
      return;
    }

    setCreateWorkflowSaving(true);
    setCreateWorkflowError(null);
    const res = await postJson<WorkflowListItem>(
      `/packages/${projectId}/workflows`,
      { name },
      { auth: true },
    );
    setCreateWorkflowSaving(false);

    if (res.error || !res.data) {
      setCreateWorkflowError(res.error?.message ?? "创建失败，请稍后重试");
      return;
    }

    const createdWorkflow = res.data;
    setWorkflows((prev) => {
      const next = [...prev, createdWorkflow];
      next.sort((a, b) => a.id - b.id);
      return next;
    });
    setCreateWorkflowOpen(false);
    setCreateWorkflowName("");
    setCreateWorkflowError(null);
  }

  function onRetry(): void {
    if (!projectId) return;
    setLoadedProjectId(null);
    setLoadError(null);
    setReloadSeq((seq) => seq + 1);
  }

  async function persistArtifactDirs(nextDirs: string[]): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (artifactsSaving) return;

    setArtifactsSaving(true);
    setArtifactsError(null);
    const res = await putJson<PackageDetail>(
      `/packages/${projectId}/artifacts`,
      { artifacts: nextDirs },
      { auth: true },
    );
    setArtifactsSaving(false);

    if (res.error || !res.data) {
      setArtifactsError(res.error?.message ?? "保存 artifacts 失败，请稍后重试");
      return;
    }

    setData(res.data);
    const parsed = parseArtifactsJson(res.data.artifactsJson);
    setArtifactDirs(parsed.dirs);
    setArtifactsError(parsed.error);
  }

  async function addArtifactDir(): Promise<void> {
    const normalized = normalizeArtifactsDir(artifactDraft);
    if (normalized.error || !normalized.value) {
      setArtifactsError(normalized.error ?? "目录不合法");
      return;
    }
    if (artifactDirs.includes(normalized.value)) {
      setArtifactsError("目录已存在");
      return;
    }
    await persistArtifactDirs(artifactDirs.concat(normalized.value));
    setArtifactDraft("");
  }

  function resetAssetForm(): void {
    setAssetEditingPath(null);
    setAssetPathDraft("");
    setAssetContentDraft("");
    setAssetFormError(null);
  }

  function openCreateAsset(): void {
    resetAssetForm();
    setAssetModalOpen(true);
  }

  function openEditAsset(path: string): void {
    const content = assetsMap[path];
    if (typeof content !== "string") return;
    setAssetEditingPath(path);
    setAssetPathDraft(path);
    setAssetContentDraft(content);
    setAssetFormError(null);
    setAssetModalOpen(true);
  }

  async function saveAsset(): Promise<void> {
    if (apiEnvError) {
      setAssetFormError(apiEnvError);
      return;
    }
    if (!projectId) return;
    if (assetSaving) return;

    const normalized = normalizeAssetsPath(assetPathDraft);
    if (normalized.error || !normalized.value) {
      setAssetFormError(normalized.error ?? "path 不合法");
      return;
    }

    const path = assetEditingPath ?? normalized.value;
    if (!assetEditingPath && assetsMap[path]) {
      setAssetFormError("path 已存在，请改名或使用编辑");
      return;
    }

    const content = assetContentDraft ?? "";

    setAssetSaving(true);
    setAssetFormError(null);

    const res = assetEditingPath
      ? await putJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { path, content }, { auth: true })
      : await postJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { path, content }, { auth: true });

    setAssetSaving(false);

    if (res.error || !res.data) {
      setAssetFormError(res.error?.message ?? "保存失败，请稍后重试");
      return;
    }

    setAssetsJsonRaw(res.data.assetsJson || "{}");
    setAssetsError(null);
    setAssetModalOpen(false);
    resetAssetForm();
  }

  async function deleteAsset(path: string): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (assetDeletingPath) return;

    if (!window.confirm(`确定删除资产 “${path}” 吗？`)) return;

    setAssetDeletingPath(path);
    const res = await deleteJsonWithBody<PackageAssetsOut>(`/packages/${projectId}/assets`, { path }, { auth: true });
    setAssetDeletingPath(null);

    if (res.error || !res.data) {
      window.alert(res.error?.message ?? "删除失败，请稍后重试");
      return;
    }

    setAssetsJsonRaw(res.data.assetsJson || "{}");
    setAssetsError(null);
  }

  async function saveAgent(): Promise<void> {
    if (apiEnvError) {
      setAgentFormError(apiEnvError);
      return;
    }
    if (!projectId) return;
    if (agentSaving) return;
    if (agentsError) {
      setAgentFormError(`${agentsError}（请先修复 agentsJson 后再保存）`);
      return;
    }

    const name = agentName.trim();
    const role = agentRole.trim();
    const title = agentTitle.trim() || role || name;
    const icon = agentIcon.trim() || "🧩";
    const identity = agentIdentity.trim() || role || "TBD";
    const communication_style = agentCommunicationStyle.trim() || "direct";
    const principles = buildPrinciples(agentPrinciplesText);

    if (!name) {
      setAgentFormError("请填写 metadata.name");
      return;
    }
    if (!role) {
      setAgentFormError("请填写 persona.role");
      return;
    }
    if (!title) {
      setAgentFormError("请填写 metadata.title");
      return;
    }
    if (!icon) {
      setAgentFormError("请填写 metadata.icon");
      return;
    }
    if (!identity) {
      setAgentFormError("请填写 persona.identity");
      return;
    }
    if (!communication_style) {
      setAgentFormError("请填写 persona.communication_style");
      return;
    }
    if (!principles.length) {
      setAgentFormError("persona.principles 至少 1 条（每行一条）");
      return;
    }

    if (name.length > 100) {
      setAgentFormError("metadata.name 过长（最多 100 字符）");
      return;
    }
    if (title.length > 100) {
      setAgentFormError("metadata.title 过长（最多 100 字符）");
      return;
    }
    if (icon.length > 20) {
      setAgentFormError("metadata.icon 过长（最多 20 字符）");
      return;
    }
    if (role.length > 200) {
      setAgentFormError("persona.role 过长（最多 200 字符）");
      return;
    }
    if (communication_style.length > 200) {
      setAgentFormError("persona.communication_style 过长（最多 200 字符）");
      return;
    }

    const nameConflict = agentsManifest.agents.some(
      (a) => a.id !== agentEditingId && a.metadata?.name?.trim().toLowerCase() === name.toLowerCase(),
    );
    if (nameConflict) {
      setAgentFormError("metadata.name 已存在，请使用不同的 name");
      return;
    }

    const nextManifest: AgentsManifestV11 = {
      schemaVersion: "1.1",
      agents: [...agentsManifest.agents],
    };

    if (agentEditingId) {
      const idx = nextManifest.agents.findIndex((a) => a.id === agentEditingId);
      if (idx === -1) {
        setAgentFormError("Agent 不存在或已被删除，请刷新后重试");
        return;
      }
      const current = nextManifest.agents[idx];
      nextManifest.agents[idx] = {
        ...current,
        metadata: {
          ...current.metadata,
          name,
          title,
          icon,
        },
        persona: {
          ...current.persona,
          role,
          identity,
          communication_style,
          principles,
        },
        tools: current.tools ?? { fs: { enabled: true }, mcp: { enabled: false, allowedServers: [] } },
      };
    } else {
      const ids = new Set(nextManifest.agents.map((a) => a.id));
      const id = uniqueAgentId(name, ids);
      if (!isValidAgentId(id)) {
        setAgentFormError("生成的 agentId 不合法，请修改 metadata.name 后重试");
        return;
      }
      nextManifest.agents.push({
        id,
        metadata: { name, title, icon },
        persona: { role, identity, communication_style, principles },
        tools: { fs: { enabled: true }, mcp: { enabled: false, allowedServers: [] } },
      });
    }

    setAgentSaving(true);
    setAgentFormError(null);
    const res = await putJson<PackageDetail>(`/packages/${projectId}/agents`, { agents: nextManifest }, { auth: true });
    setAgentSaving(false);

    if (res.error || !res.data) {
      const details = res.error?.details
        ? Object.entries(res.error.details)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ")
        : "";
      setAgentFormError(details ? `${res.error?.message ?? "保存失败"}（${details}）` : res.error?.message ?? "保存失败，请稍后重试");
      return;
    }

    setData(res.data);
    setAgentModalOpen(false);
    resetAgentForm();
  }

  async function exportPackageV11(): Promise<void> {
    if (apiEnvError) {
      setExportErrors([apiEnvError]);
      return;
    }
    if (!projectId) return;
    if (!activeData) return;
    if (exporting) return;

    setExportErrors([]);
    setExportWarnings([]);
    setExportValidationIssues([]);

    if (!bmadBuild.manifest) {
      setExportErrors(bmadBuild.errors.length ? bmadBuild.errors : ["无法生成 bmad.json"]);
      return;
    }
    if (!agentsExportBuild.manifest) {
      setExportErrors(agentsExportBuild.errors.length ? agentsExportBuild.errors : ["无法生成 agents.json"]);
      return;
    }
    if (assetsError) {
      setExportErrors([`Assets 加载失败：${assetsError}`]);
      return;
    }
    if (assetsParseError) {
      setExportErrors([assetsParseError]);
      return;
    }

    setExporting(true);
    try {
      const detailResults = await Promise.all(
        activeWorkflows.map(async (wf) => {
          const res = await getJson<WorkflowDetail>(`/packages/${projectId}/workflows/${wf.id}`, { auth: true });
          if (res.error || !res.data) {
            return { ok: false as const, workflow: wf, message: res.error?.message ?? "加载失败" };
          }
          return { ok: true as const, data: res.data };
        }),
      );

      const failures = detailResults.filter((r): r is { ok: false; workflow: WorkflowListItem; message: string } => !r.ok);
      if (failures.length) {
        const first = failures[0];
        setExportErrors([`无法加载 workflow：${first.workflow.name}(ID:${first.workflow.id}) - ${first.message}`]);
        return;
      }

      const workflowDetails = detailResults
        .filter((r): r is { ok: true; data: WorkflowDetail } => r.ok)
        .map((r) => r.data);

      const exportFiles = buildBmadExportFilesV11({
        projectName: activeData.name,
        bmadJson: bmadJsonPreview,
        agentsJson: agentsJsonPreview,
        workflows: workflowDetails,
        ...(Object.keys(assetsMap).length ? { assets: assetsMap } : {}),
      });

      if (!exportFiles.filesByPath) {
        setExportErrors(exportFiles.errors.length ? exportFiles.errors : ["导出失败，请稍后重试"]);
        setExportWarnings(exportFiles.warnings);
        return;
      }

      setExportWarnings(exportFiles.warnings);

      const validation = validateExportBundleV11({ filesByPath: exportFiles.filesByPath });
      if (!validation.ok) {
        setExportValidationIssues(validation.issues);
        return;
      }

      const zipBytes = await buildZipBytesFromFiles(exportFiles.filesByPath);
      triggerBrowserDownload({ bytes: new Uint8Array(zipBytes), filename: exportFiles.filename });
    } catch {
      setExportErrors(["导出失败，请稍后重试"]);
    } finally {
      setExporting(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="w-full max-w-none px-6 py-16">
          <p className="text-sm text-zinc-600">正在跳转...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="w-full max-w-none px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ProjectBuilder</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {activeData ? (
                <>
                  {activeData.name} <span className="text-zinc-400">·</span> ID: {activeData.id}
                </>
              ) : projectId ? (
                <>Project ID: {projectId}</>
              ) : (
                "加载中..."
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => void exportPackageV11()}
              disabled={
                exporting ||
                isLoading ||
                Boolean(activeError) ||
                Boolean(activeWorkflowsError) ||
                Boolean(assetsError) ||
                Boolean(assetsParseError) ||
                Boolean(apiEnvError) ||
                !bmadBuild.manifest ||
                !agentsExportBuild.manifest
              }
              className="rounded-lg bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "导出中..." : "Export Package (v1.1)"}
            </button>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
              返回 Dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
	              退出登录
	            </button>
          </div>
        </header>

        {exportErrors.length ? <div className="mt-6"><IssuesAlert variant="error" title="导出被阻断" items={exportErrors} /></div> : null}

        {exportValidationIssues.some((issue) => issue.severity === "error") ? (
          <div className="mt-4">
            <ValidationIssuesAlert variant="error" title="Schema/frontmatter 校验失败" issues={exportValidationIssues} />
          </div>
        ) : null}

        {exportWarnings.length ? <div className="mt-4"><IssuesAlert variant="warning" title="导出警告" items={exportWarnings} /></div> : null}

        {apiEnvError ? (
          <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {apiEnvError}
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-12 gap-6">
          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">工作流</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openCreateWorkflow}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError)}
                  className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  新建工作流
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : activeWorkflows.length}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">加载中...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">无法加载工作流。</p>
              </div>
            ) : activeWorkflowsError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">无法加载工作流。</p>
              </div>
            ) : activeWorkflows.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">暂无工作流，请先创建一个工作流。</p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {activeWorkflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left hover:bg-zinc-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/editor/${projectId}/${wf.id}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-medium text-zinc-950">
                          {wf.name}{" "}
                          {wf.isDefault ? (
                            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">
                              默认
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 truncate text-xs text-zinc-500">ID: {wf.id}</p>
                      </button>
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void deleteWorkflow(wf)}
                          disabled={
                            isLoading ||
                            Boolean(activeError) ||
                            Boolean(apiEnvError) ||
                            workflowDeletingId === wf.id
                          }
                          className="text-xs font-medium text-red-700 underline underline-offset-4 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {workflowDeletingId === wf.id ? "删除中..." : "删除"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-6">
            <h2 className="text-sm font-semibold text-zinc-900">概览</h2>
            <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
              {isLoading ? (
                <p className="text-sm text-zinc-600">加载中...</p>
              ) : apiEnvError ? (
                <p className="text-sm text-zinc-700">{apiEnvError}</p>
              ) : activeError ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-950">{formattedLoadError?.title}</p>
                    <p className="mt-1 text-sm text-zinc-700">{formattedLoadError?.message}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                    >
                      重试
                    </button>
                    <Link
                      href="/dashboard"
                      className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                    >
                      返回 Dashboard
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    这是 ProjectBuilder 的壳：在这里你可以看到项目的 workflows 与 agents，并进入 workflow editor。
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Multi-workflow 创建/切换（Story 3.9）、Agents v1.1 字段编辑（Story 3.10）已完成；Workflow Editor
                    的全屏/多节点类型/分支配置/variables/artifacts（Story 3.11）正在补齐。
                  </p>

                  <details className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
                    <summary className="cursor-pointer select-none text-xs font-medium text-zinc-900">
                      bmad.json (preview)
                    </summary>
                    <div className="mt-3 space-y-3">
                      {bmadBuild.errors.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                        >
                          {bmadBuild.errors.join("；")}
                        </div>
                      ) : null}

                      {bmadBuild.warnings.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        >
                          {bmadBuild.warnings.join("；")}
                        </div>
                      ) : null}

	                      {!isLoading && !activeError && !activeWorkflowsError && bmadJsonPreview ? (
	                        <>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500">用于 Story 3.16 的整包导出（ZIP root: bmad.json）。</p>
                            <button
                              type="button"
                              onClick={() => void copyBmadJson()}
                              disabled={!bmadJsonPreview}
                              className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {bmadCopyStatus === "copied"
                                ? "Copied"
                                : bmadCopyStatus === "failed"
                                  ? "Copy failed"
                                  : "Copy"}
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
                            {bmadJsonPreview}
                          </pre>
                        </>
	                      ) : bmadBuild.errors.length ? null : (
	                        <p className="text-sm text-zinc-600">
	                          {isLoading ? "加载中..." : "暂无可预览内容（请确保已创建至少 1 个 workflow）"}
	                        </p>
	                      )}
                    </div>
                  </details>

                  <details className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
                    <summary className="cursor-pointer select-none text-xs font-medium text-zinc-900">
                      agents.json (preview)
                    </summary>
                    <div className="mt-3 space-y-3">
                      {agentsExportBuild.errors.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                        >
                          {agentsExportBuild.errors.join("；")}
                        </div>
                      ) : null}

                      {agentsExportBuild.warnings.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        >
                          {agentsExportBuild.warnings.join("；")}
                        </div>
                      ) : null}

	                      {!isLoading && !activeError && agentsJsonPreview ? (
	                        <>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500">用于 Story 3.16 的整包导出（ZIP root: agents.json）。</p>
                            <button
                              type="button"
                              onClick={() => void copyAgentsJson()}
                              disabled={!agentsJsonPreview}
                              className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {agentsCopyStatus === "copied"
                                ? "Copied"
                                : agentsCopyStatus === "failed"
                                  ? "Copy failed"
                                  : "Copy"}
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
                            {agentsJsonPreview}
                          </pre>
                        </>
	                      ) : agentsExportBuild.errors.length ? null : (
	                        <p className="text-sm text-zinc-600">
	                          {isLoading ? "加载中..." : "暂无可预览内容（请确保已创建至少 1 个 Agent）"}
	                        </p>
	                      )}
                    </div>
                  </details>
                </>
              )}
            </div>
          </section>

          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Agents</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openCreateAgent}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError) || Boolean(agentsError)}
                  className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  新建 Agent
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : agents.length}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">加载中...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">无法加载 Agents。</p>
              </div>
            ) : (
              <>
                {agentsError ? (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                  >
                    {agentsError}
                  </div>
                ) : null}

                {agentsActionError ? (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    {agentsActionError}
                  </div>
                ) : null}

                {agents.length === 0 && !agentsError ? (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-sm text-zinc-600">暂无 Agents。</p>
                  </div>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {agents.map((a) => (
                      <li key={a.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-950">
                              <span className="mr-2">{a.icon || "🧩"}</span>
                              {a.title || a.name}
                            </p>
                            <p className="mt-1 truncate text-xs text-zinc-500">{a.role || "Agent"}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-zinc-400">id: {a.id}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEditAgent(a.id)}
                              disabled={Boolean(agentsError) || agentDeletingId === a.id}
                              className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteAgent(a.id)}
                              disabled={Boolean(agentsError) || agentDeletingId === a.id}
                              className="text-xs font-medium text-red-700 underline underline-offset-4 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {agentDeletingId === a.id ? "删除中..." : "删除"}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Artifacts</h2>
              <span className="text-xs text-zinc-500">{isLoading ? "…" : artifactDirs.length}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              管理 project-level <span className="font-mono">artifacts/</span> 目录；用于 workflow node 的{" "}
              <span className="font-mono">outputs</span> 路径选择与校验（运行时为{" "}
              <span className="font-mono">@project/artifacts/...</span>）。
            </p>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">加载中...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">无法加载 Artifacts。</p>
              </div>
            ) : (
              <>
                {artifactsError ? (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    {artifactsError}
                  </div>
                ) : null}

                <div className="mt-4 space-y-2">
                  <label className="block text-xs font-medium text-zinc-700" htmlFor="artifact-dir">
                    新建目录
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="artifact-dir"
                      value={artifactDraft}
                      onChange={(e) => setArtifactDraft(e.target.value)}
                      placeholder="create-story 或 artifacts/create-story"
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                    />
                    <button
                      type="button"
                      onClick={() => void addArtifactDir()}
                      disabled={artifactsSaving || !artifactDraft.trim() || Boolean(apiEnvError)}
                      className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {artifactsSaving ? "保存中..." : "添加"}
                    </button>
                  </div>
                </div>

                {artifactDirs.length ? (
                  <ul className="mt-4 space-y-2">
                    {artifactDirs.map((dir) => (
                      <li key={dir} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-mono text-xs text-zinc-700">{dir}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = window.prompt("重命名目录", dir);
                            if (next === null) return;
                            const normalized = normalizeArtifactsDir(next);
                            if (normalized.error || !normalized.value) {
                              setArtifactsError(normalized.error ?? "目录不合法");
                              return;
                            }
                            if (artifactDirs.includes(normalized.value) && normalized.value !== dir) {
                              setArtifactsError("目录已存在");
                              return;
                            }
                            void persistArtifactDirs(artifactDirs.map((d) => (d === dir ? normalized.value! : d)));
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
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-sm text-zinc-600">暂无目录，可先添加 artifacts/create-story。</p>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Assets</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openCreateAsset}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError) || assetSaving}
                  className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  新建 Asset
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : assetsList.length}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              管理 package-level <span className="font-mono">assets/</span>；随 `.bmad` 一起导出并在 Runtime 以{" "}
              <span className="font-mono">@pkg/assets/...</span> 只读访问。
            </p>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">加载中...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">无法加载 Assets。</p>
              </div>
            ) : (
              <>
                {assetsError || assetsParseError ? (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    {assetsError || assetsParseError}
                  </div>
                ) : null}

                {!assetsList.length && !(assetsError || assetsParseError) ? (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-sm text-zinc-600">暂无 Assets。</p>
                  </div>
                ) : (
                  <>
                    <p className="mt-3 text-[11px] text-zinc-500">
                      总大小：{Math.round(assetsParsed.totalBytes / 1024)} KiB
                    </p>
                    <ul className="mt-2 space-y-2">
                      {assetsList.map((asset) => (
                        <li key={asset.path} className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs text-zinc-700">{asset.path}</p>
                              <p className="mt-1 text-[11px] text-zinc-500">{Math.round(asset.bytes / 1024)} KiB</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => void copyTextSilent(asset.path)}
                                className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                              >
                                Copy path
                              </button>
                              <button
                                type="button"
                                onClick={() => void copyTextSilent(toRuntimeAssetPath(asset.path))}
                                className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                              >
                                Copy @pkg
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditAsset(asset.path)}
                                className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteAsset(asset.path)}
                                disabled={assetDeletingPath === asset.path}
                                className="text-xs font-medium text-red-700 underline underline-offset-4 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {assetDeletingPath === asset.path ? "删除中..." : "删除"}
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {createWorkflowOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-zinc-950/30"
            onClick={() => setCreateWorkflowOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold tracking-tight">新建工作流</h3>
              <button
                type="button"
                onClick={() => setCreateWorkflowOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-zinc-900" htmlFor="workflow-name">
                工作流名称
              </label>
              <input
                id="workflow-name"
                value={createWorkflowName}
                onChange={(e) => setCreateWorkflowName(e.target.value)}
                placeholder="例如：Main Workflow"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
              />
              {createWorkflowError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {createWorkflowError}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateWorkflowOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void createWorkflow()}
                disabled={createWorkflowSaving}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createWorkflowSaving ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assetModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-zinc-950/30" onClick={() => setAssetModalOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">
                  {assetEditingPath ? "编辑 Asset" : "新建 Asset"}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  MVP 仅支持文本类：.md/.txt/.json/.yaml/.yml（zip 路径以 <span className="font-mono">assets/</span>{" "}
                  开头；Runtime 访问为 <span className="font-mono">@pkg/assets/...</span>）。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                关闭
              </button>
            </div>

            {assetFormError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {assetFormError}
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="asset-path">
                  path <span className="text-red-600">*</span>
                </label>
                <input
                  id="asset-path"
                  value={assetPathDraft}
                  onChange={(e) => {
                    setAssetPathDraft(e.target.value);
                    if (assetFormError) setAssetFormError(null);
                  }}
                  disabled={Boolean(assetEditingPath)}
                  placeholder="assets/templates/story-template.md"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50"
                />
                {assetEditingPath ? (
                  <p className="text-xs text-zinc-500">MVP 不支持重命名 path（如需改名请新建后删除旧文件）。</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="asset-content">
                  content
                </label>
                <textarea
                  id="asset-content"
                  value={assetContentDraft}
                  onChange={(e) => {
                    setAssetContentDraft(e.target.value);
                    if (assetFormError) setAssetFormError(null);
                  }}
                  className="min-h-56 w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-zinc-400"
                  placeholder="# story template..."
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveAsset()}
                disabled={assetSaving || Boolean(apiEnvError)}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {assetSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {agentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-zinc-950/30" onClick={() => setAgentModalOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">
                  {agentEditingId ? "编辑 Agent" : "新建 Agent"}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Agent 会保存为 v1.1 `agents.json` manifest，并生成稳定 `agentId`（创建后不可修改）。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAgentModalOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                关闭
              </button>
            </div>

            {agentFormError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {agentFormError}
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-xs text-zinc-600">
                  <span className="font-mono text-zinc-900">agentId</span>:{" "}
                  <span className="font-mono text-zinc-700">{agentIdPreview()}</span>
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="agent-name">
                    metadata.name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="agent-name"
                    value={agentName}
                    onChange={(e) => {
                      setAgentName(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="例如：dev / planner"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="agent-title">
                    metadata.title <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="agent-title"
                    value={agentTitle}
                    onChange={(e) => {
                      setAgentTitle(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="例如：Developer Agent（默认=role 或 name）"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="agent-icon">
                    metadata.icon <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="agent-icon"
                    value={agentIcon}
                    onChange={(e) => {
                      setAgentIcon(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="例如：🧩"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="agent-role">
                    persona.role <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="agent-role"
                    value={agentRole}
                    onChange={(e) => {
                      setAgentRole(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="例如：planning / development"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="agent-identity">
                    persona.identity <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="agent-identity"
                    value={agentIdentity}
                    onChange={(e) => {
                      setAgentIdentity(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="用一段话描述该 Agent 的身份/职责"
                    className="min-h-24 w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="agent-style">
                    persona.communication_style <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="agent-style"
                    value={agentCommunicationStyle}
                    onChange={(e) => {
                      setAgentCommunicationStyle(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="例如：direct / concise"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="agent-principles">
                    persona.principles <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="agent-principles"
                    value={agentPrinciplesText}
                    onChange={(e) => {
                      setAgentPrinciplesText(e.target.value);
                      if (agentFormError) setAgentFormError(null);
                    }}
                    placeholder="每行一条，例如：\n- Always clarify requirements\n- Prefer simple solutions"
                    className="min-h-28 w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                  <p className="text-xs text-zinc-500">每行一条原则；保存时会写入为 string[]。</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAgentModalOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveAgent()}
                disabled={agentSaving}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {agentSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
