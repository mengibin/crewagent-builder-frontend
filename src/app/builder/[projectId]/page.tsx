"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import YAML from "yaml";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";

import { clearAccessToken } from "@/lib/auth";
import { AppActionDialog, type AppActionDialogTone } from "@/components/AppActionDialog";
import { MarkdownEditorModal } from "@/components/MarkdownEditorModal";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { buildAiWorkbenchUrl } from "@/lib/ai-workbench-client";
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
import { normalizeAssetsPath, parseAssetsJson } from "@/lib/assets-v11";
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

type BuilderDialogState =
  | {
    kind: "confirm";
    title: string;
    message: string;
    confirmLabel?: string;
    tone?: AppActionDialogTone;
    resolve: (confirmed: boolean) => void;
  }
  | {
    kind: "alert";
    title: string;
    message: string;
  };

type AssetTreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children: AssetTreeNode[];
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
type AssetModalMode = "edit" | "new-file" | "new-folder";

const ASSET_FOLDER_MARKER_FILE = ".folder.txt";

function normalizeFolderPath(input: string): string {
  const raw = input.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!raw) return "assets";
  if (raw === "assets") return "assets";
  return raw.startsWith("assets/") ? raw : `assets/${raw.replace(/^\/+/, "")}`;
}

function isFolderMarkerPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/");
  return normalized.startsWith("assets/") && normalized.endsWith(`/${ASSET_FOLDER_MARKER_FILE}`);
}

function folderPathFromMarkerPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!isFolderMarkerPath(normalized)) return normalizeFolderPath(normalized);
  return normalized.slice(0, -(`/${ASSET_FOLDER_MARKER_FILE}`.length));
}

function folderMarkerPath(folderPath: string): string {
  return `${normalizeFolderPath(folderPath)}/${ASSET_FOLDER_MARKER_FILE}`;
}

function getAssetParentPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "assets";
  return normalizeFolderPath(normalized.slice(0, idx));
}

function getAssetLeafName(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  return normalized.slice(idx + 1);
}

function joinAssetPath(parentPath: string, leafName: string): string {
  const parent = normalizeFolderPath(parentPath);
  return `${parent}/${leafName.trim().replace(/^\/+/, "")}`;
}

function getAssetExtension(path: string): string {
  const name = getAssetLeafName(path);
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx).toLowerCase();
}

type AssetCodeLanguage = "json" | "python" | "yaml" | "markdown" | "plain";

function getAssetCodeLanguage(path: string): AssetCodeLanguage {
  const ext = getAssetExtension(path);
  if (ext === ".json") return "json";
  if (ext === ".py") return "python";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".md") return "markdown";
  return "plain";
}

function getAssetCodeLanguageLabel(path: string): string {
  const language = getAssetCodeLanguage(path);
  if (language === "json") return "JSON";
  if (language === "python") return "Python";
  if (language === "yaml") return "YAML";
  if (language === "markdown") return "Markdown";
  return "Text";
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightAssetCode(path: string, code: string): string {
  const language = getAssetCodeLanguage(path);
  if (language === "plain") return escapeHtml(code);
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, language);
  } catch {
    return escapeHtml(code);
  }
}

