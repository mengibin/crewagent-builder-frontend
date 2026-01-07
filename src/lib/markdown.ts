export function previewMarkdown(markdown: string, maxLines: number): string {
  const trimmed = (markdown ?? "").trimEnd();
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  const sliced = lines.slice(0, maxLines);
  const suffix = lines.length > maxLines ? "\n…" : "";
  return `${sliced.join("\n")}${suffix}`;
}

export function normalizeMarkdownListToStringArray(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const raw = input ?? "";
  for (const line of raw.split("\n")) {
    let value = line.trim();
    if (!value) continue;
    value = value.replace(/^[-*+]\s+/, "");
    value = value.replace(/^\d+[.)]\s+/, "");
    value = value.trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

export function stringArrayToMarkdownList(items: string[]): string {
  const cleaned = Array.isArray(items) ? items.map((v) => v.trim()).filter(Boolean) : [];
  return cleaned.map((v) => `- ${v}`).join("\n");
}

