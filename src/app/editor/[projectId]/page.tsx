"use client";

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
      return { title: "项目不存在", message: "该项目不存在、已被删除，或你没有权限访问。" };
    case "VALIDATION_ERROR":
      return { title: "项目 ID 无效", message: "URL 中的 projectId 不正确，请返回 Dashboard 重新打开。" };
    case "NETWORK_ERROR":
      return { title: "网络错误", message: "无法连接到后端服务，请稍后重试。" };
    default:
      return { title: "加载失败", message: error.message || "加载失败，请稍后重试。" };
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
          setError({ code: "BAD_RESPONSE", message: "服务返回格式不正确" });
          setLoadedProjectId(projectId);
          return;
        }

        const target = pickDefaultWorkflow(res.data);
        if (!target) {
          setError({ code: "NO_WORKFLOWS", message: "该项目没有工作流，请先在 ProjectBuilder 创建。" });
          setLoadedProjectId(projectId);
          return;
        }

        router.replace(`/editor/${projectId}/${target.id}`);
      })
      .catch(() => {
        if (cancelled) return;
        setError({ code: "NETWORK_ERROR", message: "网络错误，请稍后重试" });
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
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-zinc-600">正在跳转...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow Editor</h1>
        <p className="mt-2 text-sm text-zinc-600">正在打开默认工作流…</p>

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

        <div className="mt-6 flex flex-wrap gap-4">
          <Link
            href={projectId ? `/builder/${projectId}` : "/dashboard"}
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            返回 ProjectBuilder
          </Link>
          <button
            type="button"
            onClick={() => {
              clearAccessToken();
              router.replace("/login");
            }}
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            退出登录
          </button>
        </div>
      </div>
    </main>
  );
}

