"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { getApiBaseUrl, getJson, postJson, putJson } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";


type LlmProvider = "disabled" | "openai-compatible";

type LlmAvailability = {
  available: boolean;
  code: string;
  message: string;
};

type LlmProfileOut = {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  apiKeyMasked: string | null;
  timeoutSeconds: number;
  contextWindow: number | null;
  healthStatus: string;
  lastTestedAt: string | null;
  effectiveAvailability: LlmAvailability;
};

type LlmProfileUpdateRequest = {
  provider: LlmProvider;
  baseUrl: string | null;
  model: string | null;
  timeoutSeconds: number;
  contextWindow: number | null;
  apiKey?: string;
};

type LlmProfileTestRequest = {
  provider: LlmProvider;
  baseUrl: string | null;
  model: string | null;
  timeoutSeconds: number;
  apiKey?: string;
};

type LlmProfileTestResult = {
  ok: boolean;
  code: string;
  message: string;
  hints: string[];
};

type PersistedProfileSnapshot = {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  contextWindow: string;
};

const LLM_PROVIDER_OPTIONS: Array<{ value: LlmProvider; label: string; description: string }> = [
  {
    value: "openai-compatible",
    label: "OpenAI Compatible",
    description: "DeepSeek/OpenAI 兼容接口",
  },
  {
    value: "disabled",
    label: "Disabled",
    description: "禁用 LLM provider",
  },
];



function normalizeProvider(value: string | null | undefined): LlmProvider {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "openai-compatible" || normalized === "disabled") {
    return normalized;
  }
  return "disabled";
}

function parseRequiredPositiveInt(raw: string, fieldLabel: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: `${fieldLabel} is required.` };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null, error: `${fieldLabel} must be a positive integer.` };
  }
  return { value: parsed, error: null };
}

function parseOptionalPositiveInt(raw: string, fieldLabel: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: null };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null, error: `${fieldLabel} must be a positive integer.` };
  }
  return { value: parsed, error: null };
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Never";
  return timestamp.toLocaleString();
}

function attachHints(message: string, hints?: string[]): string {
  if (!hints?.length) return message;
  return `${message} (${hints.join(" / ")})`;
}

