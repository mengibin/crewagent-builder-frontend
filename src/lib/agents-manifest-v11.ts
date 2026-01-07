import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";

import agentsSchemaV11 from "./bmad-spec/v1.1/agents.schema.json";
import { isValidAgentId, uniqueAgentId } from "./utils";

export type ToolPolicyV11 = {
  fs?: { enabled?: boolean; maxReadBytes?: number; maxWriteBytes?: number };
  mcp?: { enabled?: boolean; allowedServers?: string[] };
};

export type AgentMetadataV11 = {
  name: string;
  title: string;
  icon: string;
  module?: string;
  description?: string;
  sourceId?: string;
};

export type AgentPersonaV11 = {
  role: string;
  identity: string;
  communication_style: string;
  principles: string[] | string;
};

export type PromptV11 = { id: string; content: string; description?: string };

export type AgentV11 = {
  id: string;
  metadata: AgentMetadataV11;
  persona: AgentPersonaV11;
  critical_actions?: string[];
  prompts?: PromptV11[];
  menu?: unknown[];
  systemPrompt?: string;
  userPromptTemplate?: string;
  discussion?: boolean;
  webskip?: boolean;
  conversational_knowledge?: unknown[];
  tools?: ToolPolicyV11;
};

export type AgentsManifestV11 = {
  schemaVersion: "1.1";
  agents: AgentV11[];
};

export type AgentsManifestBuildResult = {
  manifest: AgentsManifestV11 | null;
  warnings: string[];
  errors: string[];
};

export type AgentsManifestValidationResult = {
  ok: boolean;
  errors: string[];
};

const DEFAULT_TOOLS: Required<ToolPolicyV11> = {
  fs: { enabled: true },
  mcp: { enabled: false, allowedServers: [] },
};

type AjvValidateFn = ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };

let validateAgentsSchemaV11: AjvValidateFn | null = null;

function getAgentsSchemaValidatorV11(): AjvValidateFn {
  if (validateAgentsSchemaV11) return validateAgentsSchemaV11;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validateAgentsSchemaV11 = ajv.compile(agentsSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateAgentsSchemaV11;
}

export function formatAgentsManifestV11(manifest: AgentsManifestV11): string {
  return JSON.stringify(manifest, null, 2);
}

function formatAjvErrorList(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return [];
  return errors.map((err) => {
    const path = err.instancePath || err.schemaPath || "value";
    return `${path}: ${err.message ?? "invalid"}`;
  });
}

export function validateAgentsManifestV11(value: unknown): AgentsManifestValidationResult {
  const validate = getAgentsSchemaValidatorV11();
  const ok = Boolean(validate(value));
  return {
    ok,
    errors: ok ? [] : formatAjvErrorList(validate.errors),
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v): v is string => Boolean(v));
  return cleaned.length ? cleaned : [];
}

