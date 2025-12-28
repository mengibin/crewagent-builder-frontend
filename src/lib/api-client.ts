import { getAccessToken } from "@/lib/auth";

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, string> | null;
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
        "API 环境未配置：请在 `crewagent-builder-frontend/.env.local` 中设置 NEXT_PUBLIC_API_BASE_URL（例如 http://localhost:8000）。",
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
      error: { code: "ENV_NOT_CONFIGURED", message: envError ?? "API 环境未配置" },
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
        error: { code: "BAD_RESPONSE", message: "服务返回格式不正确" },
      };
    }

    return json;
  } catch {
    return { data: null, error: { code: "NETWORK_ERROR", message: "网络错误，请稍后重试" } };
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