// Collapsible card component
function CollapsibleCard({
  title,
  icon,
  children,
  defaultExpanded = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 text-[#94A0B8] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div
        className={`grid transition-all duration-200 ease-in-out ${isExpanded ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const [llmProvider, setLlmProvider] = useState<LlmProvider>("disabled");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmApiKeyMasked, setLlmApiKeyMasked] = useState<string | null>(null);
  const [llmTimeoutSeconds, setLlmTimeoutSeconds] = useState("60");
  const [llmContextWindow, setLlmContextWindow] = useState("");
  const [llmHealthStatus, setLlmHealthStatus] = useState("unknown");
  const [llmLastTestedAt, setLlmLastTestedAt] = useState<string | null>(null);
  const [llmEffectiveAvailability, setLlmEffectiveAvailability] = useState<LlmAvailability | null>(null);
  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedProfileSnapshot | null>(null);

  const [llmLoadError, setLlmLoadError] = useState<string | null>(null);
  const [llmSaveError, setLlmSaveError] = useState<string | null>(null);
  const [llmSaveSuccess, setLlmSaveSuccess] = useState<string | null>(null);
  const [llmTestError, setLlmTestError] = useState<string | null>(null);
  const [llmTestResult, setLlmTestResult] = useState<LlmProfileTestResult | null>(null);
  const [isLlmLoading, setIsLlmLoading] = useState(false);
  const [isLlmSaving, setIsLlmSaving] = useState(false);
  const [isLlmTesting, setIsLlmTesting] = useState(false);



  const loadLlmProfile = useCallback(async () => {
    if (!ready || apiEnvError) return;
    setIsLlmLoading(true);
    setLlmLoadError(null);

    try {
      const res = await getJson<LlmProfileOut>("/users/me/llm-profile", { auth: true });
      if (res.error) {
        setLlmLoadError(res.error.message);
        return;
      }
      if (!res.data) {
        setLlmLoadError("Unexpected server response. Please refresh and try again.");
        return;
      }

      const provider = normalizeProvider(res.data.provider);
      const baseUrl = (res.data.baseUrl ?? "").trim();
      const model = (res.data.model ?? "").trim();
      const timeoutSeconds = Number.isFinite(res.data.timeoutSeconds) && res.data.timeoutSeconds > 0
        ? res.data.timeoutSeconds
        : 60;
      const contextWindow = res.data.contextWindow != null ? String(res.data.contextWindow) : "";

      setLlmProvider(provider);
      setLlmBaseUrl(baseUrl);
      setLlmModel(model);
      setLlmApiKey("");
      setLlmApiKeyMasked(res.data.apiKeyMasked);
      setLlmTimeoutSeconds(String(timeoutSeconds));
      setLlmContextWindow(contextWindow);
      setLlmHealthStatus(res.data.healthStatus || "unknown");
      setLlmLastTestedAt(res.data.lastTestedAt);
      setLlmEffectiveAvailability(res.data.effectiveAvailability);
      setPersistedSnapshot({
        provider,
        baseUrl,
        model,
        timeoutSeconds,
        contextWindow,
      });
    } catch {
      setLlmLoadError("Failed to load profile. Please try again later.");
    } finally {
      setIsLlmLoading(false);
    }
  }, [apiEnvError, ready]);

  useEffect(() => {
    loadLlmProfile();
  }, [loadLlmProfile]);

  function buildLlmPayload(): { payload: LlmProfileUpdateRequest | null; error: string | null } {
    const timeout = parseRequiredPositiveInt(llmTimeoutSeconds, "Request timeout");
    if (timeout.error || timeout.value === null) {
      return { payload: null, error: timeout.error ?? "Request timeout is invalid." };
    }

    const contextWindow = parseOptionalPositiveInt(llmContextWindow, "Context window");
    if (contextWindow.error) {
      return { payload: null, error: contextWindow.error };
    }

    const baseUrl = llmBaseUrl.trim();
    const model = llmModel.trim();
    if (llmProvider === "openai-compatible") {
      if (!baseUrl) {
        return { payload: null, error: "Base URL is required for OpenAI Compatible provider." };
      }
      if (!model) {
        return { payload: null, error: "Model is required for OpenAI Compatible provider." };
      }
    }

    const payload: LlmProfileUpdateRequest = {
      provider: llmProvider,
      baseUrl: baseUrl || null,
      model: model || null,
      timeoutSeconds: timeout.value,
      contextWindow: contextWindow.value,
    };
    const apiKey = llmApiKey.trim();
    if (apiKey) {
      payload.apiKey = apiKey;
    }
    return { payload, error: null };
  }

  async function onSaveLlmProfile() {
    setLlmSaveError(null);
    setLlmSaveSuccess(null);
    setLlmTestError(null);

    if (apiEnvError) {
      setLlmSaveError(apiEnvError);
      return;
    }

    const { payload, error } = buildLlmPayload();
    if (!payload || error) {
      setLlmSaveError(error ?? "Invalid profile payload.");
      return;
    }

    setIsLlmSaving(true);
    try {
      const res = await putJson<LlmProfileOut>("/users/me/llm-profile", payload, { auth: true });
      if (res.error) {
        setLlmSaveError(attachHints(res.error.message, res.error.hints));
        return;
      }
      if (!res.data) {
        setLlmSaveError("Unexpected server response. Please try again.");
        return;
      }

      const provider = normalizeProvider(res.data.provider);
      const baseUrl = (res.data.baseUrl ?? "").trim();
      const model = (res.data.model ?? "").trim();
      const timeoutSeconds = Number.isFinite(res.data.timeoutSeconds) && res.data.timeoutSeconds > 0
        ? res.data.timeoutSeconds
        : 60;
      const contextWindow = res.data.contextWindow != null ? String(res.data.contextWindow) : "";

      setLlmProvider(provider);
      setLlmBaseUrl(baseUrl);
      setLlmModel(model);
      setLlmApiKey("");
      setLlmApiKeyMasked(res.data.apiKeyMasked);
      setLlmTimeoutSeconds(String(timeoutSeconds));
      setLlmContextWindow(contextWindow);
      setLlmHealthStatus(res.data.healthStatus || "unknown");
      setLlmLastTestedAt(res.data.lastTestedAt);
      setLlmEffectiveAvailability(res.data.effectiveAvailability);
      setPersistedSnapshot({
        provider,
        baseUrl,
        model,
        timeoutSeconds,
        contextWindow,
      });

      setLlmSaveSuccess("Saved successfully.");
    } catch {
      setLlmSaveError("Save failed. Please try again.");
    } finally {
      setIsLlmSaving(false);
    }
  }

  async function onTestLlmConnection() {
    setLlmTestError(null);
    setLlmTestResult(null);
    setLlmSaveSuccess(null);

    if (apiEnvError) {
      setLlmTestError(apiEnvError);
      return;
    }

    const { payload, error } = buildLlmPayload();
    if (!payload || error) {
      setLlmTestError(error ?? "Invalid profile payload.");
      return;
    }

    const usePersistedProfile =
      llmApiKey.trim().length === 0 &&
      persistedSnapshot !== null &&
      persistedSnapshot.provider === payload.provider &&
      persistedSnapshot.baseUrl === (payload.baseUrl ?? "") &&
      persistedSnapshot.model === (payload.model ?? "") &&
      persistedSnapshot.timeoutSeconds === payload.timeoutSeconds &&
      persistedSnapshot.contextWindow === (payload.contextWindow != null ? String(payload.contextWindow) : "");

    const testPayload: LlmProfileTestRequest = {
      provider: payload.provider,
      baseUrl: payload.baseUrl,
      model: payload.model,
      timeoutSeconds: payload.timeoutSeconds,
      ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
    };

    setIsLlmTesting(true);
    try {
      const res = await postJson<LlmProfileTestResult>(
        "/users/me/llm-profile/test",
        usePersistedProfile ? null : testPayload,
        { auth: true },
      );
      if (res.error) {
        setLlmTestError(attachHints(res.error.message, res.error.hints));
        return;
      }
      if (!res.data) {
        setLlmTestError("Unexpected server response. Please try again.");
        return;
      }

      setLlmTestResult(res.data);
      if (usePersistedProfile) {
        await loadLlmProfile();
      }
    } catch {
      setLlmTestError("Connection test failed. Please try again.");
    } finally {
      setIsLlmTesting(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
        <div className="mx-auto w-full px-8 py-16 lg:px-12">
          <p className="text-sm text-[#5F6B82]">Redirecting...</p>
        </div>
      </main>
    );
  }



  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="mx-auto w-full max-w-6xl px-8 py-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[#DDE3EE] bg-white p-1">
              <Image src="/favicon.png" alt="CrewAgent icon" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <p className="text-sm font-semibold">CrewAgent Builder</p>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/dashboard" className="text-[#4F46E5]">
              ← Dashboard
            </Link>
            <div className="h-7 w-7 rounded-full border border-[#DDE3EE] bg-white" />
            <span>Cora Lin</span>
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

        <section className="mt-8">
          <span className="inline-flex rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5]">
            Profile & Preferences
          </span>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">Personal Settings</h1>
          <p className="mt-2 text-sm text-[#5F6B82]">
            Manage your account security and default LLM providers for CrewAgent Builder.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          {/* LLM Provider Card - Most commonly used, default expanded */}
          <CollapsibleCard
            title="LLM Provider"
            defaultExpanded={true}
            icon={
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-[#4F46E5]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="6" rx="2" />
                <rect x="3" y="14" width="18" height="6" rx="2" />
              </svg>
            }
          >
            <div className="space-y-3">
              <div className="rounded-2xl border border-[#E5EAF4] bg-[#F7F9FD] px-4 py-3 text-[11px] text-[#5F6B82]">
                <p>
                  Health: <span className="font-semibold text-[#1F2937]">{llmHealthStatus}</span>
                </p>
                <p>
                  Last tested: <span className="font-semibold text-[#1F2937]">{formatDateTime(llmLastTestedAt)}</span>
                </p>
                {llmEffectiveAvailability ? (
                  <p>
                    Effective availability:{" "}
                    <span className={llmEffectiveAvailability.available ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                      {llmEffectiveAvailability.message}
                    </span>
                  </p>
                ) : null}
              </div>

              <p className="text-xs font-semibold text-[#5F6B82]">Provider</p>
              <div className="flex flex-wrap gap-2">
                {LLM_PROVIDER_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                    onClick={() => {
                      setLlmProvider(item.value);
                      setLlmSaveError(null);
                      setLlmSaveSuccess(null);
                      setLlmTestError(null);
                    }}
                    className={[
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      llmProvider === item.value
                        ? "border-[#4F46E5] bg-[#E9EDFF] text-[#4F46E5]"
                        : "border-[#DDE3EE] bg-white text-[#5F6B82]",
                      isLlmLoading || isLlmSaving || isLlmTesting ? "cursor-not-allowed opacity-60" : "",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#94A0B8]">
                {LLM_PROVIDER_OPTIONS.find((item) => item.value === llmProvider)?.description}
              </p>

              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="base-url">
                  Base URL / Endpoint
                </label>
                <input
                  id="base-url"
                  type="text"
                  value={llmBaseUrl}
                  onChange={(e) => {
                    setLlmBaseUrl(e.target.value);
                    setLlmSaveError(null);
                    setLlmSaveSuccess(null);
                    setLlmTestError(null);
                  }}
                  placeholder={llmProvider === "openai-compatible" ? "https://api.deepseek.com" : "Optional"}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="model">
                  Model
                </label>
                <input
                  id="model"
                  type="text"
                  value={llmModel}
                  onChange={(e) => {
                    setLlmModel(e.target.value);
                    setLlmSaveError(null);
                    setLlmSaveSuccess(null);
                    setLlmTestError(null);
                  }}
                  placeholder={llmProvider === "openai-compatible" ? "deepseek-chat / gpt-4o-mini" : "Optional"}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="context-window">
                  Context Window (tokens, optional)
                </label>
                <input
                  id="context-window"
                  type="text"
                  inputMode="numeric"
                  value={llmContextWindow}
                  onChange={(e) => {
                    setLlmContextWindow(e.target.value);
                    setLlmSaveError(null);
                    setLlmSaveSuccess(null);
                    setLlmTestError(null);
                  }}
                  placeholder="100000"
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="api-key">
                  API Key
                </label>
                <input
                  id="api-key"
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => {
                    setLlmApiKey(e.target.value);
                    setLlmSaveError(null);
                    setLlmSaveSuccess(null);
                    setLlmTestError(null);
                  }}
                  placeholder={llmApiKeyMasked ? `${llmApiKeyMasked} (leave blank to keep existing key)` : "sk-..."}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
                {llmApiKeyMasked ? (
                  <p className="mt-1 text-[11px] text-[#94A0B8]">当前已保存 API key: {llmApiKeyMasked}</p>
                ) : null}
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="timeout">
                  Request Timeout (seconds)
                </label>
                <input
                  id="timeout"
                  type="text"
                  inputMode="numeric"
                  value={llmTimeoutSeconds}
                  onChange={(e) => {
                    setLlmTimeoutSeconds(e.target.value);
                    setLlmSaveError(null);
                    setLlmSaveSuccess(null);
                    setLlmTestError(null);
                  }}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting}
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>

              {isLlmLoading ? (
                <p className="rounded-2xl border border-[#DDE3EE] bg-[#F8FAFC] px-4 py-3 text-xs font-medium text-[#5F6B82]">
                  Loading LLM profile...
                </p>
              ) : null}
              {llmLoadError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
                  {llmLoadError}
                </p>
              ) : null}
              {apiEnvError ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                  {apiEnvError}
                </p>
              ) : null}
              {llmSaveError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
                  {llmSaveError}
                </p>
              ) : null}
              {llmSaveSuccess ? (
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">
                  {llmSaveSuccess}
                </p>
              ) : null}
              {llmTestError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
                  {llmTestError}
                </p>
              ) : null}
              {llmTestResult ? (
                <div
                  className={[
                    "rounded-2xl border px-4 py-3 text-xs",
                    llmTestResult.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800",
                  ].join(" ")}
                >
                  <p className="font-semibold">
                    {llmTestResult.ok ? "Connection OK" : "Connection Failed"} ({llmTestResult.code})
                  </p>
                  <p className="mt-1">{llmTestResult.message}</p>
                  {llmTestResult.hints.length ? (
                    <p className="mt-1">{llmTestResult.hints.join(" · ")}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={onTestLlmConnection}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting || Boolean(apiEnvError)}
                  className="rounded-full border border-[#DDE3EE] bg-white px-4 py-2 text-xs font-semibold text-[#5F6B82] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLlmTesting ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  onClick={onSaveLlmProfile}
                  disabled={isLlmLoading || isLlmSaving || isLlmTesting || Boolean(apiEnvError)}
                  className="rounded-full bg-[#4F46E5] px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLlmSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </CollapsibleCard>


          {/* Change Password Card - Least commonly used */}
          <CollapsibleCard
            title="Change Password"
            icon={
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-[#4F46E5]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 7a5 5 0 1 0-6 0v2H8a2 2 0 0 0-2 2v6h12v-6a2 2 0 0 0-2-2h-1z" />
              </svg>
            }
          >
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="current-password">
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="new-password">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5F6B82]" htmlFor="confirm-password">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[#DDE3EE] px-4 py-3 text-sm outline-none focus:border-[#4F46E5]"
                />
              </div>
              <button
                type="button"
                className="mt-2 inline-flex items-center justify-center rounded-full bg-[#4F46E5] px-5 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)]"
              >
                Update Password
              </button>
            </div>
          </CollapsibleCard>
        </section>
      </div>
    </main>
  );
}
