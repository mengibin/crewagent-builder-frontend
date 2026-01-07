"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { MarkdownEditorModal } from "@/components/MarkdownEditorModal";
import {
  buildAgentsManifestV11,
  formatAgentsManifestV11,
  type AgentV11,
  type AgentsManifestV11,
  type PromptV11,
  type ToolPolicyV11,
} from "@/lib/agents-manifest-v11";
import { mergeMenuItemFromDraft, splitMenuItemForDraft } from "@/lib/agent-menu-v11";
import { deleteJson, deleteJsonWithBody, getApiBaseUrl, getJson, postJson, putJson, type ApiError } from "@/lib/api-client";
import { normalizeAssetsPath, parseAssetsJson, toRuntimeAssetPath } from "@/lib/assets-v11";
import { buildBmadManifestV11, formatBmadManifestV11 } from "@/lib/bmad-manifest-v11";
import { buildBmadExportFilesV11, buildZipBytesFromFiles } from "@/lib/bmad-zip-v11";
import { validateExportBundleV11, type ExportValidationIssue } from "@/lib/export/validate-export-bundle-v11";
import { normalizeMarkdownListToStringArray, previewMarkdown, stringArrayToMarkdownList } from "@/lib/markdown";
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

const DEFAULT_AGENT_TOOLS: Required<ToolPolicyV11> = {
  fs: { enabled: true },
  mcp: { enabled: false, allowedServers: [] },
};

type AgentPromptDraft = {
  key: string;
  id: string;
  content: string;
  description: string;
};

type AgentMenuDraft = {
  key: string;
  trigger: string;
  description: string;
  exec: string;
  extra: Record<string, unknown>;
};

type AgentDraft = {
  metadata: {
    name: string;
    title: string;
    icon: string;
    module: string;
    description: string;
    sourceId: string;
  };
  persona: {
    role: string;
    identity: string;
    communication_style: string;
    principles: string[];
  };
  critical_actions: string[];
  prompts: AgentPromptDraft[];
  menu: AgentMenuDraft[];
  tools: Required<ToolPolicyV11>;
  systemPrompt: string;
  userPromptTemplate: string;
  discussion: boolean;
  webskip: boolean;
  conversational_knowledge: unknown[];
};

type AgentMarkdownModalState =
  | { type: "metadata.description" }
  | { type: "persona.identity" }
  | { type: "persona.communication_style" }
  | { type: "persona.principles" }
  | { type: "critical_actions" }
  | { type: "tools.mcp.allowedServers" }
  | { type: "prompt.content"; key: string }
  | { type: "prompt.description"; key: string }
  | { type: "menu.description"; key: string }
  | { type: "systemPrompt" }
  | { type: "userPromptTemplate" };

type AgentEditorSectionKey = "metadata" | "persona" | "critical" | "prompts" | "menu" | "tools" | "advanced";

function newDraftKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneToolPolicy(raw: ToolPolicyV11 | undefined): Required<ToolPolicyV11> {
  const fsRaw = raw?.fs;
  const mcpRaw = raw?.mcp;

  const fsEnabled = typeof fsRaw?.enabled === "boolean" ? fsRaw.enabled : DEFAULT_AGENT_TOOLS.fs.enabled;
  const maxReadBytes = typeof fsRaw?.maxReadBytes === "number" && fsRaw.maxReadBytes >= 1 ? fsRaw.maxReadBytes : undefined;
  const maxWriteBytes = typeof fsRaw?.maxWriteBytes === "number" && fsRaw.maxWriteBytes >= 1 ? fsRaw.maxWriteBytes : undefined;

  const mcpEnabled = typeof mcpRaw?.enabled === "boolean" ? mcpRaw.enabled : DEFAULT_AGENT_TOOLS.mcp.enabled;
  const allowedServers = Array.isArray(mcpRaw?.allowedServers)
    ? mcpRaw.allowedServers.map((v) => v.trim()).filter(Boolean)
    : [];

  return {
    fs: {
      enabled: fsEnabled,
      ...(typeof maxReadBytes === "number" ? { maxReadBytes } : {}),
      ...(typeof maxWriteBytes === "number" ? { maxWriteBytes } : {}),
    },
    mcp: {
      enabled: mcpEnabled,
      allowedServers,
    },
  };
}

function createEmptyAgentDraft(): AgentDraft {
  return {
    metadata: { name: "", title: "", icon: "🧩", module: "", description: "", sourceId: "" },
    persona: { role: "", identity: "", communication_style: "direct", principles: ["TBD"] },
    critical_actions: [],
    prompts: [],
    menu: [],
    tools: cloneToolPolicy(undefined),
    systemPrompt: "",
    userPromptTemplate: "",
    discussion: false,
    webskip: false,
    conversational_knowledge: [],
  };
}