function renderAssetPreview(path: string, content: string): ReactNode {
  const ext = getAssetExtension(path);

  if (ext === ".md") {
    return <MarkdownPreview markdown={content} emptyText="(empty markdown)" />;
  }

  if (ext === ".json") {
    try {
      const value = content.trim() ? JSON.parse(content) : {};
      return (
        <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    } catch {
      return (
        <div className="space-y-2">
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            Invalid JSON: preview shows raw text.
          </div>
          <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">{content}</pre>
        </div>
      );
    }
  }

  if (ext === ".yml" || ext === ".yaml") {
    try {
      const value = content.trim() ? YAML.parse(content) : {};
      return (
        <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    } catch {
      return (
        <div className="space-y-2">
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            Invalid YAML: preview shows raw text.
          </div>
          <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">{content}</pre>
        </div>
      );
    }
  }

  if (ext === ".py") {
    return <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">{content}</pre>;
  }

  if (ext === ".txt") {
    return <pre className="whitespace-pre-wrap break-words rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-6 text-zinc-900">{content}</pre>;
  }

  return <pre className="overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs leading-6 text-zinc-50">{content}</pre>;
}

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

function buildAssetsTree(list: { path: string }[], explicitFolders: string[] = []): AssetTreeNode[] {
  type BuildNode = { node: AssetTreeNode; children: Map<string, BuildNode> };
  const root = new Map<string, BuildNode>();
  const upsertPath = (path: string, leafType: "file" | "folder") => {
    const rawPath = path.startsWith("assets/") ? path.slice("assets/".length) : path;
    const parts = rawPath.split("/").filter(Boolean);
    if (!parts.length) return;
    let currentMap = root;
    let currentPath = "assets";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      currentPath = `${currentPath}/${part}`;
      let buildNode = currentMap.get(part);
      const nextType: "file" | "folder" = isLeaf ? leafType : "folder";
      if (!buildNode) {
        buildNode = {
          node: { name: part, path: currentPath, type: nextType, children: [] },
          children: new Map(),
        };
        currentMap.set(part, buildNode);
      } else if (nextType === "folder" && buildNode.node.type !== "folder") {
        buildNode.node.type = "folder";
      }
      if (!isLeaf) currentMap = buildNode.children;
    }
  };

  for (const asset of list) {
    upsertPath(asset.path, "file");
  }
  for (const folder of explicitFolders) {
    upsertPath(folder, "folder");
  }

  const toNode = (buildNode: BuildNode): AssetTreeNode => ({
    ...buildNode.node,
    children: Array.from(buildNode.children.values()).map(toNode),
  });

  const sortNodes = (nodes: AssetTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };

  const rootNodes = Array.from(root.values()).map(toNode);
  sortNodes(rootNodes);
  return rootNodes;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const projectId = params?.projectId;
  const searchQuery = searchParams.toString();
  const returnTo = useMemo(() => {
    if (!pathname) return "";
    return searchQuery ? `${pathname}?${searchQuery}` : pathname;
  }, [pathname, searchQuery]);

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
  const [assetModalMode, setAssetModalMode] = useState<AssetModalMode>("new-file");
  const [assetEditingPath, setAssetEditingPath] = useState<string | null>(null);
  const [assetParentPath, setAssetParentPath] = useState("assets");
  const [assetNameDraft, setAssetNameDraft] = useState("");
  const [assetContentDraft, setAssetContentDraft] = useState("");
  const [assetFormError, setAssetFormError] = useState<string | null>(null);
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetDeletingPath, setAssetDeletingPath] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<BuilderDialogState | null>(null);

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
  const visibleAssetsList = useMemo(
    () => assetsList.filter((asset) => !isFolderMarkerPath(asset.path)),
    [assetsList],
  );
  const visibleAssetsMap = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [path, content] of Object.entries(assetsMap)) {
      if (isFolderMarkerPath(path)) continue;
      next[path] = content;
    }
    return next;
  }, [assetsMap]);
  const explicitFolderPaths = useMemo(
    () => Object.keys(assetsMap).filter(isFolderMarkerPath).map(folderPathFromMarkerPath),
    [assetsMap],
  );
  const assetsParseError = assetsParsed.error;
  const assetsTree = useMemo(() => buildAssetsTree(visibleAssetsList, explicitFolderPaths), [visibleAssetsList, explicitFolderPaths]);
  const [collapsedAssetPaths, setCollapsedAssetPaths] = useState<Record<string, boolean>>({});
  const [selectedAssetFolderPath, setSelectedAssetFolderPath] = useState("assets");

  useEffect(() => {
    if (selectedAssetFolderPath === "assets") return;
    const stillExists =
      explicitFolderPaths.includes(selectedAssetFolderPath) ||
      Object.keys(visibleAssetsMap).some((p) => p.startsWith(`${selectedAssetFolderPath}/`));
    if (!stillExists) setSelectedAssetFolderPath("assets");
  }, [explicitFolderPaths, selectedAssetFolderPath, visibleAssetsMap]);

  const [readmeDraft, setReadmeDraft] = useState("");
  const [readmeModalOpen, setReadmeModalOpen] = useState(false);

  useEffect(() => {
    if (!activeData?.workflowMd) {
      setReadmeDraft("");
      return;
    }
    setReadmeDraft(activeData.workflowMd);
  }, [activeData?.workflowMd, projectId]);

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
    if (!projectId) return;
    router.push(`/builder/${projectId}/agents/new`);
  }

  function openEditAgent(agentId: string): void {
    if (!projectId) return;
    router.push(`/builder/${projectId}/agents/${encodeURIComponent(agentId)}`);
  }

  function openAiWorkbench(targetType: "workflow" | "agent" | "asset", targetId: string, mode: "create" | "optimize" = "optimize"): void {
    if (!projectId) return;
    const normalizedTargetId = `${targetId ?? ""}`.trim();
    if (!normalizedTargetId) return;
    const parsedWorkflowId = targetType === "workflow" ? Number.parseInt(normalizedTargetId, 10) : NaN;
    const workflowId = Number.isFinite(parsedWorkflowId) && parsedWorkflowId > 0 ? parsedWorkflowId : null;
    router.push(
      buildAiWorkbenchUrl({
        projectId,
        targetType,
        targetId: normalizedTargetId,
        mode,
        workflowId,
        source: "builder",
        returnTo,
      }),
    );
  }

  function showDialogAlert(message: string, title = "Notice"): void {
    setDialogState({ kind: "alert", title, message });
  }

  function showDialogConfirm(options: {
    title: string;
    message: string;
    confirmLabel?: string;
    tone?: AppActionDialogTone;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setDialogState({
        kind: "confirm",
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        tone: options.tone,
        resolve,
      });
    });
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
    const confirmed = await showDialogConfirm({
      title: "Delete agent",
      message: `Delete Agent "${title}" (id: ${agentId})?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
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
      showDialogAlert("You must keep at least 1 workflow.", "Delete workflow blocked");
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
      showDialogAlert(
        `This workflow is referenced by subworkflow nodes: ${summary}. Remove the references before deleting.`,
        "Delete workflow blocked",
      );
      setWorkflowDeletingId(null);
      return;
    }

    const label = workflow.isDefault ? `${workflow.name} (default)` : workflow.name;
    const confirmed = await showDialogConfirm({
      title: "Delete workflow",
      message: `Delete workflow "${label}" (ID: ${workflow.id})?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
      setWorkflowDeletingId(null);
      return;
    }
    const res = await deleteJson<{ id: number }>(`/packages/${projectId}/workflows/${workflow.id}`, { auth: true });
    setWorkflowDeletingId(null);

    if (res.error) {
      showDialogAlert(res.error.message ?? "Delete failed. Please try again.", "Delete workflow failed");
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
    setAssetModalMode("new-file");
    setAssetParentPath("assets");
    setAssetNameDraft("");
    setAssetContentDraft("");
    setAssetFormError(null);
  }

  function closeAssetModal(): void {
    if (assetSaving) return;
    setAssetModalOpen(false);
    resetAssetForm();
  }

  function openCreateAsset(parentPath = "assets", mode: "new-file" | "new-folder" = "new-file"): void {
    resetAssetForm();
    setAssetModalMode(mode);
    setAssetParentPath(normalizeFolderPath(parentPath));
    setAssetNameDraft("");
    setAssetContentDraft("");
    setAssetModalOpen(true);
  }

  function openEditAsset(path: string): void {
    const content = visibleAssetsMap[path];
    if (typeof content !== "string") return;
    resetAssetForm();
    setAssetModalMode("edit");
    setAssetEditingPath(path);
    setAssetParentPath(getAssetParentPath(path));
    setAssetNameDraft(getAssetLeafName(path));
    setAssetContentDraft(content);
    setAssetFormError(null);
    setAssetModalOpen(true);
  }

  function resolveAssetCreateTarget(): { path: string | null; folderPath: string | null; error: string | null } {
    const leafName = assetNameDraft.trim().replace(/\\/g, "/");
    if (!leafName) return { path: null, folderPath: null, error: "Name is required." };
    if (leafName.includes("/")) {
      return { path: null, folderPath: null, error: "Name must be a single segment (do not include '/')." };
    }

    if (assetModalMode === "new-folder") {
      const folderPath = normalizeFolderPath(joinAssetPath(assetParentPath, leafName));
      const markerPath = folderMarkerPath(folderPath);
      const normalized = normalizeAssetsPath(markerPath);
      if (normalized.error || !normalized.value) {
        return { path: null, folderPath: null, error: normalized.error ?? "Invalid folder path." };
      }
      const folderExists =
        explicitFolderPaths.includes(folderPath) ||
        Object.keys(visibleAssetsMap).some((p) => p.startsWith(`${folderPath}/`));
      if (folderExists) {
        return { path: null, folderPath: null, error: "Folder already exists." };
      }
      return { path: normalized.value, folderPath, error: null };
    }

    const fullPath = joinAssetPath(assetParentPath, leafName);
    const normalized = normalizeAssetsPath(fullPath);
    if (normalized.error || !normalized.value) {
      return { path: null, folderPath: null, error: normalized.error ?? "Invalid file path." };
    }
    if (assetsMap[normalized.value]) {
      return { path: null, folderPath: null, error: "File already exists in this folder." };
    }
    return { path: normalized.value, folderPath: getAssetParentPath(normalized.value), error: null };
  }

  async function saveAsset(): Promise<void> {
    if (apiEnvError) {
      setAssetFormError(apiEnvError);
      return;
    }
    if (!projectId) return;
    if (assetSaving) return;

    let path = assetEditingPath;
    let createdFolderPath: string | null = null;
    if (assetModalMode !== "edit") {
      const resolved = resolveAssetCreateTarget();
      if (resolved.error || !resolved.path) {
        setAssetFormError(resolved.error ?? "Invalid path.");
        return;
      }
      path = resolved.path;
      createdFolderPath = resolved.folderPath;
    }
    if (!path) {
      setAssetFormError("Asset path is missing.");
      return;
    }
    const content = assetModalMode === "new-folder" ? "" : assetContentDraft ?? "";

    setAssetSaving(true);
    setAssetFormError(null);

    const res = assetModalMode === "edit"
      ? await putJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { path, content }, { auth: true })
      : await postJson<PackageAssetsOut>(`/packages/${projectId}/assets`, { path, content }, { auth: true });

    setAssetSaving(false);

    if (res.error || !res.data) {
      setAssetFormError(res.error?.message ?? "Save failed. Please try again.");
      return;
    }

    setAssetsJsonRaw(res.data.assetsJson || "{}");
    setAssetsError(null);
    if (createdFolderPath) {
      setCollapsedAssetPaths((prev) => ({
        ...prev,
        [assetParentPath]: false,
        [createdFolderPath]: false,
      }));
    }
    closeAssetModal();
  }

  async function deleteAsset(path: string): Promise<void> {
    if (apiEnvError) return;
    if (!projectId) return;
    if (assetDeletingPath) return;

    const confirmed = await showDialogConfirm({
      title: "Delete asset",
      message: `Delete asset "${path}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;

    setAssetDeletingPath(path);
    const res = await deleteJsonWithBody<PackageAssetsOut>(`/packages/${projectId}/assets`, { path }, { auth: true });
    setAssetDeletingPath(null);

    if (res.error || !res.data) {
      showDialogAlert(res.error?.message ?? "Delete failed. Please try again.", "Delete asset failed");
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
        ...(Object.keys(visibleAssetsMap).length ? { assets: visibleAssetsMap } : {}),
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

  const pineconeTitle = activeData?.name ?? "Pinecone";
  const isAssetCollapsed = (path: string): boolean => Boolean(collapsedAssetPaths[path]);
  const toggleAssetCollapse = (path: string): void => {
    setCollapsedAssetPaths((prev) => ({ ...prev, [path]: !prev[path] }));
  };
  const renderAssetsNodes = (nodes: AssetTreeNode[]): ReactNode =>
    nodes.map((node) => {
      const isFolder = node.type === "folder";
      const normalizedPath = normalizeFolderPath(node.path);
      const collapsed = isFolder ? isAssetCollapsed(normalizedPath) : false;
      const isFolderSelected = isFolder && selectedAssetFolderPath === normalizedPath;
      const fullPath = node.path.startsWith("assets/") ? node.path : `assets/${node.path}`;
      return (
        <div key={node.path} className="space-y-2">
          <div
            onClick={() => {
              if (isFolder) {
                setSelectedAssetFolderPath(normalizedPath);
                return;
              }
              openEditAsset(fullPath);
            }}
            className={`flex min-w-max cursor-pointer items-center justify-between rounded-2xl border px-3 py-2 transition-colors ${
              isFolderSelected ? "border-[#9CB8FF] bg-[#ECF2FF]" : "border-[#DDE3EE] bg-white"
            }`}
          >
            {isFolder ? (
              <div className="flex min-w-max items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleAssetCollapse(normalizedPath);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[#94A0B8] hover:bg-[#E9EDFF]"
                  aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
                  >
                    <path
                      d="M7 10l5 5 5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="flex min-w-max items-center gap-2 text-left">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#4F46E5]">
                    <path
                      d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="whitespace-nowrap text-xs font-semibold text-[#1F2937]">{node.name}/</span>
                </div>
              </div>
            ) : (
              <div className="flex min-w-max items-center gap-2 text-left">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 text-[#94A0B8]"
                >
                  <path
                    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="whitespace-nowrap text-xs font-semibold text-[#1F2937]">{node.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {isFolder ? (
                isFolderSelected ? (
                  <span className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2 py-0.5 text-[10px] font-semibold text-[#4F46E5]">
                    Target
                  </span>
                ) : null
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openAiWorkbench("asset", fullPath, "create");
                    }}
                    disabled={!projectId}
                    className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2 py-0.5 text-[10px] font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    AI workbench
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteAsset(fullPath);
                    }}
                    className="text-[#C23B3B] disabled:opacity-40"
                    aria-label={`Delete ${node.name}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                      <path
                        d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
          {isFolder && !collapsed && node.children.length ? (
            <div className="ml-3 border-l border-[#DDE3EE] pl-3">
              <div className="space-y-2">{renderAssetsNodes(node.children)}</div>
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="mx-auto w-full px-8 py-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
              <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <p className="text-sm font-semibold">CrewAgent Builder</p>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/dashboard" className="text-[#4F46E5]">
              ← Dashboard
            </Link>
            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="flex items-center gap-2 text-[#1F2937]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#C7D2FE] bg-[#E9EDFF]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#4F46E5]" />
              </span>
              Cora Lin
            </button>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-[#5F6B82]"
            >
              Logout
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
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {apiEnvError}
          </div>
        ) : null}

        <section className="mt-8">
          <span className="inline-flex rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5]">
            Pinecone
          </span>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">{pineconeTitle}</h1>
          <p className="mt-2 text-sm text-[#5F6B82]">Last updated 2 days ago · Owner: Cora Lin</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
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
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-4 py-2 text-xs font-semibold text-[#4F46E5] shadow-[0_6px_16px_rgba(79,70,229,0.12)] transition-colors hover:bg-[#DFE6FF] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3v11" />
                <path d="m8 10 4 4 4-4" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <span>{exporting ? "Exporting..." : "Export Pinecone"}</span>
            </button>
          </div>
        </section>

        <div className="mt-8 grid gap-4 lg:grid-cols-3 lg:items-stretch">
          <section className="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-[24px] border border-[#DDE3EE] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#4F46E5]">
                  <path
                    d="M6 3v6a3 3 0 0 0 3 3h6M6 21v-6a3 3 0 0 1 3-3h6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <h2 className="text-sm font-semibold">Workflows</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateWorkflow}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError)}
                  className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5] disabled:opacity-60"
                >
                  New workflow
                </button>
                <span className="text-[11px] font-semibold text-[#94A0B8]">{activeWorkflows.length}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Left · All
              </span>
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Up · Recent
              </span>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {isLoading ? (
                <p className="text-xs text-[#94A0B8]">Loading...</p>
              ) : activeError || activeWorkflowsError ? (
                <p className="text-xs text-[#94A0B8]">Failed to load workflows.</p>
              ) : activeWorkflows.length === 0 ? (
                <p className="text-xs text-[#94A0B8]">No workflows yet.</p>
              ) : (
                activeWorkflows.map((wf) => (
                  <div
                    key={wf.id}
                    onClick={() => router.push(`/editor/${projectId}/${wf.id}`)}
                    className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#DDE3EE] bg-white px-3 py-2"
                  >
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-semibold">{wf.name}</p>
                        {wf.isDefault ? (
                          <span className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2 py-0.5 text-[10px] font-semibold text-[#4F46E5]">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-[#94A0B8]">Updated recently</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAiWorkbench("workflow", String(wf.id), "optimize");
                        }}
                        disabled={!projectId}
                        className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2.5 py-1 text-[10px] font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        AI workbench
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteWorkflow(wf);
                        }}
                        disabled={
                          isLoading ||
                          Boolean(activeError) ||
                          Boolean(apiEnvError) ||
                          workflowDeletingId === wf.id
                        }
                        className="text-[#C23B3B] disabled:opacity-50"
                        aria-label={`Delete workflow ${wf.name}`}
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                          <path
                            d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-[24px] border border-[#DDE3EE] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Agents</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateAgent}
                  disabled={Boolean(agentsError)}
                  className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5] disabled:opacity-60"
                >
                  New agent
                </button>
                <span className="text-[11px] font-semibold text-[#94A0B8]">{agents.length} agents</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Left · All
              </span>
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Up · Active
              </span>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {agents.length === 0 ? (
                <p className="text-xs text-[#94A0B8]">No agents yet.</p>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => openEditAgent(agent.id)}
                    className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#DDE3EE] bg-white px-3 py-2"
                  >
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#4F46E5]">
                          <path
                            d="M12 3l1.9 3.9L18 8l-3 2.9.7 4.1-3.7-2-3.7 2 .7-4.1L6 8l4.1-1.1L12 3z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <p className="truncate text-xs font-semibold">{agent.title || agent.name}</p>
                      </div>
                      <p className="text-[11px] text-[#94A0B8]">{agent.role || "Agent"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAiWorkbench("agent", agent.id, "optimize");
                        }}
                        disabled={!projectId}
                        className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2.5 py-1 text-[10px] font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        AI workbench
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteAgent(agent.id);
                        }}
                        disabled={Boolean(agentsError) || agentDeletingId === agent.id}
                        className="text-[#C23B3B] disabled:opacity-50"
                        aria-label={`Delete agent ${agent.title || agent.name}`}
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                          <path
                            d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-[24px] border border-[#DDE3EE] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Assets</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openCreateAsset(selectedAssetFolderPath, "new-folder")}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError) || assetSaving}
                  className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5] disabled:opacity-60"
                >
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={() => openCreateAsset(selectedAssetFolderPath, "new-file")}
                  disabled={isLoading || Boolean(activeError) || Boolean(apiEnvError) || assetSaving}
                  className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-xs font-semibold text-[#5F6B82] disabled:opacity-60"
                >
                  New File
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Left · Folder
              </span>
              <span className="rounded-full border border-[#DDE3EE] bg-white px-3 py-1 text-[10px] font-semibold text-[#5F6B82]">
                Up · Name
              </span>
              <span className="rounded-full border border-[#C7D2FE] bg-[#EEF3FF] px-3 py-1 text-[10px] font-semibold text-[#4F46E5]">
                Target · {selectedAssetFolderPath === "assets" ? "Assets/" : `${selectedAssetFolderPath.replace(/^assets\//, "")}/`}
              </span>
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-x-auto overflow-y-auto pr-1">
              <div className="min-w-max space-y-2 pb-1">
                <div
                  onClick={() => setSelectedAssetFolderPath("assets")}
                  className={`flex min-w-max cursor-pointer items-center justify-between rounded-2xl border px-3 py-2 transition-colors ${
                    selectedAssetFolderPath === "assets" ? "border-[#9CB8FF] bg-[#ECF2FF]" : "border-[#DDE3EE] bg-[#EEF2F8]"
                  }`}
                >
                  <div className="flex min-w-max items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAssetCollapse("assets");
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[#94A0B8] hover:bg-[#E9EDFF]"
                      aria-label={isAssetCollapsed("assets") ? "Expand assets" : "Collapse assets"}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-3 w-3 transition-transform ${isAssetCollapsed("assets") ? "-rotate-90" : "rotate-0"}`}
                      >
                        <path
                          d="M7 10l5 5 5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <div className="flex min-w-max items-center gap-2 text-left">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#4F46E5]">
                        <path
                          d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <p className="whitespace-nowrap text-xs font-semibold">Assets/</p>
                    </div>
                  </div>
                  {selectedAssetFolderPath === "assets" ? (
                    <span className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-2 py-0.5 text-[10px] font-semibold text-[#4F46E5]">
                      Target
                    </span>
                  ) : null}
                </div>
                {assetsTree.length ? (
                  !isAssetCollapsed("assets") ? (
                    <div className="ml-3 border-l border-[#DDE3EE] pl-3">
                      <div className="space-y-2">{renderAssetsNodes(assetsTree)}</div>
                    </div>
                  ) : null
                ) : (
                  <p className="text-xs text-[#94A0B8]">No assets yet.</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-[24px] border border-[#DDE3EE] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Overview</h2>
            <button
              type="button"
              onClick={() => setReadmeModalOpen(true)}
              className="rounded-full border border-[#DDE3EE] bg-white px-2 py-1 text-[#5F6B82]"
              aria-label="Edit overview"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <path
                  d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="mt-3 min-h-40 rounded-xl border border-[#DDE3EE] bg-white px-4 py-3">
            <MarkdownPreview markdown={readmeDraft} emptyText="No overview yet. Click the edit button to add one." />
          </div>
        </section>
      </div>

      {readmeModalOpen ? (
        <MarkdownEditorModal
          title="Edit Overview"
          value={readmeDraft}
          placeholder="Write the overview here..."
          onChange={setReadmeDraft}
          onClose={() => setReadmeModalOpen(false)}
        />
      ) : null}

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
          <div className="absolute inset-0 bg-zinc-950/30" onClick={closeAssetModal} />
          <div
            className={`relative flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg ${
              assetModalMode === "edit" ? "max-w-6xl p-5" : "max-w-lg p-6"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold tracking-tight">
                  {assetModalMode === "edit"
                    ? `Edit ${assetNameDraft || "asset"}`
                    : assetModalMode === "new-folder"
                      ? "New folder"
                      : "New file"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAssetModal}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
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

            {assetModalMode === "edit" ? (
              (() => {
                const editingPath = assetEditingPath ?? "";
                const isMarkdownAsset = getAssetCodeLanguage(editingPath) === "markdown";
                return isMarkdownAsset ? (
                  <div className="mt-4 grid h-[62vh] min-h-[360px] grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200">
                      <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700">
                        Editor
                      </div>
                      <textarea
                        id="asset-content"
                        value={assetContentDraft}
                        onChange={(e) => {
                          setAssetContentDraft(e.target.value);
                          if (assetFormError) setAssetFormError(null);
                        }}
                        className="min-h-0 flex-1 resize-none overflow-auto border-0 px-3 py-3 font-mono text-xs leading-6 text-zinc-900 outline-none"
                        placeholder="# content..."
                      />
                    </div>
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200">
                      <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700">
                        Preview
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                        {renderAssetPreview(editingPath, assetContentDraft)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex h-[62vh] min-h-[360px] flex-col overflow-hidden rounded-xl border border-zinc-200">
                    <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700">
                      Editor · {getAssetCodeLanguageLabel(editingPath)}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-[#0B1220]">
                      <Editor
                        value={assetContentDraft}
                        onValueChange={(value) => {
                          setAssetContentDraft(value);
                          if (assetFormError) setAssetFormError(null);
                        }}
                        highlight={(code) => highlightAssetCode(editingPath, code)}
                        padding={12}
                        textareaId="asset-content"
                        className="asset-code-editor min-h-full font-mono text-xs leading-6 text-[#E6EDF6]"
                        textareaClassName="asset-code-editor__textarea"
                        preClassName="asset-code-editor__pre"
                      />
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="mt-4 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="asset-name">
                  {assetModalMode === "new-folder" ? "Folder name" : "File name"} <span className="text-red-600">*</span>
                </label>
                <input
                  id="asset-name"
                  value={assetNameDraft}
                  onChange={(e) => {
                    setAssetNameDraft(e.target.value);
                    if (assetFormError) setAssetFormError(null);
                  }}
                  placeholder={assetModalMode === "new-folder" ? "e.g. templates" : "e.g. design_report.md"}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeAssetModal}
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

      <AppActionDialog
        open={Boolean(dialogState)}
        title={dialogState?.title ?? ""}
        message={dialogState?.message ?? ""}
        confirmLabel={dialogState?.kind === "confirm" ? (dialogState.confirmLabel ?? "Confirm") : "OK"}
        showCancel={dialogState?.kind === "confirm"}
        tone={dialogState?.kind === "confirm" ? (dialogState.tone ?? "default") : "default"}
        onCancel={() => {
          if (dialogState?.kind === "confirm") {
            dialogState.resolve(false);
          }
          setDialogState(null);
        }}
        onConfirm={() => {
          if (dialogState?.kind === "confirm") {
            dialogState.resolve(true);
          }
          setDialogState(null);
        }}
      />

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
