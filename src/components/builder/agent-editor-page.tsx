"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { buildAiWorkbenchUrl } from "@/lib/ai-workbench-client";
import { MarkdownEditorModal } from "@/components/MarkdownEditorModal";
import { mergeMenuItemFromDraft, splitMenuItemForDraft } from "@/lib/agent-menu-v11";
import {
  buildAgentsManifestV11,
  type AgentV11,
  type AgentsManifestV11,
  type PromptV11,
  type ToolPolicyV11,
} from "@/lib/agents-manifest-v11";
import { getApiBaseUrl, getJson, putJson, type ApiError } from "@/lib/api-client";
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

type AgentEditorMode = "new" | "edit";

const DEFAULT_EDITOR_EXPANDED: Record<string, boolean> = {
  metadata: true,
  persona: true,
  critical: false,
  prompts: false,
  menu: false,
  tools: false,
  advanced: false,
};

const DEFAULT_AGENT_TOOLS: Required<ToolPolicyV11> = {
  fs: { enabled: true },
  mcp: { enabled: false, allowedServers: [] },
};

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

function parseAgentsForEditor(raw: string): { manifest: AgentsManifestV11; error: string | null } {
  const empty: AgentsManifestV11 = { schemaVersion: "1.1", agents: [] };
  const trimmed = raw.trim();
  if (!trimmed) return { manifest: empty, error: null };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.length === 0) return { manifest: empty, error: null };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as { agents?: unknown };
      if (Array.isArray(obj.agents) && obj.agents.length === 0) return { manifest: empty, error: null };
    }
  } catch {
    return { manifest: empty, error: "Failed to parse agentsJson (invalid JSON)." };
  }

  const built = buildAgentsManifestV11({ agentsJsonRaw: raw });
  if (built.manifest) return { manifest: built.manifest, error: null };

  const summary = built.errors.slice(0, 3).join("; ");
  const suffix = built.errors.length > 3 ? `... (total ${built.errors.length})` : "";
  return {
    manifest: empty,
    error: summary ? `agentsJson has issues: ${summary}${suffix}. Please fix them before editing/saving.` : "agentsJson is invalid.",
  };
}

function formatLoadError(error: ApiError): { title: string; message: string } {
  switch (error.code) {
    case "PACKAGE_NOT_FOUND":
      return { title: "Project not found", message: "This project doesn't exist, was deleted, or you don't have access." };
    case "VALIDATION_ERROR":
      return { title: "Invalid project ID", message: "The projectId in the URL is invalid. Go back and open it again." };
    case "NETWORK_ERROR":
      return { title: "Network error", message: "Unable to reach the backend service. Please try again later." };
    default:
      return { title: "Failed to load", message: error.message || "Failed to load. Please try again later." };
  }
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
        className="flex w-full items-center justify-between gap-4 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100"
      >
        <span className="text-sm font-medium text-zinc-900">
          {props.title}
          {props.required ? <span className="ml-1 text-red-600">*</span> : null}
        </span>
        <span className="text-xs text-zinc-500">{props.expanded ? "Collapse" : "Expand"}</span>
      </button>
      {props.expanded ? <div className="border-t border-zinc-200 p-3">{props.children}</div> : null}
    </div>
  );
}

