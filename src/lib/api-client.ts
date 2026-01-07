import { getAccessToken } from "@/lib/auth";

export type ApiError = {
  code: string;
  message: string;
  details?: unknown | null;
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
};

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

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : body == null ? undefined : JSON.stringify(body),
    });

    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json || typeof json !== "object" || !("data" in json) || !("error" in json)) {
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
      // Handle non-standard error responses (like 400/413 with detail field)
      const errorDetail = json as unknown as { detail?: { code?: string; message?: string; details?: unknown[] } };
      if (errorDetail?.detail) {
        return {
          data: null,
          error: {
            code: errorDetail.detail.code ?? "API_ERROR",
            message: errorDetail.detail.message ?? "Request failed.",
            details: errorDetail.detail.details as Record<string, string> | null | undefined,
          },
        };
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
