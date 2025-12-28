import type { ErrorObject } from "ajv";

import {
  getAgentsSchemaValidatorV11,
  getBmadSchemaValidatorV11,
  getStepFrontmatterSchemaValidatorV11,
  getWorkflowFrontmatterSchemaValidatorV11,
  getWorkflowGraphSchemaValidatorV11,
} from "./ajv-validators-v11";
import { parseMarkdownFrontmatter } from "./frontmatter";

export type ExportValidationIssue = {
  severity: "error" | "warning";
  filePath: string;
  kind: "schema" | "frontmatter";
  message: string;
  instancePath?: string;
  schemaPath?: string;
  hint?: string;
};

export type ExportValidationResult = {
  ok: boolean;
  issues: ExportValidationIssue[];
};

function buildHint(err: ErrorObject): string | null {
  if (!err) return null;
  if (err.keyword === "additionalProperties") {
    const param = (err.params as { additionalProperty?: unknown } | undefined)?.additionalProperty;
    if (typeof param === "string" && param.trim()) return `存在未允许字段：${param}`;
  }
  if (err.keyword === "required") {
    const param = (err.params as { missingProperty?: unknown } | undefined)?.missingProperty;
    if (typeof param === "string" && param.trim()) return `缺少必填字段：${param}`;
  }
  if (err.keyword === "minItems") {
    const limit = (err.params as { limit?: unknown } | undefined)?.limit;
    if (typeof limit === "number") return `数量不足（minItems=${limit}）`;
  }
  if (err.keyword === "minLength") {
    const limit = (err.params as { limit?: unknown } | undefined)?.limit;
    if (typeof limit === "number") return `长度不足（minLength=${limit}）`;
  }
  if (err.keyword === "maxLength") {
    const limit = (err.params as { limit?: unknown } | undefined)?.limit;
    if (typeof limit === "number") return `长度超限（maxLength=${limit}）`;
  }
  if (err.keyword === "minimum") {
    const limit = (err.params as { limit?: unknown } | undefined)?.limit;
    if (typeof limit === "number") return `值过小（minimum=${limit}）`;
  }
  if (err.keyword === "maximum") {
    const limit = (err.params as { limit?: unknown } | undefined)?.limit;
    if (typeof limit === "number") return `值过大（maximum=${limit}）`;
  }
  if (err.keyword === "type") {
    const t = (err.params as { type?: unknown } | undefined)?.type;
    if (typeof t === "string" && t.trim()) return `类型不匹配（期望 ${t}）`;
  }
  if (err.keyword === "format") {
    const format = (err.params as { format?: unknown } | undefined)?.format;
    if (typeof format === "string" && format.trim()) return `格式不合法（format=${format}）`;
  }
  if (err.keyword === "enum") {
    const allowed = (err.params as { allowedValues?: unknown } | undefined)?.allowedValues;
    if (Array.isArray(allowed) && allowed.length) {
      const sample = allowed
        .slice(0, 6)
        .map((v) => {
          try {
            return JSON.stringify(v);
          } catch {
            return String(v);
          }
        })
        .join(", ");
      const suffix = allowed.length > 6 ? ` ... (+${allowed.length - 6})` : "";
      return `允许值：${sample}${suffix}`;
    }
    return "值不在允许范围内";
  }
  if (err.keyword === "pattern") {
    return "格式不合法（pattern 不匹配）";
  }
  return null;
}

function pushAjvErrors(params: {
  filePath: string;
  kind: "schema" | "frontmatter";
  errors: ErrorObject[] | null | undefined;
  issues: ExportValidationIssue[];
}): void {
  const list = params.errors ?? [];
  list.forEach((err) => {
    const hint = buildHint(err);
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: params.kind,
      instancePath: err.instancePath ?? "",
      schemaPath: err.schemaPath ?? "",
      message: err.message ?? "invalid",
      ...(hint ? { hint } : {}),
    });
  });
}

function parseJsonObject(params: { filePath: string; value: unknown; issues: ExportValidationIssue[] }): Record<string, unknown> | null {
  const raw = params.value;
  if (typeof raw !== "string") {
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: "schema",
      message: "缺少文件或内容不是文本，无法校验 JSON schema",
    });
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: "schema",
      message: "文件为空，无法校验 JSON schema",
    });
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      params.issues.push({
        severity: "error",
        filePath: params.filePath,
        kind: "schema",
        message: "JSON 根节点必须是 object",
      });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: "schema",
      message: "非法 JSON：无法解析",
    });
    return null;
  }
}

function ensureText(params: { filePath: string; value: unknown; issues: ExportValidationIssue[] }): string | null {
  const raw = params.value;
  if (typeof raw !== "string") {
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: "frontmatter",
      message: "缺少文件或内容不是文本，无法解析 frontmatter",
    });
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    params.issues.push({
      severity: "error",
      filePath: params.filePath,
      kind: "frontmatter",
      message: "文件为空，无法解析 frontmatter",
    });
    return null;
  }
  return raw;
}