export function AgentEditorPage(props: { projectId: string; mode: AgentEditorMode; agentId?: string }) {
  const { projectId, mode, agentId } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const searchQuery = searchParams.toString();
  const returnTo = useMemo(() => {
    if (!pathname) return "";
    return searchQuery ? `${pathname}?${searchQuery}` : pathname;
  }, [pathname, searchQuery]);

  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  const [agentEditingId, setAgentEditingId] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentMarkdownModal, setAgentMarkdownModal] = useState<AgentMarkdownModalState | null>(null);
  const [agentEditorExpanded, setAgentEditorExpanded] = useState<Record<string, boolean>>(DEFAULT_EDITOR_EXPANDED);
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentsManifest, setAgentsManifest] = useState<AgentsManifestV11>({ schemaVersion: "1.1", agents: [] });
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;
    if (!projectId) return;

    let cancelled = false;

    getJson<PackageDetail>(`/packages/${projectId}`, { auth: true })
      .then((res) => {
        if (cancelled) return;

        if (res.error) {
          setLoadError(res.error);
          setAgentsManifest({ schemaVersion: "1.1", agents: [] });
          setAgentsError(null);
        } else if (!res.data) {
          setLoadError({ code: "BAD_RESPONSE", message: "Unexpected server response." });
          setAgentsManifest({ schemaVersion: "1.1", agents: [] });
          setAgentsError(null);
        } else {
          setLoadError(null);
          const parsed = parseAgentsForEditor(res.data.agentsJson ?? "");
          setAgentsManifest(parsed.manifest);
          setAgentsError(parsed.error);
          setAgentFormError(null);
          setAgentMarkdownModal(null);
          setAgentEditorExpanded(DEFAULT_EDITOR_EXPANDED);

          if (mode === "new") {
            setAgentEditingId(null);
            setAgentDraft(createEmptyAgentDraft());
          } else {
            const normalizedId = (agentId ?? "").trim();
            if (!normalizedId) {
              setAgentEditingId(null);
              setAgentDraft(null);
              setAgentFormError("Missing agentId in URL.");
            } else {
              const agent = parsed.manifest.agents.find((a) => a.id === normalizedId);
              if (!agent) {
                setAgentEditingId(normalizedId);
                setAgentDraft(null);
                setAgentFormError(`Agent not found: ${normalizedId}`);
              } else {
                setAgentEditingId(normalizedId);
                setAgentDraft(createAgentDraftFromAgent(agent));
              }
            }
          }
        }

        setLoadedProjectId(projectId);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError({ code: "NETWORK_ERROR", message: "Network error. Please try again later." });
        setAgentsManifest({ schemaVersion: "1.1", agents: [] });
        setAgentsError(null);
        setLoadedProjectId(projectId);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, apiEnvError, mode, projectId, ready, reloadSeq]);

  const isLoading = Boolean(ready && !apiEnvError && projectId && loadedProjectId !== projectId);
  const activeError = loadedProjectId === projectId ? loadError : null;
  const formattedLoadError = activeError ? formatLoadError(activeError) : null;

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
  const editAgentTitle =
    agentDraft?.metadata.title.trim() ||
    agentDraft?.metadata.name.trim() ||
    agentEditingId ||
    (agentId ?? "").trim() ||
    "Edit Agent";
  const agentMetadata = agentDraft?.metadata;
  const agentWorkbenchTargetId = useMemo(() => {
    if (agentEditingId) return agentEditingId.trim();
    if (mode !== "new") return "";
    const name = agentMetadata?.name.trim() ?? "";
    if (!name) return "";
    const ids = new Set(agentsManifest.agents.map((agent) => agent.id));
    const candidate = uniqueAgentId(name, ids);
    return isValidAgentId(candidate) ? candidate : "";
  }, [agentMetadata, agentEditingId, agentsManifest.agents, mode]);
  const canOpenAiWorkbench = Boolean(projectId && agentWorkbenchTargetId);
  const aiWorkbenchMode = mode === "new" ? "create" : "optimize";

  const openAiWorkbench = () => {
    if (!projectId || !agentWorkbenchTargetId) return;
    router.push(
      buildAiWorkbenchUrl({
        projectId,
        targetType: "agent",
        targetId: agentWorkbenchTargetId,
        mode: aiWorkbenchMode,
        source: "agent-editor",
        returnTo,
      }),
    );
  };

  function goBack(): void {
    router.push(`/builder/${projectId}`);
  }

  function renderAgentMarkdownModal(): ReactNode {
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
      setAgentFormError("Agent editor is not ready. Reload and try again.");
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
    const principles = Array.from(new Set(agentDraft.persona.principles.map((p) => p.trim()).filter(Boolean)));

    const critical_actions = Array.from(new Set(agentDraft.critical_actions.map((v) => v.trim()).filter(Boolean)));

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
        allowedServers: Array.from(new Set((agentDraft.tools.mcp.allowedServers ?? []).map((v) => v.trim()).filter(Boolean))),
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

    router.push(`/builder/${projectId}`);
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-sm text-zinc-600">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="mx-auto w-full max-w-[1280px] px-8 py-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
              <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <p className="text-sm font-semibold">CrewAgent Builder</p>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href={`/builder/${projectId}`} className="text-[#4F46E5]">
              ← Builder
            </Link>
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

        <section className="mt-8 rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
          <span className="inline-flex rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5]">
            Agent Editor
          </span>
          {mode === "edit" ? <h1 className="mt-3 text-3xl font-semibold leading-tight">{editAgentTitle}</h1> : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={agentSaving}
              className="rounded-full border border-[#DDE3EE] bg-white px-4 py-2 text-xs font-semibold text-[#5F6B82] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={openAiWorkbench}
              disabled={!canOpenAiWorkbench}
              title={!canOpenAiWorkbench ? "Enter an agent name to open AI workbench." : "Open AI workbench"}
              className="rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-4 py-2 text-xs font-semibold text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              AI workbench
            </button>
            <button
              type="button"
              onClick={() => void saveAgent()}
              disabled={agentSaving || !agentDraft}
              className="rounded-full bg-[#4F46E5] px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)] disabled:opacity-60"
            >
              {agentSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </section>

        {apiEnvError ? (
          <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {apiEnvError}
          </div>
        ) : null}

        {formattedLoadError ? (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-semibold">{formattedLoadError.title}</p>
            <p className="mt-1">{formattedLoadError.message}</p>
            <button
              type="button"
              onClick={() => {
                setLoadedProjectId(null);
                setLoadError(null);
                setReloadSeq((v) => v + 1);
              }}
              className="mt-3 rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-800"
            >
              Retry
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-6 rounded-xl border border-[#DDE3EE] bg-white px-4 py-3 text-sm text-[#5F6B82]">Loading...</div>
        ) : null}

        {agentsError ? (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {agentsError}
          </div>
        ) : null}

        {agentFormError ? (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {agentFormError}
          </div>
        ) : null}

        {!agentDraft && !isLoading && !formattedLoadError ? (
          <div className="mt-6 rounded-xl border border-[#DDE3EE] bg-white px-4 py-3 text-sm text-[#5F6B82]">
            Agent editor is not ready.
          </div>
        ) : null}

        {agentDraft ? (
          <section className="mt-6 space-y-4 rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
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
                      <label className="text-sm font-medium">
                        metadata.description <span className="text-zinc-400">(optional)</span>
                      </label>
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

              <CollapsibleSection title="Prompts" expanded={agentEditorExpanded.prompts} onToggle={() => toggleAgentSection("prompts")}>
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
                              placeholder="e.g. summarize"
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
                              maxLines={8}
                              minHeightClass="min-h-24"
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
                  Defaults when omitted: <span className="font-mono">fs.enabled=true</span>,{" "}
                  <span className="font-mono">mcp.enabled=false</span>, <span className="font-mono">mcp.allowedServers=[]</span>.
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
          </section>
        ) : null}
      </div>

      {renderAgentMarkdownModal()}
    </main>
  );
}
