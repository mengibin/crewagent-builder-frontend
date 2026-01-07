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
          <p className="text-sm text-zinc-600">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Editor</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Placeholder page: the workflow editor will be implemented here in a later epic.
        </p>

        <div className="mt-6 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            Back to Dashboard
          </Link>
          <button
            type="button"
            onClick={() => {
              clearAccessToken();
              router.replace("/login");
            }}
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
