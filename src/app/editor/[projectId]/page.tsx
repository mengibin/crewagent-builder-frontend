"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { getApiBaseUrl, getJson, type ApiError } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";

type WorkflowListItem = {
  id: number;
  name: string;
  isDefault: boolean;
};

function pickDefaultWorkflow(list: WorkflowListItem[]): WorkflowListItem | null {
  if (!list.length) return null;
  return list.find((w) => w.isDefault) ?? list[0] ?? null;
}

function formatLoadError(error: ApiError): { title: string; message: string } {
  switch (error.code) {
    case "PACKAGE_NOT_FOUND":
      return { title: "Project not found", message: "This project doesn't exist, was deleted, or you don't have access." };
    case "VALIDATION_ERROR":
      return { title: "Invalid project ID", message: "The projectId in the URL is invalid. Go back to Dashboard and open it again." };
    case "NETWORK_ERROR":
      return { title: "Network error", message: "Unable to reach the backend service. Please try again later." };
    default:
      return { title: "Failed to load", message: error.message || "Failed to load. Please try again later." };
  }
}

export default function EditorProjectRedirectPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const projectId = params?.projectId;

  const [error, setError] = useState<ApiError | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;
    if (!projectId) return;

    let cancelled = false;
    getJson<WorkflowListItem[]>(`/packages/${projectId}/workflows`, { auth: true })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          setLoadedProjectId(projectId);
          return;
        }
        if (!res.data) {
          setError({ code: "BAD_RESPONSE", message: "Unexpected server response." });
          setLoadedProjectId(projectId);
          return;
        }

        const target = pickDefaultWorkflow(res.data);
        if (!target) {
          setError({ code: "NO_WORKFLOWS", message: "This project has no workflows yet. Create one in ProjectBuilder first." });
          setLoadedProjectId(projectId);
          return;
        }

        router.replace(`/editor/${projectId}/${target.id}`);
      })
      .catch(() => {
        if (cancelled) return;
        setError({ code: "NETWORK_ERROR", message: "Network error. Please try again later." });
        setLoadedProjectId(projectId);
      });

    return () => {
      cancelled = true;
    };
  }, [apiEnvError, projectId, ready, router]);

  const activeError = loadedProjectId === projectId ? error : null;
  const formattedError = useMemo(() => (activeError ? formatLoadError(activeError) : null), [activeError]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-[#5F6B82]">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
              <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-base font-semibold">CrewAgent Builder</p>
              <p className="text-xs text-[#94A0B8]">Workflow Editor</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href={projectId ? `/builder/${projectId}` : "/dashboard"} className="text-[#4F46E5]">
              ← Builder
            </Link>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-[#5F6B82]"
            >
              Logout
            </button>
          </div>
        </header>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Workflow Editor</h1>
        <p className="mt-2 text-sm text-[#5F6B82]">Opening default workflow…</p>

        {apiEnvError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {apiEnvError}
          </div>
        ) : null}

        {formattedError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <p className="text-sm font-medium">{formattedError.title}</p>
            <p className="mt-1 text-sm">{formattedError.message}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