function createAgentDraftFromAgent(agent: AgentV11): AgentDraft {
  const principles = (() => {
    const raw = agent.persona?.principles;
    const list = Array.isArray(raw) ? raw : normalizeMarkdownListToStringArray(String(raw ?? ""));
    const cleaned = list.map((v) => v.trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["TBD"];
  })();

  const prompts: AgentPromptDraft[] = Array.isArray(agent.prompts)
    ? agent.prompts.map((p) => ({
      key: newDraftKey(),
      id: typeof p?.id === "string" ? p.id : "",
      content: typeof p?.content === "string" ? p.content : "",
      description: typeof p?.description === "string" ? p.description : "",
    }))
    : [];

  const menu: AgentMenuDraft[] = Array.isArray(agent.menu)
    ? agent.menu.map((item) => ({ key: newDraftKey(), ...splitMenuItemForDraft(item) }))
    : [];

  return {
    metadata: {
      name: agent.metadata?.name ?? "",
      title: agent.metadata?.title ?? "",
      icon: agent.metadata?.icon ?? "🧩",
      module: agent.metadata?.module ?? "",
      description: agent.metadata?.description ?? "",
      sourceId: agent.metadata?.sourceId ?? "",
    },
    persona: {
      role: agent.persona?.role ?? "",
      identity: agent.persona?.identity ?? "",
      communication_style: agent.persona?.communication_style ?? "direct",
      principles,
    },
    critical_actions: Array.isArray(agent.critical_actions) ? agent.critical_actions.map((v) => v.trim()).filter(Boolean) : [],
    prompts,
    menu,
    tools: cloneToolPolicy(agent.tools),
    systemPrompt: agent.systemPrompt ?? "",
    userPromptTemplate: agent.userPromptTemplate ?? "",
    discussion: Boolean(agent.discussion),
    webskip: Boolean(agent.webskip),
    conversational_knowledge: Array.isArray(agent.conversational_knowledge)
      ? agent.conversational_knowledge.filter((v) => v && typeof v === "object" && !Array.isArray(v))
      : [],
  };
}

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
            {expanded ? "Collapse" : `Expand (${items.length})`}
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
            Copy all
          </button>
          {issues.length > EXPORT_ISSUE_LIMIT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
	              className="text-xs font-medium underline underline-offset-4 hover:text-zinc-700"
	            >
	              {expanded ? "Collapse" : `Expand (${issues.length})`}
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

function MarkdownPreviewButton(props: {
  value: string;
  placeholder: string;
  maxLines?: number;
  minHeightClass?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const preview = previewMarkdown(props.value, props.maxLines ?? 10);
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${props.minHeightClass ?? "min-h-24"} w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left font-mono text-xs leading-6 text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {preview ? <span className="whitespace-pre-wrap">{preview}</span> : <span className="text-zinc-400">{props.placeholder}</span>}
    </button>
  );
}

function CollapsibleSection(props: {
  title: string;
  required?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between gap-4 bg-zinc-50 px-4 py-3 text-left hover:bg-zinc-100"
      >
        <span className="text-sm font-medium text-zinc-900">
          {props.title}
          {props.required ? <span className="ml-1 text-red-600">*</span> : null}
        </span>
        <span className="text-xs text-zinc-500">{props.expanded ? "Collapse" : "Expand"}</span>
      </button>
      {props.expanded ? <div className="border-t border-zinc-200 p-4">{props.children}</div> : null}
    </div>
  );
}

function parseAgentsJson(raw: string): { manifest: AgentsManifestV11; agents: AgentListItem[]; error: string | null } {
  const trimmed = raw?.trim();
  const empty: AgentsManifestV11 = { schemaVersion: "1.1", agents: [] };
  if (!trimmed) return { manifest: empty, agents: [], error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const existing = new Set<string>();

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const schemaVersion: AgentsManifestV11["schemaVersion"] = "1.1";
      const rawAgents = Array.isArray(obj.agents) ? obj.agents : [];
      const errors: string[] = [];

      const manifestAgents = rawAgents
        .map((item, index) => {
          if (!item || typeof item !== "object") {
            errors.push(`agents[${index}] is not a valid object`);
            return null;
          }
          const agent = item as Record<string, unknown>;
          const id = typeof agent.id === "string" ? agent.id : "";
          if (!id) {
            errors.push(`agents[${index}].id cannot be empty`);
            return null;
          }
          if (!isValidAgentId(id)) {
            errors.push(`agents[${index}].id is invalid: ${id}`);
            return null;
          }
          if (existing.has(id)) {
            errors.push(`Duplicate agentId: ${id}`);
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
        const summary = errors.slice(0, 3).join("; ");
        const suffix = errors.length > 3 ? `... (total ${errors.length})` : "";
        return {
          manifest,
          agents,
          error: `agentsJson has issues: ${summary}${suffix}. Please fix them before editing/saving.`,
        };
      }

      return { manifest, agents, error: null };
    }

    if (Array.isArray(parsed)) {
      const legacy = parsed as unknown[];

      // Detect if this is a v1.1 format array (agents have id + metadata)
      const isV11Array = legacy.some((item) => {
        if (!item || typeof item !== "object") return false;
        const obj = item as Record<string, unknown>;
        return typeof obj.id === "string" && obj.metadata && typeof obj.metadata === "object";
      });

      if (isV11Array) {
        // Treat as v1.1 manifest without schemaVersion wrapper
        const manifest: AgentsManifestV11 = { schemaVersion: "1.1", agents: [] };
        const agents: AgentListItem[] = [];

        legacy.forEach((item, index) => {
          if (!item || typeof item !== "object") return;
          const agent = item as Record<string, unknown>;
          const id = typeof agent.id === "string" ? agent.id : "";
          if (!id) return;
          if (existing.has(id)) return;
          existing.add(id);

          const metadata = (agent.metadata as Record<string, unknown> | undefined) ?? {};
          const persona = (agent.persona as Record<string, unknown> | undefined) ?? {};

          const rawName = typeof metadata.name === "string" ? metadata.name : "";
          const rawTitle = typeof metadata.title === "string" ? metadata.title : "";
          const rawIcon = typeof metadata.icon === "string" ? metadata.icon : "🧩";
          const name = rawName || rawTitle || id || `agent-${index + 1}`;
          const title = rawTitle || rawName || name;

          const role = typeof persona.role === "string" ? persona.role : "Agent";
          const identity = typeof persona.identity === "string" ? persona.identity : role || "TBD";
          const communication_style = typeof persona.communication_style === "string" ? persona.communication_style : "direct";
          const principlesRaw = persona.principles;
          const principles = Array.isArray(principlesRaw)
            ? principlesRaw.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            : typeof principlesRaw === "string"
              ? principlesRaw.split("\n").map((p) => p.trim()).filter((p) => p.length > 0)
              : ["TBD"];

          manifest.agents.push({
            id,
            metadata: { name, title, icon: rawIcon },
            persona: { role, identity, communication_style, principles: principles.length ? principles : ["TBD"] },
            tools: { fs: { enabled: true }, mcp: { enabled: false, allowedServers: [] } },
            ...(Array.isArray(agent.critical_actions) ? { critical_actions: agent.critical_actions.filter((v): v is string => typeof v === "string") } : {}),
            ...(Array.isArray(agent.prompts) ? { prompts: agent.prompts as Array<{ id: string; content: string; description?: string }> } : {}),
            ...(typeof agent.systemPrompt === "string" ? { systemPrompt: agent.systemPrompt } : {}),
          });

          agents.push({ id, name, title, icon: rawIcon, role, identity, communication_style, principles });
        });

        return { manifest, agents, error: null };
      }

      // Legacy flat format: agents have name/role at top level
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

    return { manifest: empty, agents: [], error: "Invalid agentsJson format (expected a v1.1 manifest or an array)." };
  } catch {
    return { manifest: empty, agents: [], error: "Failed to parse agentsJson (invalid JSON)." };
  }
}

function formatLoadError(error: ApiError): { title: string; message: string } {
  switch (error.code) {
    case "PACKAGE_NOT_FOUND":
      return { title: "Project not found", message: "This project doesn't exist, was deleted, or you don't have access." };
    case "VALIDATION_ERROR":
      return { title: "Invalid project ID", message: "The projectId in the URL is invalid. Go back to Dashboard and open it again." };
    case "NETWORK_ERROR":
      return { title: "Network error", message: "Unable to reach the backend service. Please try again later." };
    default:
      return { title: "Failed to load", message: error.message || "Failed to load. Please try again later." };
  }
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
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentMarkdownModal, setAgentMarkdownModal] = useState<AgentMarkdownModalState | null>(null);
  const [agentEditorExpanded, setAgentEditorExpanded] = useState<Record<string, boolean>>({
    metadata: true,
    persona: true,
    critical: false,
    prompts: false,
    menu: false,
    tools: false,
    advanced: false,
  });
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
          setLoadError({ code: "BAD_RESPONSE", message: "Unexpected server response." });
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
          setWorkflowsError({ code: "BAD_RESPONSE", message: "Unexpected server response." });
          setWorkflows([]);
        } else {
          setWorkflows(workflowsRes.data);
          setWorkflowsError(null);
        }

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

        setLoadedProjectId(projectId);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError({ code: "NETWORK_ERROR", message: "Network error. Please try again later." });
        setWorkflowsError({ code: "NETWORK_ERROR", message: "Network error. Please try again later." });
        setData(null);
        setArtifactDirs([]);
        setArtifactsError(null);
        setWorkflows([]);
        setAssetsError("Network error. Please try again later.");
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
    setAgentDraft(createEmptyAgentDraft());
    setAgentMarkdownModal(null);
    setAgentEditorExpanded({
      metadata: true,
      persona: true,
      critical: false,
      prompts: false,
      menu: false,
      tools: false,
      advanced: false,
    });
    setAgentFormError(null);
  }

  function closeAgentModal(): void {
    if (agentSaving) return;
    setAgentModalOpen(false);
    resetAgentForm();
  }

  function openCreateAgent(): void {
    if (agentsError) {
      setAgentFormError(`${agentsError} (Fix agentsJson before creating/editing.)`);
      return;
    }
    resetAgentForm();
    setAgentModalOpen(true);
  }

  function openEditAgent(agentId: string): void {
    if (agentsError) return;
    const agent = agentsManifest.agents.find((a) => a.id === agentId);
    if (!agent) return;
    setAgentEditingId(agentId);
    setAgentDraft(createAgentDraftFromAgent(agent));
    setAgentFormError(null);
    setAgentEditorExpanded({
      metadata: true,
      persona: true,
      critical: false,
      prompts: false,
      menu: false,
      tools: false,
      advanced: false,
    });
    setAgentModalOpen(true);
  }

  async function deleteAgent(agentId: string): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (agentDeletingId) return;
    if (agentsError) return;

    setAgentsActionError(null);

    if (agentsManifest.agents.length <= 1) {
      setAgentsActionError("You must keep at least 1 agent.");
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
        .map((r) => `${r.workflowName} (ID:${r.workflowId}) referenced ${r.count} time(s)`)
        .join("; ");
      setAgentsActionError(
        `This agent is referenced by workflow nodes: ${summary}. Remove the bindings in the Editor before deleting.`,
      );
      setAgentDeletingId(null);
      return;
    }

    const target = agentsManifest.agents.find((a) => a.id === agentId);
    const title = target?.metadata?.title || target?.metadata?.name || agentId;
    if (!window.confirm(`Delete Agent "${title}" (id: ${agentId})?`)) {
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
      setAgentsActionError(res.error?.message ?? "Delete failed. Please try again.");
      return;
    }

    setData(res.data);
    setAgentsActionError(null);
  }

  function agentIdPreview(): string {
    if (agentEditingId) return agentEditingId;
    const base = agentDraft?.metadata.name.trim() ?? "";
    const ids = new Set(agentsManifest.agents.map((a) => a.id));
    return uniqueAgentId(base || "agent", ids);
  }

  const updateAgentDraft = (updater: (draft: AgentDraft) => AgentDraft) => {
    setAgentDraft((prev) => (prev ? updater(prev) : prev));
    if (agentFormError) setAgentFormError(null);
  };

  const moveArrayItem = <T,>(items: T[], from: number, to: number): T[] => {
    if (from === to) return items;
    if (from < 0 || to < 0) return items;
    if (from >= items.length || to >= items.length) return items;
    const copy = [...items];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  };

  const toggleAgentSection = (section: AgentEditorSectionKey) =>
    setAgentEditorExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  function renderAgentMarkdownModal(): ReactNode {
    if (!agentModalOpen) return null;
    if (!agentDraft) return null;
    if (!agentMarkdownModal) return null;

    const close = () => setAgentMarkdownModal(null);

    if (agentMarkdownModal.type === "metadata.description") {
      return (
        <MarkdownEditorModal
          title="Edit: metadata.description"
          value={agentDraft.metadata.description}
          placeholder="Optional short description..."
          onChange={(next) =>
            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, description: next } }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "persona.identity") {
      return (
        <MarkdownEditorModal
          title="Edit: persona.identity"
          value={agentDraft.persona.identity}
          placeholder="Identity / responsibility in one paragraph..."
          onChange={(next) => updateAgentDraft((draft) => ({ ...draft, persona: { ...draft.persona, identity: next } }))}
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "persona.communication_style") {
      return (
        <MarkdownEditorModal
          title="Edit: persona.communication_style"
          value={agentDraft.persona.communication_style}
          placeholder="How the agent communicates..."
          onChange={(next) =>
            updateAgentDraft((draft) => ({ ...draft, persona: { ...draft.persona, communication_style: next } }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "persona.principles") {
      return (
        <MarkdownEditorModal
          title="Edit: persona.principles"
          value={stringArrayToMarkdownList(agentDraft.persona.principles)}
          placeholder="- Always clarify requirements\n- Prefer simple solutions"
          onChange={(next) =>
            updateAgentDraft((draft) => ({
              ...draft,
              persona: { ...draft.persona, principles: normalizeMarkdownListToStringArray(next) },
            }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "critical_actions") {
      return (
        <MarkdownEditorModal
          title="Edit: critical_actions"
          value={stringArrayToMarkdownList(agentDraft.critical_actions)}
          placeholder="- Verify constraints\n- Ask clarifying questions"
          onChange={(next) => updateAgentDraft((draft) => ({ ...draft, critical_actions: normalizeMarkdownListToStringArray(next) }))}
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "tools.mcp.allowedServers") {
      return (
        <MarkdownEditorModal
          title="Edit: tools.mcp.allowedServers"
          value={stringArrayToMarkdownList(agentDraft.tools.mcp.allowedServers ?? [])}
          placeholder="- github\n- filesystem\n- slack"
          onChange={(next) =>
            updateAgentDraft((draft) => ({
              ...draft,
              tools: { ...draft.tools, mcp: { ...draft.tools.mcp, allowedServers: normalizeMarkdownListToStringArray(next) } },
            }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "systemPrompt") {
      return (
        <MarkdownEditorModal
          title="Edit: systemPrompt"
          value={agentDraft.systemPrompt}
          placeholder="Optional compiled system prompt..."
          onChange={(next) => updateAgentDraft((draft) => ({ ...draft, systemPrompt: next }))}
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "userPromptTemplate") {
      return (
        <MarkdownEditorModal
          title="Edit: userPromptTemplate"
          value={agentDraft.userPromptTemplate}
          placeholder="Optional user prompt template..."
          onChange={(next) => updateAgentDraft((draft) => ({ ...draft, userPromptTemplate: next }))}
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "prompt.content") {
      const idx = agentDraft.prompts.findIndex((p) => p.key === agentMarkdownModal.key);
      if (idx === -1) return null;
      return (
        <MarkdownEditorModal
          title={`Edit: prompts[${idx}].content`}
          value={agentDraft.prompts[idx].content}
          placeholder="Reusable prompt snippet..."
          onChange={(next) =>
            updateAgentDraft((draft) => ({
              ...draft,
              prompts: draft.prompts.map((p, i) => (i === idx ? { ...p, content: next } : p)),
            }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "prompt.description") {
      const idx = agentDraft.prompts.findIndex((p) => p.key === agentMarkdownModal.key);
      if (idx === -1) return null;
      return (
        <MarkdownEditorModal
          title={`Edit: prompts[${idx}].description`}
          value={agentDraft.prompts[idx].description}
          placeholder="Optional description..."
          onChange={(next) =>
            updateAgentDraft((draft) => ({
              ...draft,
              prompts: draft.prompts.map((p, i) => (i === idx ? { ...p, description: next } : p)),
            }))
          }
          onClose={close}
        />
      );
    }

    if (agentMarkdownModal.type === "menu.description") {
      const idx = agentDraft.menu.findIndex((m) => m.key === agentMarkdownModal.key);
      if (idx === -1) return null;
      return (
        <MarkdownEditorModal
          title={`Edit: menu[${idx}].description`}
          value={agentDraft.menu[idx].description}
          placeholder="Optional: show entrypoints or shortcuts..."
          onChange={(next) =>
            updateAgentDraft((draft) => ({
              ...draft,
              menu: draft.menu.map((m, i) => (i === idx ? { ...m, description: next } : m)),
            }))
          }
          onClose={close}
        />
      );
    }

    return null;
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
      window.alert("You must keep at least 1 workflow.");
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
        .map((r) => `${r.workflowName} (ID:${r.workflowId}) referenced ${r.count} time(s)`)
        .join("; ");
      window.alert(`This workflow is referenced by subworkflow nodes: ${summary}. Remove the references before deleting.`);
      setWorkflowDeletingId(null);
      return;
    }

    const label = workflow.isDefault ? `${workflow.name} (default)` : workflow.name;
    if (!window.confirm(`Delete workflow "${label}" (ID: ${workflow.id})?`)) {
      setWorkflowDeletingId(null);
      return;
    }
    const res = await deleteJson<{ id: number }>(`/packages/${projectId}/workflows/${workflow.id}`, { auth: true });
    setWorkflowDeletingId(null);

    if (res.error) {
      window.alert(res.error.message ?? "Delete failed. Please try again.");
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
      setCreateWorkflowError("Workflow name is required.");
      return;
    }
    if (name.length > 200) {
      setCreateWorkflowError("Workflow name is too long (max 200 characters).");
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
      setCreateWorkflowError(res.error?.message ?? "Create failed. Please try again.");
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
      setArtifactsError(res.error?.message ?? "Failed to save artifacts. Please try again later.");
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
      setArtifactsError(normalized.error ?? "Invalid directory.");
      return;
    }
    if (artifactDirs.includes(normalized.value)) {
      setArtifactsError("Directory already exists.");
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
      setAssetFormError(normalized.error ?? "Invalid path.");
      return;
    }

    const path = assetEditingPath ?? normalized.value;
    if (!assetEditingPath && assetsMap[path]) {
      setAssetFormError("Path already exists. Rename it or use Edit.");
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
      setAssetFormError(res.error?.message ?? "Save failed. Please try again.");
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

    if (!window.confirm(`Delete asset "${path}"?`)) return;

    setAssetDeletingPath(path);
    const res = await deleteJsonWithBody<PackageAssetsOut>(`/packages/${projectId}/assets`, { path }, { auth: true });
    setAssetDeletingPath(null);

    if (res.error || !res.data) {
      window.alert(res.error?.message ?? "Delete failed. Please try again.");
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
      setAgentFormError(`${agentsError} (Fix agentsJson before saving.)`);
      return;
    }

    if (!agentDraft) {
      setAgentFormError("Agent editor is not ready. Close and reopen the modal.");
      return;
    }

	    const name = agentDraft.metadata.name.trim();
	    const role = agentDraft.persona.role.trim();
	    const title = agentDraft.metadata.title.trim() || role || name;
	    const icon = agentDraft.metadata.icon.trim() || "🧩";
	    const moduleName = agentDraft.metadata.module.trim();
	    const sourceId = agentDraft.metadata.sourceId.trim();
	    const description = agentDraft.metadata.description.trimEnd();

    const identity = agentDraft.persona.identity.trimEnd() || role || "TBD";
    const communication_style = agentDraft.persona.communication_style.trimEnd() || "direct";
    const principles = Array.from(
      new Set(agentDraft.persona.principles.map((p) => p.trim()).filter(Boolean)),
    );

    const critical_actions = Array.from(
      new Set(agentDraft.critical_actions.map((v) => v.trim()).filter(Boolean)),
    );

    const promptsDraft = agentDraft.prompts
      .map((p) => ({
        id: p.id.trim(),
        content: p.content.trimEnd(),
        description: p.description.trimEnd(),
      }))
      .filter((p) => p.id || p.content || p.description);

    const prompts: PromptV11[] = promptsDraft.map((p) => ({
      id: p.id,
      content: p.content,
      ...(p.description ? { description: p.description } : {}),
    }));

    const menuDraft = agentDraft.menu
      .map((item) => ({
        trigger: item.trigger.trim(),
        description: item.description.trimEnd(),
        exec: item.exec.trim(),
        extra: item.extra,
      }))
      .filter((item) => item.trigger || item.exec || item.description || Object.keys(item.extra ?? {}).length > 0);

    const menu = menuDraft.map(mergeMenuItemFromDraft);

    const tools: Required<ToolPolicyV11> = {
      fs: {
        enabled: typeof agentDraft.tools.fs.enabled === "boolean" ? agentDraft.tools.fs.enabled : true,
        ...(typeof agentDraft.tools.fs.maxReadBytes === "number" ? { maxReadBytes: agentDraft.tools.fs.maxReadBytes } : {}),
        ...(typeof agentDraft.tools.fs.maxWriteBytes === "number" ? { maxWriteBytes: agentDraft.tools.fs.maxWriteBytes } : {}),
      },
      mcp: {
        enabled: typeof agentDraft.tools.mcp.enabled === "boolean" ? agentDraft.tools.mcp.enabled : false,
        allowedServers: Array.from(
          new Set((agentDraft.tools.mcp.allowedServers ?? []).map((v) => v.trim()).filter(Boolean)),
        ),
      },
    };

    if (!name) {
      setAgentFormError("metadata.name is required.");
      return;
    }
    if (!role) {
      setAgentFormError("persona.role is required.");
      return;
    }
    if (!title) {
      setAgentFormError("metadata.title is required.");
      return;
    }
    if (!icon) {
      setAgentFormError("metadata.icon is required.");
      return;
    }
    if (!identity) {
      setAgentFormError("persona.identity is required.");
      return;
    }
    if (!communication_style) {
      setAgentFormError("persona.communication_style is required.");
      return;
    }
    if (!principles.length) {
      setAgentFormError("persona.principles must have at least 1 item.");
      return;
    }

    if (name.length > 100) {
      setAgentFormError("metadata.name is too long (max 100 characters).");
      return;
    }
    if (title.length > 100) {
      setAgentFormError("metadata.title is too long (max 100 characters).");
      return;
    }
    if (icon.length > 20) {
      setAgentFormError("metadata.icon is too long (max 20 characters).");
      return;
    }
    if (role.length > 200) {
      setAgentFormError("persona.role is too long (max 200 characters).");
      return;
    }
    if (communication_style.length > 200) {
      setAgentFormError("persona.communication_style is too long (max 200 characters).");
      return;
    }
    if (identity.length > 5000) {
      setAgentFormError("persona.identity is too long (max 5000 characters).");
      return;
    }

    const nameConflict = agentsManifest.agents.some(
      (a) => a.id !== agentEditingId && a.metadata?.name?.trim().toLowerCase() === name.toLowerCase(),
    );
    if (nameConflict) {
      setAgentFormError("metadata.name already exists. Please use a different name.");
      return;
    }

    const promptIds = new Set<string>();
    for (const [idx, p] of prompts.entries()) {
      if (!p.id) {
        setAgentFormError(`prompts[${idx}].id is required.`);
        return;
      }
      if (!p.content) {
        setAgentFormError(`prompts[${idx}].content is required.`);
        return;
      }
      if (promptIds.has(p.id)) {
        setAgentFormError(`Duplicate prompts[].id: ${p.id}`);
        return;
      }
      promptIds.add(p.id);
    }

    for (const [idx, item] of menuDraft.entries()) {
      if (!item.description.trim()) {
        setAgentFormError(`menu[${idx}].description is required.`);
        return;
      }
    }

    if (typeof tools.fs.maxReadBytes === "number" && tools.fs.maxReadBytes < 1) {
      setAgentFormError("tools.fs.maxReadBytes must be >= 1.");
      return;
    }
    if (typeof tools.fs.maxWriteBytes === "number" && tools.fs.maxWriteBytes < 1) {
      setAgentFormError("tools.fs.maxWriteBytes must be >= 1.");
      return;
    }

    const nextManifest: AgentsManifestV11 = {
      schemaVersion: "1.1",
      agents: [...agentsManifest.agents],
    };

    const nextAgentBase: Omit<AgentV11, "id"> = {
	      metadata: {
	        name,
	        title,
	        icon,
	        ...(moduleName ? { module: moduleName } : {}),
	        ...(description ? { description } : {}),
	        ...(sourceId ? { sourceId } : {}),
	      },
      persona: {
        role,
        identity,
        communication_style,
        principles,
      },
      tools,
      ...(critical_actions.length ? { critical_actions } : {}),
      ...(prompts.length ? { prompts } : {}),
      ...(menu.length ? { menu } : {}),
      ...(agentDraft.systemPrompt.trim() ? { systemPrompt: agentDraft.systemPrompt.trimEnd() } : {}),
      ...(agentDraft.userPromptTemplate.trim() ? { userPromptTemplate: agentDraft.userPromptTemplate.trimEnd() } : {}),
      ...(agentDraft.discussion ? { discussion: true } : {}),
      ...(agentDraft.webskip ? { webskip: true } : {}),
      ...(Array.isArray(agentDraft.conversational_knowledge) && agentDraft.conversational_knowledge.length
        ? { conversational_knowledge: agentDraft.conversational_knowledge }
        : {}),
    };

    if (agentEditingId) {
      const idx = nextManifest.agents.findIndex((a) => a.id === agentEditingId);
      if (idx === -1) {
        setAgentFormError("Agent not found or was deleted. Refresh and try again.");
        return;
      }
      nextManifest.agents[idx] = { id: agentEditingId, ...nextAgentBase };
    } else {
      const ids = new Set(nextManifest.agents.map((a) => a.id));
      const id = uniqueAgentId(name, ids);
      if (!isValidAgentId(id)) {
        setAgentFormError("Generated agentId is invalid. Update metadata.name and try again.");
        return;
      }
      nextManifest.agents.push({ id, ...nextAgentBase });
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
      setAgentFormError(
        details
          ? `${res.error?.message ?? "Save failed"} (${details})`
          : res.error?.message ?? "Save failed. Please try again.",
      );
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
      setExportErrors(bmadBuild.errors.length ? bmadBuild.errors : ["Failed to generate bmad.json."]);
      return;
    }
    if (!agentsExportBuild.manifest) {
      setExportErrors(agentsExportBuild.errors.length ? agentsExportBuild.errors : ["Failed to generate agents.json."]);
      return;
    }
    if (assetsError) {
      setExportErrors([`Failed to load assets: ${assetsError}`]);
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
            return { ok: false as const, workflow: wf, message: res.error?.message ?? "Failed to load." };
          }
          return { ok: true as const, data: res.data };
        }),
      );

      const failures = detailResults.filter((r): r is { ok: false; workflow: WorkflowListItem; message: string } => !r.ok);
      if (failures.length) {
        const first = failures[0];
        setExportErrors([`Failed to load workflow: ${first.workflow.name} (ID:${first.workflow.id}) - ${first.message}`]);
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
        setExportErrors(exportFiles.errors.length ? exportFiles.errors : ["Export failed. Please try again."]);
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
      setExportErrors(["Export failed. Please try again."]);
    } finally {
      setExporting(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="w-full max-w-none px-6 py-16">
          <p className="text-sm text-zinc-600">Redirecting...</p>
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
                "Loading..."
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
              {exporting ? "Exporting..." : "Export Package (v1.1)"}
            </button>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
              Back to Dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
              Sign out
            </button>
          </div>
        </header>

        {exportErrors.length ? (
          <div className="mt-6">
            <IssuesAlert variant="error" title="Export blocked" items={exportErrors} />
          </div>
        ) : null}

        {exportValidationIssues.some((issue) => issue.severity === "error") ? (
          <div className="mt-4">
            <ValidationIssuesAlert
              variant="error"
              title="Schema/frontmatter validation failed"
              issues={exportValidationIssues}
            />
          </div>
        ) : null}

        {exportWarnings.length ? (
          <div className="mt-4">
            <IssuesAlert variant="warning" title="Export warnings" items={exportWarnings} />
          </div>
        ) : null}

        {apiEnvError ? (
          <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {apiEnvError}
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-12 gap-6">
          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Workflows</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openCreateWorkflow}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError)}
                  className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  New workflow
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : activeWorkflows.length}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Loading...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Failed to load workflows.</p>
              </div>
            ) : activeWorkflowsError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Failed to load workflows.</p>
              </div>
            ) : activeWorkflows.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">No workflows yet. Create one first.</p>
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
                              Default
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
                          {workflowDeletingId === wf.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="col-span-12 rounded-2xl border border-zinc-200 bg-white p-4 md:col-span-6">
            <h2 className="text-sm font-semibold text-zinc-900">Overview</h2>
            <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
              {isLoading ? (
                <p className="text-sm text-zinc-600">Loading...</p>
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
                      Retry
                    </button>
                    <Link
                      href="/dashboard"
                      className="text-xs font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                    >
                      Back to Dashboard
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    This is the ProjectBuilder shell: view the project&apos;s workflows and agents, and jump into the workflow editor.
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Multi-workflow create/switch (Story 3.9) and Agents v1.1 field editing (Story 3.10) are done; the
                    Workflow Editor fullscreen / more node types / branch config / variables / artifacts (Story 3.11) is being finalized.
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
                          {bmadBuild.errors.join("; ")}
                        </div>
                      ) : null}

                      {bmadBuild.warnings.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        >
                          {bmadBuild.warnings.join("; ")}
                        </div>
                      ) : null}

                      {!isLoading && !activeError && !activeWorkflowsError && bmadJsonPreview ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500">Used for Story 3.16 full-package export (ZIP root: bmad.json).</p>
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
                          {isLoading ? "Loading..." : "Nothing to preview yet (make sure you've created at least 1 workflow)."}
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
                          {agentsExportBuild.errors.join("; ")}
                        </div>
                      ) : null}

                      {agentsExportBuild.warnings.length ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        >
                          {agentsExportBuild.warnings.join("; ")}
                        </div>
                      ) : null}

                      {!isLoading && !activeError && agentsJsonPreview ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500">
                              Used for Story 3.16 full-package export (ZIP root: agents.json).
                            </p>
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
                          {isLoading ? "Loading..." : "Nothing to preview yet (make sure you've created at least 1 agent)."}
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
                  New agent
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : agents.length}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Loading...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Failed to load agents.</p>
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
                    <p className="text-sm text-zinc-600">No agents yet.</p>
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
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteAgent(a.id)}
                              disabled={Boolean(agentsError) || agentDeletingId === a.id}
                              className="text-xs font-medium text-red-700 underline underline-offset-4 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {agentDeletingId === a.id ? "Deleting..." : "Delete"}
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
              Manage project-level <span className="font-mono">artifacts/</span> directories for workflow node{" "}
              <span className="font-mono">outputs</span> selection and validation (runtime:{" "}
              <span className="font-mono">@project/artifacts/...</span>).
            </p>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Loading...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Failed to load artifacts.</p>
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
                    New directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="artifact-dir"
                      value={artifactDraft}
                      onChange={(e) => setArtifactDraft(e.target.value)}
                      placeholder="create-story or artifacts/create-story"
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                    />
                    <button
                      type="button"
                      onClick={() => void addArtifactDir()}
                      disabled={artifactsSaving || !artifactDraft.trim() || Boolean(apiEnvError)}
                      className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {artifactsSaving ? "Saving..." : "Add"}
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
                            const next = window.prompt("Rename directory", dir);
                            if (next === null) return;
                            const normalized = normalizeArtifactsDir(next);
                            if (normalized.error || !normalized.value) {
                              setArtifactsError(normalized.error ?? "Invalid directory.");
                              return;
                            }
                            if (artifactDirs.includes(normalized.value) && normalized.value !== dir) {
                              setArtifactsError("Directory already exists.");
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
                    <p className="text-sm text-zinc-600">No directories yet. Try adding artifacts/create-story.</p>
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
                  New asset
                </button>
                <span className="text-xs text-zinc-500">{isLoading ? "…" : assetsList.length}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Manage package-level <span className="font-mono">assets/</span>; exported with <code>.bmad</code> and
              accessed read-only at runtime via <span className="font-mono">@pkg/assets/...</span>.
            </p>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Loading...</p>
              </div>
            ) : activeError ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-600">Failed to load assets.</p>
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
                    <p className="text-sm text-zinc-600">No assets yet.</p>
                  </div>
                ) : (
                  <>
                    <p className="mt-3 text-[11px] text-zinc-500">
                      Total size: {Math.round(assetsParsed.totalBytes / 1024)} KiB
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
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteAsset(asset.path)}
                                disabled={assetDeletingPath === asset.path}
                                className="text-xs font-medium text-red-700 underline underline-offset-4 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {assetDeletingPath === asset.path ? "Deleting..." : "Delete"}
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
              <h3 className="text-lg font-semibold tracking-tight">New workflow</h3>
              <button
                type="button"
                onClick={() => setCreateWorkflowOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-zinc-900" htmlFor="workflow-name">
                Workflow name
              </label>
              <input
                id="workflow-name"
                value={createWorkflowName}
                onChange={(e) => setCreateWorkflowName(e.target.value)}
                placeholder="e.g. Main Workflow"
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createWorkflow()}
                disabled={createWorkflowSaving}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createWorkflowSaving ? "Creating..." : "Create"}
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
                  {assetEditingPath ? "Edit asset" : "New asset"}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  MVP supports text files only: .md/.txt/.json/.yaml/.yml (zip path starts with{" "}
                  <span className="font-mono">assets/</span>; runtime access is{" "}
                  <span className="font-mono">@pkg/assets/...</span>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Close
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
                  <p className="text-xs text-zinc-500">
                    MVP doesn&apos;t support renaming path (create a new asset and delete the old one).
                  </p>
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveAsset()}
                disabled={assetSaving || Boolean(apiEnvError)}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {assetSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renderAgentMarkdownModal()}

      {agentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-zinc-950/30" onClick={closeAgentModal} />
          <div className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-5">
              <div className="min-w-0 space-y-1">
                <h3 className="text-lg font-semibold tracking-tight">{agentEditingId ? "Edit agent" : "New agent"}</h3>
                <p className="text-xs text-zinc-500">
                  Agents are saved as a v1.1 <span className="font-mono">agents.json</span> manifest and get a stable{" "}
                  <span className="font-mono">agentId</span> (cannot be changed after creation).
                </p>
                <p className="text-xs text-zinc-600">
                  <span className="font-mono text-zinc-900">agentId</span>:{" "}
                  <span className="font-mono text-zinc-700">{agentIdPreview()}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeAgentModal}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={agentSaving}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              {agentFormError ? (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {agentFormError}
                </div>
              ) : null}

              {!agentDraft ? (
                <p className="text-sm text-zinc-600">Loading agent editor…</p>
              ) : (
                <div className="space-y-4">
                  <CollapsibleSection
                    title="Metadata"
                    required
                    expanded={agentEditorExpanded.metadata}
                    onToggle={() => toggleAgentSection("metadata")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="agent-name">
                          metadata.name <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="agent-name"
                          value={agentDraft.metadata.name}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, name: e.target.value } }))
                          }
                          placeholder="e.g. Finance Assistant"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="agent-title">
                          metadata.title <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="agent-title"
                          value={agentDraft.metadata.title}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, title: e.target.value } }))
                          }
                          placeholder="e.g. Finance Assistant"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="agent-icon">
                          metadata.icon <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="agent-icon"
                          value={agentDraft.metadata.icon}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, icon: e.target.value } }))
                          }
                          placeholder="e.g. 🧩"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="agent-module">
                          metadata.module <span className="text-zinc-400">(optional)</span>
                        </label>
                        <input
                          id="agent-module"
                          value={agentDraft.metadata.module}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, module: e.target.value } }))
                          }
                          placeholder="e.g. finance"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium" htmlFor="agent-sourceId">
                          metadata.sourceId <span className="text-zinc-400">(optional)</span>
                        </label>
                        <input
                          id="agent-sourceId"
                          value={agentDraft.metadata.sourceId}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, sourceId: e.target.value } }))
                          }
                          placeholder="e.g. _bmad/<module>/agents/<agent>.md"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <label className="text-sm font-medium">metadata.description <span className="text-zinc-400">(optional)</span></label>
                          <button
                            type="button"
                            onClick={() => updateAgentDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, description: "" } }))}
                            className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={agentSaving || !agentDraft.metadata.description.trim()}
                          >
                            Clear
                          </button>
                        </div>
                        <MarkdownPreviewButton
                          value={agentDraft.metadata.description}
                          placeholder="Click to open Markdown editor…"
                          maxLines={6}
                          minHeightClass="min-h-20"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "metadata.description" })}
                        />
                      </div>
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Persona"
                    required
                    expanded={agentEditorExpanded.persona}
                    onToggle={() => toggleAgentSection("persona")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="agent-role">
                          persona.role <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="agent-role"
                          value={agentDraft.persona.role}
                          onChange={(e) =>
                            updateAgentDraft((draft) => ({ ...draft, persona: { ...draft.persona, role: e.target.value } }))
                          }
                          placeholder="e.g. Interviewer"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                          disabled={agentSaving}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <label className="text-sm font-medium">
                            persona.communication_style <span className="text-red-600">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateAgentDraft((draft) => ({ ...draft, persona: { ...draft.persona, communication_style: "direct" } }))
                            }
                            className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={agentSaving}
                          >
                            Reset
                          </button>
                        </div>
                        <MarkdownPreviewButton
                          value={agentDraft.persona.communication_style}
                          placeholder="Click to open Markdown editor…"
                          maxLines={4}
                          minHeightClass="min-h-16"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "persona.communication_style" })}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium">
                          persona.identity <span className="text-red-600">*</span>
                        </label>
                        <MarkdownPreviewButton
                          value={agentDraft.persona.identity}
                          placeholder="Click to open Markdown editor…"
                          maxLines={10}
                          minHeightClass="min-h-28"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "persona.identity" })}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium">
                          persona.principles <span className="text-red-600">*</span>
                        </label>
                        <MarkdownPreviewButton
                          value={stringArrayToMarkdownList(agentDraft.persona.principles)}
                          placeholder="Click to open Markdown editor…"
                          maxLines={10}
                          minHeightClass="min-h-28"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "persona.principles" })}
                        />
                        <p className="text-xs text-zinc-500">Edit as Markdown bullets or one item per line; saved as string[].</p>
                      </div>
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Critical actions"
                    expanded={agentEditorExpanded.critical}
                    onToggle={() => toggleAgentSection("critical")}
                  >
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs text-zinc-600">Optional must-do items (string[]).</p>
                        <button
                          type="button"
                          onClick={() => updateAgentDraft((draft) => ({ ...draft, critical_actions: [] }))}
                          className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={agentSaving || agentDraft.critical_actions.length === 0}
                        >
                          Clear
                        </button>
                      </div>
                      <MarkdownPreviewButton
                        value={stringArrayToMarkdownList(agentDraft.critical_actions)}
                        placeholder="Click to open Markdown editor…"
                        maxLines={10}
                        minHeightClass="min-h-24"
                        disabled={agentSaving}
                        onClick={() => setAgentMarkdownModal({ type: "critical_actions" })}
                      />
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Prompts"
                    expanded={agentEditorExpanded.prompts}
                    onToggle={() => toggleAgentSection("prompts")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="text-xs text-zinc-600">Optional reusable prompt snippets used by this agent.</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateAgentDraft((draft) => ({
                            ...draft,
                            prompts: draft.prompts.concat({ key: newDraftKey(), id: "", content: "", description: "" }),
                          }))
                        }
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={agentSaving}
                      >
                        Add prompt
                      </button>
                    </div>

                    {agentDraft.prompts.length ? (
                      <div className="mt-4 space-y-3">
                        {agentDraft.prompts.map((prompt, idx) => (
                          <div key={prompt.key} className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-medium text-zinc-900">Prompt {idx + 1}</p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      prompts: moveArrayItem(draft.prompts, idx, idx - 1),
                                    }))
                                  }
                                  disabled={agentSaving || idx === 0}
                                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      prompts: moveArrayItem(draft.prompts, idx, idx + 1),
                                    }))
                                  }
                                  disabled={agentSaving || idx === agentDraft.prompts.length - 1}
                                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      prompts: draft.prompts.filter((p) => p.key !== prompt.key),
                                    }))
                                  }
                                  disabled={agentSaving}
                                  className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5">
                                <label className="text-sm font-medium">
                                  prompts[{idx}].id <span className="text-red-600">*</span>
                                </label>
                                <input
                                  value={prompt.id}
                                  onChange={(e) =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      prompts: draft.prompts.map((p) => (p.key === prompt.key ? { ...p, id: e.target.value } : p)),
                                    }))
                                  }
                                  placeholder="e.g. finance-summary"
                                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                  disabled={agentSaving}
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-sm font-medium">
                                  prompts[{idx}].content <span className="text-red-600">*</span>
                                </label>
                                <MarkdownPreviewButton
                                  value={prompt.content}
                                  placeholder="Click to open Markdown editor…"
                                  maxLines={10}
                                  minHeightClass="min-h-28"
                                  disabled={agentSaving}
                                  onClick={() => setAgentMarkdownModal({ type: "prompt.content", key: prompt.key })}
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-2">
                                <div className="flex items-baseline justify-between gap-3">
                                  <label className="text-sm font-medium">
                                    prompts[{idx}].description <span className="text-zinc-400">(optional)</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateAgentDraft((draft) => ({
                                        ...draft,
                                        prompts: draft.prompts.map((p) => (p.key === prompt.key ? { ...p, description: "" } : p)),
                                      }))
                                    }
                                    className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={agentSaving || !prompt.description.trim()}
                                  >
                                    Clear
                                  </button>
                                </div>
                                <MarkdownPreviewButton
                                  value={prompt.description}
                                  placeholder="Click to open Markdown editor…"
                                  maxLines={6}
                                  minHeightClass="min-h-20"
                                  disabled={agentSaving}
                                  onClick={() => setAgentMarkdownModal({ type: "prompt.description", key: prompt.key })}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">No prompts yet.</p>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Menu" expanded={agentEditorExpanded.menu} onToggle={() => toggleAgentSection("menu")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="text-xs text-zinc-600">Optional BMAD-style shortcuts. Unknown keys are preserved on save.</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateAgentDraft((draft) => ({
                            ...draft,
                            menu: draft.menu.concat({ key: newDraftKey(), trigger: "", description: "", exec: "", extra: {} }),
                          }))
                        }
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={agentSaving}
                      >
                        Add menu item
                      </button>
                    </div>

                    {agentDraft.menu.length ? (
                      <div className="mt-4 space-y-3">
                        {agentDraft.menu.map((item, idx) => (
                          <div key={item.key} className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-900">Menu item {idx + 1}</p>
                                {Object.keys(item.extra ?? {}).length ? (
                                  <p className="mt-0.5 text-xs text-zinc-500">
                                    Preserved extra keys: {Object.keys(item.extra ?? {}).length}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({ ...draft, menu: moveArrayItem(draft.menu, idx, idx - 1) }))
                                  }
                                  disabled={agentSaving || idx === 0}
                                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({ ...draft, menu: moveArrayItem(draft.menu, idx, idx + 1) }))
                                  }
                                  disabled={agentSaving || idx === agentDraft.menu.length - 1}
                                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAgentDraft((draft) => ({ ...draft, menu: draft.menu.filter((m) => m.key !== item.key) }))
                                  }
                                  disabled={agentSaving}
                                  className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5">
                                <label className="text-sm font-medium">
                                  menu[{idx}].trigger <span className="text-zinc-400">(optional)</span>
                                </label>
                                <input
                                  value={item.trigger}
                                  onChange={(e) =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      menu: draft.menu.map((m) => (m.key === item.key ? { ...m, trigger: e.target.value } : m)),
                                    }))
                                  }
                                  placeholder="e.g. help"
                                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                  disabled={agentSaving}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-sm font-medium">
                                  menu[{idx}].exec <span className="text-zinc-400">(optional)</span>
                                </label>
                                <input
                                  value={item.exec}
                                  onChange={(e) =>
                                    updateAgentDraft((draft) => ({
                                      ...draft,
                                      menu: draft.menu.map((m) => (m.key === item.key ? { ...m, exec: e.target.value } : m)),
                                    }))
                                  }
                                  placeholder="e.g. steps/step-01-xxx.md"
                                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                  disabled={agentSaving}
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-sm font-medium">
                                  menu[{idx}].description <span className="text-red-600">*</span>
                                </label>
                                <MarkdownPreviewButton
                                  value={item.description}
                                  placeholder="Click to open Markdown editor…"
                                  maxLines={8}
                                  minHeightClass="min-h-24"
                                  disabled={agentSaving}
                                  onClick={() => setAgentMarkdownModal({ type: "menu.description", key: item.key })}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">No menu items yet.</p>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Tools" expanded={agentEditorExpanded.tools} onToggle={() => toggleAgentSection("tools")}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-900">tools.fs</p>
                          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              checked={Boolean(agentDraft.tools.fs.enabled)}
                              onChange={(e) =>
                                updateAgentDraft((draft) => ({
                                  ...draft,
                                  tools: { ...draft.tools, fs: { ...draft.tools.fs, enabled: e.target.checked } },
                                }))
                              }
                              disabled={agentSaving}
                            />
                            enabled
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-zinc-700">maxReadBytes</label>
                            <input
                              type="number"
                              min={1}
                              value={typeof agentDraft.tools.fs.maxReadBytes === "number" ? String(agentDraft.tools.fs.maxReadBytes) : ""}
                              onChange={(e) =>
                                updateAgentDraft((draft) => {
                                  const raw = e.target.value;
                                  const nextValue = raw === "" ? undefined : Math.trunc(Number(raw));
                                  return {
                                    ...draft,
                                    tools: {
                                      ...draft.tools,
                                      fs: { ...draft.tools.fs, maxReadBytes: Number.isFinite(nextValue) ? nextValue : undefined },
                                    },
                                  };
                                })
                              }
                              placeholder="(optional)"
                              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              disabled={agentSaving}
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-medium text-zinc-700">maxWriteBytes</label>
                            <input
                              type="number"
                              min={1}
                              value={typeof agentDraft.tools.fs.maxWriteBytes === "number" ? String(agentDraft.tools.fs.maxWriteBytes) : ""}
                              onChange={(e) =>
                                updateAgentDraft((draft) => {
                                  const raw = e.target.value;
                                  const nextValue = raw === "" ? undefined : Math.trunc(Number(raw));
                                  return {
                                    ...draft,
                                    tools: {
                                      ...draft.tools,
                                      fs: { ...draft.tools.fs, maxWriteBytes: Number.isFinite(nextValue) ? nextValue : undefined },
                                    },
                                  };
                                })
                              }
                              placeholder="(optional)"
                              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              disabled={agentSaving}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-900">tools.mcp</p>
                          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              checked={Boolean(agentDraft.tools.mcp.enabled)}
                              onChange={(e) =>
                                updateAgentDraft((draft) => ({
                                  ...draft,
                                  tools: { ...draft.tools, mcp: { ...draft.tools.mcp, enabled: e.target.checked } },
                                }))
                              }
                              disabled={agentSaving}
                            />
                            enabled
                          </label>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <label className="text-xs font-medium text-zinc-700">allowedServers</label>
                            <button
                              type="button"
                              onClick={() =>
                                updateAgentDraft((draft) => ({
                                  ...draft,
                                  tools: { ...draft.tools, mcp: { ...draft.tools.mcp, allowedServers: [] } },
                                }))
                              }
                              className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={agentSaving || (agentDraft.tools.mcp.allowedServers ?? []).length === 0}
                            >
                              Clear
                            </button>
                          </div>
                          <MarkdownPreviewButton
                            value={stringArrayToMarkdownList(agentDraft.tools.mcp.allowedServers ?? [])}
                            placeholder="Click to open Markdown editor…"
                            maxLines={8}
                            minHeightClass="min-h-24"
                            disabled={agentSaving}
                            onClick={() => setAgentMarkdownModal({ type: "tools.mcp.allowedServers" })}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-500">
                      Defaults when omitted: <span className="font-mono">fs.enabled=true</span>, <span className="font-mono">mcp.enabled=false</span>,{" "}
                      <span className="font-mono">mcp.allowedServers=[]</span>.
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Advanced"
                    expanded={agentEditorExpanded.advanced}
                    onToggle={() => toggleAgentSection("advanced")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium">
                          systemPrompt <span className="text-zinc-400">(optional)</span>
                        </label>
                        <MarkdownPreviewButton
                          value={agentDraft.systemPrompt}
                          placeholder="Click to open Markdown editor…"
                          maxLines={10}
                          minHeightClass="min-h-28"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "systemPrompt" })}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium">
                          userPromptTemplate <span className="text-zinc-400">(optional)</span>
                        </label>
                        <MarkdownPreviewButton
                          value={agentDraft.userPromptTemplate}
                          placeholder="Click to open Markdown editor…"
                          maxLines={10}
                          minHeightClass="min-h-28"
                          disabled={agentSaving}
                          onClick={() => setAgentMarkdownModal({ type: "userPromptTemplate" })}
                        />
                      </div>

                      <div className="flex items-center gap-4 md:col-span-2">
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            checked={agentDraft.discussion}
                            onChange={(e) => updateAgentDraft((draft) => ({ ...draft, discussion: e.target.checked }))}
                            disabled={agentSaving}
                          />
                          discussion
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            checked={agentDraft.webskip}
                            onChange={(e) => updateAgentDraft((draft) => ({ ...draft, webskip: e.target.checked }))}
                            disabled={agentSaving}
                          />
                          webskip
                        </label>
                        <span className="text-xs text-zinc-500">
                          conversational_knowledge: {agentDraft.conversational_knowledge.length} item(s) (preserved)
                        </span>
                      </div>
                    </div>
                  </CollapsibleSection>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-200 bg-white px-6 py-5">
              <button
                type="button"
                onClick={closeAgentModal}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={agentSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveAgent()}
                disabled={agentSaving || !agentDraft}
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {agentSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
