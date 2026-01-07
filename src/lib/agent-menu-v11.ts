export type MenuItemDraft = {
  trigger: string;
  description: string;
  exec: string;
  extra: Record<string, unknown>;
};

export function splitMenuItemForDraft(item: unknown): MenuItemDraft {
  const obj = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
  const trigger = typeof obj.trigger === "string" ? obj.trigger : "";
  const description = typeof obj.description === "string" ? obj.description : "";
  const exec = typeof obj.exec === "string" ? obj.exec : "";
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "trigger" || k === "description" || k === "exec") continue;
    extra[k] = v;
  }
  return { trigger, description, exec, extra };
}

export function mergeMenuItemFromDraft(draft: MenuItemDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(draft.extra ?? {}) };
  const trigger = draft.trigger.trim();
  const exec = draft.exec.trim();

  if (trigger) out.trigger = trigger;
  out.description = draft.description;
  if (exec) out.exec = exec;

  return out;
}