function normalizeTools(raw: unknown): Required<ToolPolicyV11> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_TOOLS };
  }

  const toolsObj = raw as Record<string, unknown>;
  const fsRaw = toolsObj.fs;
  const fsObj = fsRaw && typeof fsRaw === "object" && !Array.isArray(fsRaw) ? (fsRaw as Record<string, unknown>) : null;
  const mcpRaw = toolsObj.mcp;
  const mcpObj =
    mcpRaw && typeof mcpRaw === "object" && !Array.isArray(mcpRaw) ? (mcpRaw as Record<string, unknown>) : null;

  const fsEnabled = typeof fsObj?.enabled === "boolean" ? fsObj.enabled : true;
  const maxReadBytes =
    typeof fsObj?.maxReadBytes === "number" && fsObj.maxReadBytes >= 1 ? fsObj.maxReadBytes : undefined;
  const maxWriteBytes =
    typeof fsObj?.maxWriteBytes === "number" && fsObj.maxWriteBytes >= 1 ? fsObj.maxWriteBytes : undefined;

  const mcpEnabled = typeof mcpObj?.enabled === "boolean" ? mcpObj.enabled : false;
  const allowedServers = Array.isArray(mcpObj?.allowedServers)
    ? (mcpObj.allowedServers as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
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

export function buildAgentsManifestV11(params: { agentsJsonRaw: string }): AgentsManifestBuildResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const trimmed = params.agentsJsonRaw?.trim() ?? "";
  if (!trimmed) {
    return { manifest: null, warnings, errors: ["Please create at least 1 agent first."] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { manifest: null, warnings, errors: ["Invalid agentsJson: unable to parse JSON."] };
  }

  const agents: AgentV11[] = [];
  const seen = new Set<string>();

  if (Array.isArray(parsed)) {
    // Detect if this is v1.1 format (has id + metadata) or legacy format (has name)
    const isV11Array = parsed.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.id === "string" && obj.metadata && typeof obj.metadata === "object";
    });

    if (isV11Array) {
      // Treat as v1.1 agents array (like manifest.agents but without wrapper)
      parsed.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return;
        const agent = item as Record<string, unknown>;
        const id = normalizeString(agent.id);
        if (!id || !isValidAgentId(id) || seen.has(id)) return;

        const metadataRaw = agent.metadata;
        const metadataObj =
          metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
            ? (metadataRaw as Record<string, unknown>)
            : {};

        const name = normalizeString(metadataObj.name) || normalizeString(metadataObj.title) || id;
        const title = normalizeString(metadataObj.title) || normalizeString(metadataObj.name) || name;
        const icon = normalizeString(metadataObj.icon) || "🧩";

        const personaRaw = agent.persona;
        const personaObj =
          personaRaw && typeof personaRaw === "object" && !Array.isArray(personaRaw)
            ? (personaRaw as Record<string, unknown>)
            : {};

        const role = normalizeString(personaObj.role) || "Agent";
        const identity = normalizeString(personaObj.identity) || role || "TBD";
        const communication_style = normalizeString(personaObj.communication_style) || "direct";
        const principlesRaw = personaObj.principles;
        const principles = Array.isArray(principlesRaw)
          ? normalizeStringArray(principlesRaw)
          : typeof principlesRaw === "string"
            ? principlesRaw.split("\n").map((p) => p.trim()).filter((p) => p.length > 0)
            : ["TBD"];

        seen.add(id);
        agents.push({
          id,
          metadata: {
            name,
            title,
            icon,
            ...(normalizeString(metadataObj.module) ? { module: normalizeString(metadataObj.module) } : {}),
            ...(normalizeString(metadataObj.description) ? { description: normalizeString(metadataObj.description) } : {}),
          },
          persona: { role, identity, communication_style, principles: principles.length ? principles : ["TBD"] },
          tools: normalizeTools(agent.tools),
          ...(Array.isArray(agent.critical_actions) ? { critical_actions: normalizeStringArray(agent.critical_actions) } : {}),
          ...(typeof agent.systemPrompt === "string" ? { systemPrompt: agent.systemPrompt } : {}),
        });
      });
    } else {
      // Legacy format: array of { name, role }
      parsed.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return;
        const obj = item as Record<string, unknown>;
        const name = normalizeString(obj.name);
        if (!name) return;
        const role = normalizeString(obj.role);

        const id = uniqueAgentId(name, seen);
        seen.add(id);

        agents.push({
          id,
          metadata: { name, title: name, icon: "🧩" },
          persona: {
            role: role || "Agent",
            identity: role || "TBD",
            communication_style: "direct",
            principles: ["TBD"],
          },
          tools: { ...DEFAULT_TOOLS },
        });
      });
    }
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const rawSchemaVersion = normalizeString(obj.schemaVersion);
    if (rawSchemaVersion && !/^1\.1(\.\d+)?$/.test(rawSchemaVersion)) {
      warnings.push(`Invalid schemaVersion (fell back to "1.1"): ${rawSchemaVersion}`);
    } else if (rawSchemaVersion && rawSchemaVersion !== "1.1") {
      warnings.push(`schemaVersion != "1.1" (normalized output to "1.1"): ${rawSchemaVersion}`);
    }

    const rawAgents = Array.isArray(obj.agents) ? obj.agents : [];
    rawAgents.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`agents[${index}] is not a valid object`);
        return;
      }
      const agent = item as Record<string, unknown>;
      const id = normalizeString(agent.id);
      if (!id) {
        errors.push(`agents[${index}].id cannot be empty`);
        return;
      }
      if (!isValidAgentId(id)) {
        errors.push(`agents[${index}].id is invalid: ${id}`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`Duplicate agentId: ${id}`);
        return;
      }

      const metadataRaw = agent.metadata;
      const metadataObj =
        metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
          ? (metadataRaw as Record<string, unknown>)
          : {};

      const name = normalizeString(metadataObj.name) || normalizeString(metadataObj.title) || id;
      const title = normalizeString(metadataObj.title) || normalizeString(metadataObj.name) || name;
      const icon = normalizeString(metadataObj.icon) || "🧩";

      if (!name) {
        errors.push(`agents[${index}].metadata.name cannot be empty`);
        return;
      }
      if (!title) {
        errors.push(`agents[${index}].metadata.title cannot be empty`);
        return;
      }

      const personaRaw = agent.persona;
      const personaObj =
        personaRaw && typeof personaRaw === "object" && !Array.isArray(personaRaw) ? (personaRaw as Record<string, unknown>) : {};

      const role = normalizeString(personaObj.role) || "Agent";
      const identity = normalizeString(personaObj.identity) || role || "TBD";
      const communication_style = normalizeString(personaObj.communication_style) || "direct";

      const principlesRaw = personaObj.principles;
      const principles = (() => {
        if (Array.isArray(principlesRaw)) return normalizeStringArray(principlesRaw);
        if (typeof principlesRaw === "string") {
          const lines = principlesRaw
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          return lines;
        }
        return [];
      })();

      const critical_actions = Array.isArray(agent.critical_actions) ? normalizeStringArray(agent.critical_actions) : [];
      const prompts = Array.isArray(agent.prompts)
        ? agent.prompts.flatMap((p) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) return [];
          const obj = p as Record<string, unknown>;
          const pid = normalizeString(obj.id);
          const content = normalizeString(obj.content);
          if (!pid || !content) return [];
          const description = normalizeString(obj.description);
          return [{ id: pid, content, ...(description ? { description } : {}) }];
        })
        : [];

      const menu = Array.isArray(agent.menu)
        ? agent.menu.filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const description = normalizeString((item as Record<string, unknown>).description);
          return Boolean(description);
        })
        : [];
      if (Array.isArray(agent.menu) && menu.length !== agent.menu.length) {
        warnings.push(`Filtered invalid menu items: agentId=${id}`);
      }

      const conversational_knowledge = Array.isArray(agent.conversational_knowledge)
        ? agent.conversational_knowledge.filter((item) => item && typeof item === "object" && !Array.isArray(item))
        : [];
      if (
        Array.isArray(agent.conversational_knowledge) &&
        conversational_knowledge.length !== agent.conversational_knowledge.length
      ) {
        warnings.push(`Filtered invalid conversational_knowledge items: agentId=${id}`);
      }

      const normalizedAgent: AgentV11 = {
        id,
        metadata: {
          name,
          title,
          icon,
          ...(normalizeString(metadataObj.module) ? { module: normalizeString(metadataObj.module) } : {}),
          ...(normalizeString(metadataObj.description) ? { description: normalizeString(metadataObj.description) } : {}),
          ...(normalizeString(metadataObj.sourceId) ? { sourceId: normalizeString(metadataObj.sourceId) } : {}),
        },
        persona: {
          role,
          identity,
          communication_style,
          principles: principles.length ? principles : ["TBD"],
        },
        tools: normalizeTools(agent.tools),
        ...(critical_actions.length ? { critical_actions } : {}),
        ...(prompts.length ? { prompts } : {}),
        ...(menu.length ? { menu } : {}),
        ...(typeof agent.systemPrompt === "string" ? { systemPrompt: agent.systemPrompt } : {}),
        ...(typeof agent.userPromptTemplate === "string" ? { userPromptTemplate: agent.userPromptTemplate } : {}),
        ...(typeof agent.discussion === "boolean" ? { discussion: agent.discussion } : {}),
        ...(typeof agent.webskip === "boolean" ? { webskip: agent.webskip } : {}),
        ...(conversational_knowledge.length ? { conversational_knowledge } : {}),
      };

      seen.add(id);
      agents.push(normalizedAgent);
    });
  } else {
    errors.push("Invalid agentsJson structure: expected an object or an array.");
  }

  if (!agents.length) {
    errors.push("Please create at least 1 agent first.");
  }

  if (errors.length) return { manifest: null, warnings, errors };

  const manifest: AgentsManifestV11 = { schemaVersion: "1.1", agents };
  const validation = validateAgentsManifestV11(manifest);
  if (!validation.ok) {
    return { manifest: null, warnings, errors: validation.errors };
  }
  return { manifest, warnings, errors };
}
