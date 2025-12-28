export const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isValidAgentId(input: string): boolean {
  return AGENT_ID_PATTERN.test(input);
}

export function slugifyAgentId(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const cleaned = trimmed
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!cleaned) return "agent";
  const startsOk = /^[a-z0-9]/.test(cleaned);
  return startsOk ? cleaned : `agent-${cleaned}`;
}

export function uniqueAgentId(baseName: string, existingIds: Set<string>): string {
  const base = slugifyAgentId(baseName);
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}-${i}`;
    if (!existingIds.has(next)) return next;
  }
  return `${base}-${Date.now()}`;
}
