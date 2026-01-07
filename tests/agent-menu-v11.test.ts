import test = require("node:test");
import assert = require("node:assert/strict");

import { mergeMenuItemFromDraft, splitMenuItemForDraft } from "../src/lib/agent-menu-v11";

test("menu item draft: preserves unknown keys round-trip", () => {
  const original = {
    trigger: "help",
    description: "Old description",
    exec: "steps/step-01.md",
    workflow: "main",
    "web-only": true,
    data: { extra: 1 },
  };

  const draft = splitMenuItemForDraft(original);
  assert.equal(draft.trigger, "help");
  assert.equal(draft.description, "Old description");
  assert.equal(draft.exec, "steps/step-01.md");
  assert.deepEqual(draft.extra, { workflow: "main", "web-only": true, data: { extra: 1 } });

  const merged = mergeMenuItemFromDraft({
    ...draft,
    trigger: "start",
    exec: "",
    description: "New description",
  });

  assert.deepEqual(merged, {
    workflow: "main",
    "web-only": true,
    data: { extra: 1 },
    trigger: "start",
    description: "New description",
  });
  assert.equal("exec" in merged, false);
});

