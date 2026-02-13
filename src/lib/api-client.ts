import { getAccessToken } from "@/lib/auth";

export type ApiError = {
  code: string;
  message: string;
  details?: unknown | null;
  hints?: string[];
};

export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
};

export type ApiBaseUrlResult = {
  baseUrl: string | null;
  error: string | null;
};

export function getApiBaseUrl(): ApiBaseUrlResult {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  const baseUrl = raw?.trim();

  if (!baseUrl) {
    return {
      baseUrl: null,
      error:
        "API base URL not configured: set NEXT_PUBLIC_API_BASE_URL in `crewagent-builder-frontend/.env.local` (e.g. http://localhost:8000).",
    };
  }

  return { baseUrl, error: null };
}

function getAuthHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RequestOptions = {
  auth?: boolean;
  timeoutMs?: number;
  cache?: RequestCache;
};

function parseDetailError(value: unknown): ApiError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as { detail?: unknown };
  if (!payload.detail || typeof payload.detail !== "object" || Array.isArray(payload.detail)) return null;
  const detail = payload.detail as { code?: unknown; message?: unknown; details?: unknown; hints?: unknown };
  const code = typeof detail.code === "string" && detail.code.trim() ? detail.code.trim() : "API_ERROR";
  const message = typeof detail.message === "string" && detail.message.trim() ? detail.message : "Request failed.";
  const hints = Array.isArray(detail.hints)
    ? detail.hints.map((hint) => (typeof hint === "string" ? hint.trim() : "")).filter(Boolean)
    : [];
  return {
    code,
    message,
    ...(detail.details !== undefined ? { details: detail.details } : {}),
    ...(hints.length ? { hints } : {}),
  };
}

async function requestJson<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  const { baseUrl, error: envError } = getApiBaseUrl();
  if (!baseUrl) {
    return {
      data: null,
      error: { code: "ENV_NOT_CONFIGURED", message: envError ?? "API base URL not configured." },
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.auth) Object.assign(headers, getAuthHeader());

  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(1, Math.floor(options?.timeoutMs as number)) : null;
  const abortController = timeoutMs ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (abortController && timeoutMs) {
    timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : body == null ? undefined : JSON.stringify(body),
      cache: method === "GET" ? (options?.cache ?? "no-store") : undefined,
      signal: abortController?.signal,
    });

    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json || typeof json !== "object" || !("data" in json) || !("error" in json)) {
      const detailError = parseDetailError(json);
      if (detailError) {
        return { data: null, error: detailError };
      }
      return {
        data: null,
        error: { code: "BAD_RESPONSE", message: "Unexpected server response." },
      };
    }

    return json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        data: null,
        error: { code: "REQUEST_TIMEOUT", message: "Request timed out. Please try again later." },
      };
    }
    return { data: null, error: { code: "NETWORK_ERROR", message: "Network error. Please try again later." } };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return requestJson<T>("POST", path, body, options);
}

export async function getJson<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
  return requestJson<T>("GET", path, null, options);
}

export async function putJson<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return requestJson<T>("PUT", path, body, options);
}

export async function deleteJson<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
  return requestJson<T>("DELETE", path, null, options);
}

export async function deleteJsonWithBody<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return requestJson<T>("DELETE", path, body, options);
}

/**
 * POST a FormData (multipart/form-data) to the API.
 * Used for file uploads like .bmad package import.
 */
export async function postFormData<T>(
  path: string,
  formData: FormData,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  const { baseUrl, error: envError } = getApiBaseUrl();
  if (!baseUrl) {
    return {
      data: null,
      error: { code: "ENV_NOT_CONFIGURED", message: envError ?? "API base URL not configured." },
    };
  }

  const headers: Record<string, string> = {};
  // Note: Do NOT set Content-Type for FormData, browser will set it with boundary
  if (options?.auth) Object.assign(headers, getAuthHeader());

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });

    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json || typeof json !== "object" || !("data" in json) || !("error" in json)) {
      const detailError = parseDetailError(json);
      if (detailError) {
        return { data: null, error: detailError };
      }
      return {
        data: null,
        error: { code: "BAD_RESPONSE", message: "Unexpected server response." },
      };
    }

    return json;
  } catch {
    return { data: null, error: { code: "NETWORK_ERROR", message: "Network error. Please try again later." } };
  }
}
