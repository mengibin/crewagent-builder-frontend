import test = require("node:test");
import assert = require("node:assert/strict");

import { buildAgentsManifestV11, validateAgentsManifestV11 } from "../src/lib/agents-manifest-v11";

test("buildAgentsManifestV11: errors when no agents configured (empty string)", () => {
  const res = buildAgentsManifestV11({ agentsJsonRaw: "" });
  assert.equal(res.manifest, null);
  assert.ok(res.errors.length > 0);
});

test("buildAgentsManifestV11: errors when no agents configured (legacy empty array)", () => {
  const res = buildAgentsManifestV11({ agentsJsonRaw: "[]" });
  assert.equal(res.manifest, null);
  assert.ok(res.errors.length > 0);
});

test("buildAgentsManifestV11: adds default tool policy when tools missing (v1.1 manifest)", () => {
  const raw = JSON.stringify({
    schemaVersion: "1.1",
    agents: [
      {
        id: "dev",
        metadata: { name: "Dev", title: "Developer", icon: "🧩" },
        persona: {
          role: "Developer",
          identity: "I write code",
          communication_style: "direct",
          principles: ["Ship", "Test"],
        },
      },
    ],
  });

  const res = buildAgentsManifestV11({ agentsJsonRaw: raw });
  assert.equal(res.errors.length, 0);
  assert.ok(res.manifest);
  assert.equal(res.manifest.schemaVersion, "1.1");
  assert.equal(res.manifest.agents.length, 1);
  assert.deepEqual(res.manifest.agents[0]?.tools, {
    fs: { enabled: true },
    mcp: { enabled: false, allowedServers: [] },
  });
});

test("buildAgentsManifestV11: errors on invalid agentId (v1.1 manifest)", () => {
  const raw = JSON.stringify({
    schemaVersion: "1.1",
    agents: [
      {
        id: "bad id",
        metadata: { name: "Bad", title: "Bad", icon: "🧩" },
        persona: {
          role: "Bad",
          identity: "Bad",
          communication_style: "direct",
          principles: ["TBD"],
        },
      },
    ],
  });

  const res = buildAgentsManifestV11({ agentsJsonRaw: raw });
  assert.equal(res.manifest, null);
  assert.ok(res.errors.some((e) => e.includes("不合法")));
});

test("buildAgentsManifestV11: errors on duplicate agentId (v1.1 manifest)", () => {
  const raw = JSON.stringify({
    schemaVersion: "1.1",
    agents: [
      {
        id: "dev",
        metadata: { name: "Dev", title: "Developer", icon: "🧩" },
        persona: {
          role: "Developer",
          identity: "I write code",
          communication_style: "direct",
          principles: ["Ship"],
        },
      },
      {
        id: "dev",
        metadata: { name: "Dev2", title: "Developer2", icon: "🧩" },
        persona: {
          role: "Developer",
          identity: "I write code",
          communication_style: "direct",
          principles: ["Test"],
        },
      },
    ],
  });

  const res = buildAgentsManifestV11({ agentsJsonRaw: raw });
  assert.equal(res.manifest, null);
  assert.ok(res.errors.some((e) => e.includes("重复")));
});

test("buildAgentsManifestV11: legacy array produces v1.1 manifest", () => {
  const legacy = JSON.stringify([{ name: "Analyst", role: "Analyst" }]);
  const res = buildAgentsManifestV11({ agentsJsonRaw: legacy });
  assert.equal(res.errors.length, 0);
  assert.ok(res.manifest);
  assert.equal(res.manifest.schemaVersion, "1.1");
  assert.equal(res.manifest.agents.length, 1);
  assert.equal(res.manifest.agents[0]?.metadata?.name, "Analyst");
  assert.deepEqual(res.manifest.agents[0]?.tools, {
    fs: { enabled: true },
    mcp: { enabled: false, allowedServers: [] },
  });
});

test("buildAgentsManifestV11: filters invalid menu items and warns", () => {
  const raw = JSON.stringify({
    schemaVersion: "1.1",
    agents: [
      {
        id: "dev",
        metadata: { name: "Dev", title: "Developer", icon: "🧩" },
        persona: {
          role: "Developer",
          identity: "I write code",
          communication_style: "direct",
          principles: ["Ship"],
        },
        menu: [{ description: "OK" }, {}, { description: "" }],
      },
    ],
  });

  const res = buildAgentsManifestV11({ agentsJsonRaw: raw });
  assert.ok(res.manifest);
  assert.equal(res.errors.length, 0);
  assert.ok(res.warnings.length > 0);
  assert.deepEqual(res.manifest.agents[0]?.menu, [{ description: "OK" }]);
});

test("validateAgentsManifestV11: generated manifest validates against schema", () => {
  const legacy = JSON.stringify([{ name: "Analyst", role: "Analyst" }]);
  const res = buildAgentsManifestV11({ agentsJsonRaw: legacy });
  assert.ok(res.manifest);
  const validation = validateAgentsManifestV11(res.manifest);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test("validateAgentsManifestV11: reports schema errors with paths", () => {
  const validation = validateAgentsManifestV11({ schemaVersion: "1.1", agents: [] });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length > 0);
});
