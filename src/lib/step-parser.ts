/**
 * Step file parser for BMAD Package Spec v1.1
 * Parses step markdown files with YAML frontmatter and sections
 */

import YAML from "yaml";

export interface StepFrontmatter {
  schemaVersion: string;
  nodeId: string;
  type: "step" | "decision" | "merge" | "end" | "subworkflow";
  title?: string;
  agentId?: string;
  inputs?: string[];
  outputs?: string[];
  setsVariables?: string[];
  transitions?: Array<{
    to: string;
    label: string;
    isDefault?: boolean;
    conditionText?: string;
  }>;
}

export interface StepSections {
  goal: string;
  instructions: string;
  completion?: string;
}

export interface StepData {
  frontmatter: StepFrontmatter;
  sections: StepSections;
  rawContent: string;
}

export interface ParseResult {
  success: boolean;
  data?: StepData;
  error?: string;
}

const FRONTMATTER_REGEX = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const FRONTMATTER_OPEN_REGEX = /^\uFEFF?---\s*(?:\r?\n|$)/;
const FRONTMATTER_LEADING_WS_REGEX = /^\uFEFF?\s+---\s*(?:\r?\n|$)/;

/**
 * Parse a step markdown file into structured data
 */
export function parseStepMarkdown(content: string): ParseResult {
  const raw = content ?? "";
  if (!raw.trim()) {
    return { success: false, error: "Step content is empty." };
  }

  if (FRONTMATTER_LEADING_WS_REGEX.test(raw)) {
    return { success: false, error: "Frontmatter must be at the beginning of the file (remove leading blank lines/spaces)." };
  }

  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) {
    if (FRONTMATTER_OPEN_REGEX.test(raw)) {
      return { success: false, error: "Frontmatter is not closed (missing ending `---`)." };
    }
    return { success: false, error: "Missing YAML frontmatter." };
  }

  const yamlText = match[1] ?? "";
  const body = raw.slice(match[0].length);

  let parsedFrontmatter: unknown;
  try {
    parsedFrontmatter = YAML.parse(yamlText.trim() || "") as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse YAML";
    return { success: false, error: `Failed to parse frontmatter YAML: ${message}` };
  }

  if (!parsedFrontmatter) {
    return { success: false, error: "Frontmatter cannot be empty." };
  }

  if (typeof parsedFrontmatter !== "object" || Array.isArray(parsedFrontmatter)) {
    return { success: false, error: "Frontmatter must be a YAML object (key/value map)." };
  }

  const frontmatter = parsedFrontmatter as StepFrontmatter;
  const sections = parseSections(body);

  return {
    success: true,
    data: {
      frontmatter,
      sections,
      rawContent: raw,
    },
  };
}

/**
 * Parse markdown body into sections
 */
function parseSections(body: string): StepSections {
  const sections: StepSections = { goal: "", instructions: "" };

  const lines = (body ?? "").split("\n");
  let currentSection: "goal" | "instructions" | "completion" | null = null;
  const sectionContent: string[] = [];

  const saveCurrentSection = (): void => {
    if (!currentSection) return;
    const content = sectionContent.join("\n").trim();
    if (currentSection === "goal") sections.goal = content;
    else if (currentSection === "instructions") sections.instructions = content;
    else if (currentSection === "completion") sections.completion = content;
    sectionContent.length = 0;
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(Goal|Instructions|Completion)(?:\s+\(.*\))?/i);
    if (match) {
      saveCurrentSection();
      currentSection = match[1].toLowerCase() as "goal" | "instructions" | "completion";
      continue;
    }

    if (currentSection) sectionContent.push(line);
  }

  saveCurrentSection();
  return sections;
}

/**
 * Serialize step data back to markdown
 */
export function serializeStepMarkdown(data: StepData): string {
  const fm = YAML.stringify(data.frontmatter ?? {}).trimEnd();

  const parts: string[] = [];
  const title = data.frontmatter.title || "Step";

  parts.push(`# ${title}`, "");
  parts.push("## Goal", "", data.sections.goal || "", "");
  parts.push("## Instructions", "", data.sections.instructions || "", "");

  if (data.sections.completion) {
    parts.push("## Completion", "", data.sections.completion, "");
  }

  return `---\n${fm}\n---\n\n${parts.join("\n")}`;
}

/**
 * Validate frontmatter has required fields
 */
export function validateFrontmatter(fm: StepFrontmatter): string[] {
  const errors: string[] = [];

  if (!fm.schemaVersion) {
    errors.push("Missing schemaVersion.");
  } else if (!/^1\.1(\.\d+)?$/.test(String(fm.schemaVersion))) {
    errors.push(`Invalid schemaVersion format: ${String(fm.schemaVersion)}`);
  }

  if (!fm.nodeId) {
    errors.push("Missing nodeId.");
  }

  if (!fm.type) {
    errors.push("Missing type.");
  } else {
    const validTypes = ["step", "decision", "merge", "end", "subworkflow"];
    if (!validTypes.includes(fm.type)) {
      errors.push(`Invalid type value: ${fm.type}`);
    }
  }

  return errors;
}

/**
 * Validate sections have required content
 */
export function validateSections(sections: StepSections): string[] {
  const errors: string[] = [];

  if (!sections.goal || sections.goal.trim() === "") {
    errors.push("Missing Goal section.");
  }

  if (!sections.instructions || sections.instructions.trim() === "") {
    errors.push("Missing Instructions section.");
  }

  return errors;
}
