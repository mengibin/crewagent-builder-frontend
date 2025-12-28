"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { getApiBaseUrl, getJson, postJson } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";

type PackageListItem = {
  id: number;
  name: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;

    setIsLoading(true);
    setLoadError(null);
    getJson<PackageListItem[]>("/packages", { auth: true })
      .then((res) => {
        if (res.error) {
          setLoadError(res.error.message);
          return;
        }
        setPackages(res.data ?? []);
      })
      .catch(() => setLoadError("加载失败，请稍后重试"))
      .finally(() => setIsLoading(false));
  }, [apiEnvError, ready]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-zinc-600">正在跳转...</p>
        </div>
      </main>
    );
  }

  async function onCreateProject() {
    setCreateError(null);

    const trimmed = projectName.trim();
    if (!trimmed) {
      setCreateError("项目名称为必填");
      return;
    }
    if (trimmed.length > 200) {
      setCreateError("项目名称最多 200 个字符");
      return;
    }
    if (apiEnvError) {
      setCreateError(apiEnvError);
      return;
    }

    setIsCreating(true);
    try {
      const res = await postJson<PackageListItem>("/packages", { name: trimmed }, { auth: true });
      if (res.error) {
        setCreateError(res.error.message);
        return;
      }
      if (!res.data?.id) {
        setCreateError("服务返回异常，请稍后再试");
        return;
      }
      router.push(`/builder/${res.data.id}`);
    } catch {
      setCreateError("创建失败，请稍后重试");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-sm text-zinc-600">创建并管理你的项目。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsCreateOpen(true);
              setProjectName("");
              setCreateError(null);
            }}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            New Project
          </button>
        </div>

        {apiEnvError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {apiEnvError}
          </div>
        ) : null}

        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">My Projects</h2>
            <span className="text-xs text-zinc-500">{packages.length} 个</span>
          </div>

          {isLoading ? (
            <p className="mt-4 text-sm text-zinc-600">加载中...</p>
          ) : loadError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {loadError}
            </div>
          ) : packages.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
              <p className="text-sm text-zinc-600">还没有项目，点击右上角 New Project 创建一个吧。</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              {packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-950">{p.name}</p>
                    <p className="text-xs text-zinc-500">ID: {p.id}</p>
                  </div>
                  <Link
                    href={`/builder/${p.id}`}
                    className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                  >
                    打开
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            返回登录
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

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-zinc-950/30"
            onClick={() => {
              if (!isCreating) setIsCreateOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold tracking-tight">Create New Project</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreating}
                className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-60"
              >
                关闭
              </button>
            </div>

            {createError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {createError}
              </div>
            ) : null}

            <div className="mt-4 space-y-1.5">
              <label htmlFor="project-name" className="text-sm font-medium">
                项目名称
              </label>
              <input
                id="project-name"
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                placeholder="例如：My Project"
                disabled={isCreating}
              />
              <p className="text-xs text-zinc-500">用于显示与导出；后续可改名。</p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreating}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onCreateProject}
                disabled={isCreating}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {isCreating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
