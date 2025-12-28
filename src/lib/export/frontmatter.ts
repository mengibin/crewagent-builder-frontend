import YAML from "yaml";

const FRONTMATTER_REGEX = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const FRONTMATTER_OPEN_REGEX = /^\uFEFF?---\s*(?:\r?\n|$)/;
const FRONTMATTER_LEADING_WS_REGEX = /^\uFEFF?\s+---\s*(?:\r?\n|$)/;

export type FrontmatterExtractResult = {
  yaml: string | null;
  error: string | null;
};

export function extractYamlFrontmatter(markdown: string): FrontmatterExtractResult {
  const raw = markdown ?? "";
  if (!raw.trim()) return { yaml: null, error: null };

  if (FRONTMATTER_LEADING_WS_REGEX.test(raw)) {
    return { yaml: null, error: "frontmatter 必须位于文件开头（请移除前置空行/空格）" };
  }

  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) {
    if (FRONTMATTER_OPEN_REGEX.test(raw)) {
      return { yaml: null, error: "frontmatter 未闭合（缺少结束 `---`）" };
    }
    return { yaml: null, error: null };
  }

  return { yaml: match[1] ?? "", error: null };
}

export type FrontmatterParseResult = {
  data: Record<string, unknown> | null;
  error: string | null;
};

export function parseYamlToObject(yamlText: string): FrontmatterParseResult {
  const trimmed = yamlText?.trim() ?? "";
  if (!trimmed) return { data: {}, error: null };

  try {
    const parsed = YAML.parse(trimmed) as unknown;
    if (!parsed) return { data: {}, error: null };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: null, error: "frontmatter 必须是 YAML object（key/value map）" };
    }
    return { data: parsed as Record<string, unknown>, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "YAML 解析失败";
    return { data: null, error: `frontmatter YAML 解析失败：${message}` };
  }
}

export type MarkdownFrontmatterResult = {
  data: Record<string, unknown> | null;
  error: string | null;
};

export function parseMarkdownFrontmatter(markdown: string): MarkdownFrontmatterResult {
  const extract = extractYamlFrontmatter(markdown);
  if (extract.error) return { data: null, error: extract.error };
  if (extract.yaml === null) return { data: null, error: "缺少 frontmatter（文件必须以 `---` 开头）" };
  return parseYamlToObject(extract.yaml);
}
