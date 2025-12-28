"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSyncExternalStore } from "react";

import { getAccessToken } from "@/lib/auth";

function subscribeAccessToken(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", callback);
  window.addEventListener("crewagent:auth-token-changed", callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("crewagent:auth-token-changed", callback);
  };
}

export function useRequireAuth(): boolean {
  const router = useRouter();
  const token = useSyncExternalStore(
    subscribeAccessToken,
    () => getAccessToken(),
    () => null,
  );
  const hasToken = Boolean(token);

  useEffect(() => {
    if (!hasToken && !getAccessToken()) {
      router.replace("/login");
    }
  }, [router, hasToken]);

  return hasToken;
}