function collectWorkflowIdsFromBmad(bmad: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const raw = bmad.workflows;
  if (Array.isArray(raw)) {
    raw.forEach((wf) => {
      if (!wf || typeof wf !== "object" || Array.isArray(wf)) return;
      const id = typeof (wf as Record<string, unknown>).id === "string" ? ((wf as Record<string, unknown>).id as string).trim() : "";
      if (id) ids.push(id);
    });
  }
  if (ids.length) return Array.from(new Set(ids));

  const entry = bmad.entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
  const workflow = typeof (entry as Record<string, unknown>).workflow === "string" ? ((entry as Record<string, unknown>).workflow as string) : "";
  const match = /^workflows\/([^/]+)\/workflow\.md$/.exec(workflow.trim());
  if (match?.[1]) return [match[1]];
  return [];
}

export function validateExportBundleV11(params: {
  filesByPath: Record<string, string | Uint8Array>;
}): ExportValidationResult {
  const issues: ExportValidationIssue[] = [];
  const files = params.filesByPath ?? {};

  const bmadObj = parseJsonObject({ filePath: "bmad.json", value: files["bmad.json"], issues });
  if (bmadObj) {
    const validate = getBmadSchemaValidatorV11();
    const ok = Boolean(validate(bmadObj));
    if (!ok) {
      pushAjvErrors({ filePath: "bmad.json", kind: "schema", errors: validate.errors, issues });
    }
  }

  const agentsObj = parseJsonObject({ filePath: "agents.json", value: files["agents.json"], issues });
  if (agentsObj) {
    const validate = getAgentsSchemaValidatorV11();
    const ok = Boolean(validate(agentsObj));
    if (!ok) {
      pushAjvErrors({ filePath: "agents.json", kind: "schema", errors: validate.errors, issues });
    }
  }

  const workflowIds = bmadObj ? collectWorkflowIdsFromBmad(bmadObj) : [];

  const stepFilesByWorkflowId = new Map<string, Array<[string, string | Uint8Array]>>();
  Object.entries(files).forEach(([path, value]) => {
    if (!path.startsWith("workflows/")) return;
    if (!path.endsWith(".md")) return;
    const parts = path.split("/");
    if (parts.length < 4) return;
    if (parts[0] !== "workflows") return;
    if (parts[2] !== "steps") return;
    const workflowId = parts[1]?.trim() ?? "";
    if (!workflowId) return;

    const bucket = stepFilesByWorkflowId.get(workflowId) ?? [];
    bucket.push([path, value]);
    stepFilesByWorkflowId.set(workflowId, bucket);
  });

  workflowIds.forEach((workflowId) => {
    const base = `workflows/${workflowId}`;

    const graphPath = `${base}/workflow.graph.json`;
    const graphObj = parseJsonObject({ filePath: graphPath, value: files[graphPath], issues });
    if (graphObj) {
      const validate = getWorkflowGraphSchemaValidatorV11();
      const ok = Boolean(validate(graphObj));
      if (!ok) {
        pushAjvErrors({ filePath: graphPath, kind: "schema", errors: validate.errors, issues });
      }
    }

    const workflowMdPath = `${base}/workflow.md`;
    const workflowMd = ensureText({ filePath: workflowMdPath, value: files[workflowMdPath], issues });
    if (workflowMd) {
      const parsed = parseMarkdownFrontmatter(workflowMd);
      if (parsed.error || !parsed.data) {
        issues.push({
          severity: "error",
          filePath: workflowMdPath,
          kind: "frontmatter",
          message: parsed.error ?? "frontmatter 解析失败",
        });
      } else {
        const validate = getWorkflowFrontmatterSchemaValidatorV11();
        const ok = Boolean(validate(parsed.data));
        if (!ok) {
          pushAjvErrors({ filePath: workflowMdPath, kind: "frontmatter", errors: validate.errors, issues });
        }
      }
    }

    const stepEntries = stepFilesByWorkflowId.get(workflowId) ?? [];
    stepEntries.forEach(([path, value]) => {
      const content = ensureText({ filePath: path, value, issues });
      if (!content) return;

      const parsed = parseMarkdownFrontmatter(content);
      if (parsed.error || !parsed.data) {
        issues.push({
          severity: "error",
          filePath: path,
          kind: "frontmatter",
          message: parsed.error ?? "frontmatter 解析失败",
        });
        return;
      }
      const validate = getStepFrontmatterSchemaValidatorV11();
      const ok = Boolean(validate(parsed.data));
      if (!ok) {
        pushAjvErrors({ filePath: path, kind: "frontmatter", errors: validate.errors, issues });
      }
    });
  });

  const ok = issues.every((issue) => issue.severity !== "error");
  return { ok, issues };
}
