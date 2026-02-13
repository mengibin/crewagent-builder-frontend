"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { WorkbenchShell, type WorkbenchTarget } from "@/components/ai/workbench-shell";
import { clearAccessToken } from "@/lib/auth";
import type { WorkbenchMode, WorkbenchTargetType } from "@/lib/ai-workbench-client";
import { useRequireAuth } from "@/lib/use-require-auth";

const TARGET_TYPES: WorkbenchTargetType[] = ["workflow", "step", "agent", "asset"];
const MODES: WorkbenchMode[] = ["create", "optimize"];

function normalizeParam(value: string | null): string {
  return (value ?? "").trim();
}

function normalizeReturnTo(value: string | null): string | null {
  const trimmed = normalizeParam(value);
  if (!trimmed) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}

function normalizeWorkflowId(value: string | null): number | null {
  const trimmed = normalizeParam(value);
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function normalizeSource(value: string | null): string | null {
  const trimmed = normalizeParam(value);
  return trimmed || null;
}

function resolveReturnHref(params: {
  projectId: string;
  target: WorkbenchTarget | null;
  workflowId: number | null;
  source: string | null;
  returnTo: string | null;
}): string {
  if (params.returnTo) return params.returnTo;

  if (params.source === "editor" && params.workflowId) {
    return `/editor/${params.projectId}/${params.workflowId}`;
  }

  if (params.source === "agent-editor" && params.target?.type === "agent" && params.target.id) {
    return `/builder/${params.projectId}/agents/${encodeURIComponent(params.target.id)}`;
  }

  return params.projectId ? `/builder/${params.projectId}` : "/dashboard";
}

function parseTarget(searchParams: URLSearchParams): { target: WorkbenchTarget | null; error: string | null } {
  const rawType = normalizeParam(searchParams.get("targetType")).toLowerCase();
  const rawId = normalizeParam(searchParams.get("targetId"));
  const rawMode = normalizeParam(searchParams.get("mode")).toLowerCase();

  if (!rawType || !rawId || !rawMode) {
    return {
      target: null,
      error: "Missing required query params: targetType, targetId, mode.",
    };
  }

  if (!TARGET_TYPES.includes(rawType as WorkbenchTargetType)) {
    return {
      target: null,
      error: `Unsupported targetType: ${rawType}.`,
    };
  }

  if (!MODES.includes(rawMode as WorkbenchMode)) {
    return {
      target: null,
      error: `Unsupported mode: ${rawMode}.`,
    };
  }

  return {
    target: { type: rawType as WorkbenchTargetType, id: rawId, mode: rawMode as WorkbenchMode },
    error: null,
  };
}

export default function AiWorkbenchPage() {
  const router = useRouter();
  const ready = useRequireAuth();
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();

  const projectId = params?.projectId ?? "";

  const { target, error } = useMemo(() => parseTarget(searchParams), [searchParams]);
  const returnHref = useMemo(() => normalizeReturnTo(searchParams.get("returnTo")), [searchParams]);
  const workflowId = useMemo(() => normalizeWorkflowId(searchParams.get("workflowId")), [searchParams]);
  const source = useMemo(() => normalizeSource(searchParams.get("source")), [searchParams]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-sm text-[#5F6B82]">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <WorkbenchShell
      projectId={projectId}
      target={target}
      error={error}
      workflowId={workflowId}
      source={source}
      returnHref={resolveReturnHref({ projectId, target, workflowId, source, returnTo: returnHref })}
      onLogout={() => {
        clearAccessToken();
        router.replace("/login");
      }}
    />
  );
}
