'use client';

import React, { useMemo, useState } from "react";

import { MarkdownEditorModal } from "@/components/MarkdownEditorModal";
import { toRuntimeAssetPath, type AssetListItem } from "@/lib/assets-v11";
import { previewMarkdown } from "@/lib/markdown";
import { parseStepMarkdown, serializeStepMarkdown, type StepData, type StepFrontmatter, type StepSections } from "@/lib/step-parser";

interface Agent {
  id: string;
  name: string;
}

interface StepEditorPanelProps {
  content: string;
  agents: Agent[];
  assets?: { items: AssetListItem[]; error?: string | null; parseError?: string | null };
  artifacts?: { dirs: string[]; saving?: boolean; onAddDirs?: (dirs: string[]) => void };
  onSyncWorkflowVariables?: (keys: string[]) => void;
  onChange: (content: string) => void;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item : String(item)))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function TagInput(props: {
  label: string;
  value: string[];
  placeholder: string;
  hint?: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const tokens = useMemo(() => normalizeStringList(props.value), [props.value]);

  const addDraft = () => {
    const next = draft.trim();
    if (!next) return;
    props.onChange(tokens.includes(next) ? tokens : tokens.concat(next));
    setDraft("");
  };

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium text-zinc-700">{props.label}</label>
        {props.hint ? <span className="text-xs text-zinc-500">{props.hint}</span> : null}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
        {tokens.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {tokens.map((token) => (
              <span
                key={token}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700"
              >
                <span className="break-all">{token}</span>
                <button
                  type="button"
                  onClick={() => props.onChange(tokens.filter((t) => t !== token))}
                  className="rounded-full px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                  aria-label={`remove ${token}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addDraft();
            }
          }}
          onBlur={() => addDraft()}
          placeholder={props.placeholder}
          className="w-full border-0 bg-transparent p-0 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
        />
      </div>
    </div>
  );
}

function Section(props: {
  title: string;
  required?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between gap-4 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100"
      >
        <span className="text-sm font-medium text-zinc-900">
          {props.title}
          {props.required ? <span className="ml-1 text-red-600">*</span> : null}
        </span>
        <span className="text-xs text-zinc-500">{props.expanded ? "Collapse" : "Expand"}</span>
      </button>
      {props.expanded ? <div className="border-t border-zinc-200 p-3">{props.children}</div> : null}
    </div>
  );
}

export function StepEditorPanel(props: StepEditorPanelProps) {
  const { content, agents, onChange } = props;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    agent: false,
    io: false,
    assets: false,
    variables: false,
    goal: true,
    instructions: true,
    completion: false,
  });
  const [activeSection, setActiveSection] = useState<keyof StepSections | null>(null);
  const [assetInsertPath, setAssetInsertPath] = useState<string>("");

  const parseResult = useMemo(() => parseStepMarkdown(content), [content]);
  const stepData = parseResult.success ? parseResult.data ?? null : null;
  const parseError = parseResult.success ? null : parseResult.error || "Unable to parse Step file format";

  const updateAndSerialize = (newData: StepData) => {
    onChange(serializeStepMarkdown(newData));
  };

  const appendLine = (base: string, line: string): string => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return base ?? "";
    const current = base ?? "";
    if (!current.trim()) return trimmedLine;
    if (current.endsWith("\n")) return `${current}${trimmedLine}`;
    return `${current}\n${trimmedLine}`;
  };

  const copyTextSilent = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const handleFrontmatterChange = (field: keyof StepFrontmatter, value: unknown) => {
    if (!stepData) return;
    updateAndSerialize({
      ...stepData,
      frontmatter: { ...stepData.frontmatter, [field]: value },
    });
  };

  const handleSectionChange = (section: keyof StepSections, value: string) => {
    if (!stepData) return;
    updateAndSerialize({
      ...stepData,
      sections: { ...stepData.sections, [section]: value },
    });
  };

  const toggleSection = (section: string) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  if (parseError || !stepData) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Unable to parse Step file</p>
          <p className="mt-1 text-amber-800">{parseError || "Unknown error"}</p>
          <p className="mt-1 text-amber-800">Falling back to raw Markdown editor (auto-saved).</p>
        </div>
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Step content..."
          className="mt-3 min-h-64 w-full resize-y rounded-xl border border-zinc-200 px-3 py-2 font-mono text-xs leading-6 outline-none focus:border-zinc-400"
        />
      </div>
    );
  }

  const modalTitle =
    activeSection === "goal"
      ? "Edit: Goal"
      : activeSection === "instructions"
        ? "Edit: Instructions"
        : activeSection === "completion"
          ? "Edit: Completion"
          : "";

  const modalPlaceholder =
    activeSection === "goal"
      ? "Use Markdown to describe the goal..."
      : activeSection === "instructions"
        ? "Use Markdown to write instructions for the agent..."
        : activeSection === "completion"
          ? "(Optional) Use Markdown to describe completion/state update rules..."
          : "";

  const outputs = normalizeStringList(stepData.frontmatter.outputs ?? []);
  const outputsShouldStartWithArtifacts = outputs.some((p) => !p.startsWith("artifacts/"));

  const projectArtifactDirs = props.artifacts?.dirs ?? [];
  const projectArtifactSet = new Set(projectArtifactDirs);
  const missingArtifactDirs = !outputs.length
    ? []
    : Array.from(
        new Set(
          outputs
            .filter((p) => p.startsWith("artifacts/"))
            .map((p) => p.split("/").slice(0, -1).join("/"))
            .filter((dir) => Boolean(dir) && dir !== "artifacts" && !projectArtifactSet.has(dir)),
        ),
      );

  return (
    <div className="space-y-4">
      {activeSection ? (
        <MarkdownEditorModal
          title={modalTitle}
          value={String(stepData.sections[activeSection] ?? "")}
          placeholder={modalPlaceholder}
          onChange={(next) => handleSectionChange(activeSection, next)}
          onClose={() => setActiveSection(null)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Type</label>
          <select
            value={stepData.frontmatter.type || "step"}
            onChange={(e) => handleFrontmatterChange("type", e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
          >
            <option value="step">step</option>
            <option value="decision">decision</option>
            <option value="merge">merge</option>
            <option value="end">end</option>
            <option value="subworkflow">subworkflow</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Title</label>
          <input
            type="text"
            value={stepData.frontmatter.title || ""}
            onChange={(e) => handleFrontmatterChange("title", e.target.value)}
            placeholder="Step title"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
          />
        </div>

      </div>

      <Section title="Agent" expanded={expanded.agent} onToggle={() => toggleSection("agent")}>
        <select
          value={stepData.frontmatter.agentId || ""}
          onChange={(e) => handleFrontmatterChange("agentId", e.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
        >
          <option value="">-- Select agent --</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Inputs & Outputs" expanded={expanded.io} onToggle={() => toggleSection("io")}>
        <div className="space-y-3">
          <TagInput
            label="Inputs"
            value={stepData.frontmatter.inputs ?? []}
            placeholder="Press Enter / , to add (or paste multiple)"
            onChange={(next) => handleFrontmatterChange("inputs", next)}
          />

          <TagInput
            label="Outputs"
            value={stepData.frontmatter.outputs ?? []}
            placeholder="Press Enter / , to add (recommended: artifacts/...)"
            onChange={(next) => handleFrontmatterChange("outputs", next)}
          />

          {outputsShouldStartWithArtifacts ? (
            <p className="text-xs text-amber-700">
              Outputs should start with <span className="font-mono">artifacts/</span> (runtime path is{" "}
              <span className="font-mono">@project/artifacts/...</span>).
            </p>
          ) : null}

          {missingArtifactDirs.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p>Outputs reference unregistered directories: {missingArtifactDirs.join(", ")}</p>
              {props.artifacts?.onAddDirs ? (
                <button
                  type="button"
                  onClick={() => props.artifacts?.onAddDirs?.(missingArtifactDirs)}
                  disabled={Boolean(props.artifacts?.saving)}
                  className="mt-2 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add to Artifacts list
                </button>
              ) : null}
            </div>
          ) : null}

          {projectArtifactDirs.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Quick add:</span>
              {projectArtifactDirs.slice(0, 6).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => {
                    const filename = window.prompt("Output filename (e.g. target.md)", "target.md");
                    if (!filename) return;
                    const cleaned = filename.trim().replace(/^\/+/, "");
                    if (!cleaned) return;
                    handleFrontmatterChange("outputs", outputs.concat(`${dir}/${cleaned}`));
                  }}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  {dir.replace(/^artifacts\//, "")}
                </button>
              ))}
              {projectArtifactDirs.length > 6 ? (
                <span className="text-xs text-zinc-400">+{projectArtifactDirs.length - 6}</span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              No artifacts directories configured. Add them in Inspector → Artifacts.
            </p>
          )}
        </div>
      </Section>

      <Section title="Assets" expanded={expanded.assets} onToggle={() => toggleSection("assets")}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="node-insert-asset" className="text-xs font-medium text-zinc-700">
              Insert asset
            </label>
            <span className="text-xs text-zinc-500">{props.assets?.items?.length ?? 0}</span>
          </div>

          {props.assets?.error || props.assets?.parseError ? (
            <p className="text-xs text-amber-700">{props.assets?.error || props.assets?.parseError}</p>
          ) : (props.assets?.items?.length ?? 0) ? (
            <>
              <select
                id="node-insert-asset"
                value={assetInsertPath}
                onChange={(e) => setAssetInsertPath(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
              >
                <option value="">Select an asset…</option>
                {(props.assets?.items ?? []).map((asset) => (
                  <option key={asset.path} value={asset.path}>
                    {asset.path}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!assetInsertPath.trim()) return;
                    void copyTextSilent(toRuntimeAssetPath(assetInsertPath));
                  }}
                  disabled={!assetInsertPath.trim()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Copy @pkg
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const path = assetInsertPath.trim();
                    if (!path) return;
                    const runtimePath = toRuntimeAssetPath(path);
                    handleSectionChange("instructions", appendLine(stepData.sections.instructions ?? "", runtimePath));
                  }}
                  disabled={!assetInsertPath.trim()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Insert into instructions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const path = assetInsertPath.trim();
                    if (!path) return;
                    const inputs = normalizeStringList(stepData.frontmatter.inputs ?? []);
                    handleFrontmatterChange("inputs", inputs.includes(path) ? inputs : inputs.concat(path));
                  }}
                  disabled={!assetInsertPath.trim()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add to inputs
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                Runtime path is <span className="font-mono">@pkg/assets/...</span> (read-only).
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">No assets yet. Create them in ProjectBuilder → Assets first.</p>
          )}
        </div>
      </Section>

      <Section title="Variable keys" expanded={expanded.variables} onToggle={() => toggleSection("variables")}>
        <div className="space-y-2">
          <textarea
            value={(stepData.frontmatter.setsVariables ?? []).join("\n")}
            onChange={(e) =>
              handleFrontmatterChange(
                "setsVariables",
                e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => Boolean(line)),
              )
            }
            className="min-h-20 w-full resize-y rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            placeholder="storyKey\nepicNum\n..."
          />
          {props.onSyncWorkflowVariables ? (
            <button
              type="button"
              onClick={() => props.onSyncWorkflowVariables?.(stepData.frontmatter.setsVariables ?? [])}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Sync to Workflow Variables
            </button>
          ) : null}
        </div>
      </Section>

      <div className="space-y-3">
        <Section title="Goal" required expanded={expanded.goal} onToggle={() => toggleSection("goal")}>
          <button
            type="button"
            onClick={() => setActiveSection("goal")}
            className="min-h-24 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left font-mono text-xs leading-6 text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50"
          >
            {previewMarkdown(stepData.sections.goal, 8) ? (
              <span className="whitespace-pre-wrap">{previewMarkdown(stepData.sections.goal, 8)}</span>
            ) : (
              <span className="text-zinc-400">Click to open Markdown editor…</span>
            )}
          </button>
        </Section>

        <Section title="Instructions" required expanded={expanded.instructions} onToggle={() => toggleSection("instructions")}>
          <button
            type="button"
            onClick={() => setActiveSection("instructions")}
            className="min-h-40 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left font-mono text-xs leading-6 text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50"
          >
            {previewMarkdown(stepData.sections.instructions, 12) ? (
              <span className="whitespace-pre-wrap">{previewMarkdown(stepData.sections.instructions, 12)}</span>
            ) : (
              <span className="text-zinc-400">Click to open Markdown editor…</span>
            )}
          </button>
        </Section>

        <Section title="Completion" expanded={expanded.completion} onToggle={() => toggleSection("completion")}>
          <button
            type="button"
            onClick={() => setActiveSection("completion")}
            className="min-h-28 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left font-mono text-xs leading-6 text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50"
          >
            {previewMarkdown(stepData.sections.completion || "", 10) ? (
              <span className="whitespace-pre-wrap">{previewMarkdown(stepData.sections.completion || "", 10)}</span>
            ) : (
              <span className="text-zinc-400">Click to open Markdown editor…</span>
            )}
          </button>
        </Section>
      </div>
    </div>
  );
}
