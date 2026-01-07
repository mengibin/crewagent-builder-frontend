import test = require("node:test");
import assert = require("node:assert/strict");

import { normalizeMarkdownListToStringArray, previewMarkdown, stringArrayToMarkdownList } from "../src/lib/markdown";

test("normalizeMarkdownListToStringArray: normalizes bullets/newlines and de-duplicates", () => {
  const input = `
  - first
  * second
  1. third
  2) fourth
  fifth
  - first
  `;

  assert.deepEqual(normalizeMarkdownListToStringArray(input), ["first", "second", "third", "fourth", "fifth"]);
});

test("stringArrayToMarkdownList: renders non-empty items as bullets", () => {
  assert.equal(stringArrayToMarkdownList([" a ", "", "b"]), "- a\n- b");
});

test("previewMarkdown: truncates to max lines with ellipsis", () => {
  assert.equal(previewMarkdown("a\nb\nc", 2), "a\nb\n…");
});

