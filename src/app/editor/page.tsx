"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { clearAccessToken } from "@/lib/auth";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function EditorPage() {
  const router = useRouter();
  const ready = useRequireAuth();

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
        <h1 className="text-2xl font-semibold tracking-tight">Editor</h1>
        <p className="mt-2 text-sm text-zinc-600">占位页面：后续 Epic 3 将在此实现 Workflow 编辑器。</p>

        <div className="mt-6 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            返回 Dashboard
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

