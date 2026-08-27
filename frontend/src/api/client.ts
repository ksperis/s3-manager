/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CLIENT_STORAGE_KEYS, clearAuthStorage, readClientStorage } from "../utils/clientStorage";
import { readStoredUser } from "../utils/workspaces";
import { coordinateAuthRefresh } from "./authRefreshCoordinator";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
type ApiRequestProfile = "interactive" | "long_running";

export const API_REQUEST_TIMEOUT_MS = 0;
export const INTERACTIVE_REQUEST_TIMEOUT_MS = 15_000;
export const AUTH_REFRESH_TIMEOUT_MS = 8_000;
export const LONG_RUNNING_REQUEST_TIMEOUT_MS = 0;

type ApiRequestConfig = {
  params?: Record<string, unknown> | URLSearchParams;
  headers?: Record<string, string> | Headers;
  timeout?: number;
  signal?: AbortSignal;
  responseType?: "json" | "text" | "blob" | "arraybuffer";
  data?: unknown;
  _retry?: boolean;
};

type ApiResponse<T> = {
  data: T;
  status: number;
  headers: Record<string, string>;
};

export class ApiError<T = Record<string, unknown>> extends Error {
  readonly isApiError = true;
  readonly response?: { status: number; statusText?: string; data: T; headers: Record<string, string> };
  readonly code?: string;

  constructor(message: string, options: { response?: ApiError<T>["response"]; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.response = options.response;
    this.code = options.code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || Boolean(error && typeof error === "object" && "isApiError" in error);
}

export function buildApiUrl(path: string, params?: Record<string, unknown> | URLSearchParams): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(`${base}/${normalizedPath}`, origin);
  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => url.searchParams.append(key, value));
    return url.toString();
  }
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
    } else {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

export function buildApiFetchHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...additionalHeaders };
  const parsed = readStoredUser();
  if (parsed?.authType === "s3_session") {
    const endpoint = readClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
    if (endpoint) headers["X-S3-Endpoint"] = endpoint;
  }
  return headers;
}

export function timeoutForRequestProfile(profile: ApiRequestProfile): number {
  return profile === "interactive" ? INTERACTIVE_REQUEST_TIMEOUT_MS : LONG_RUNNING_REQUEST_TIMEOUT_MS;
}

function handleAuthRedirect() {
  if (typeof window === "undefined") return;
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent("bucketreef:session-ended"));
  if (window.location.pathname !== "/login") window.location.replace("/login");
}

function isAuthEndpoint(url: string): boolean {
  return url.includes("/auth/login") || url.includes("/auth/bootstrap/") ||
    url.includes("/auth/ldap/") || url.includes("/auth/oidc/") ||
    url.includes("/auth/webauthn/") || url.includes("/auth/recovery/") || url.includes("/auth/refresh") ||
    url.includes("/auth/logout");
}

function combineSignal(signal: AbortSignal | undefined, timeout: number): { signal?: AbortSignal; cleanup: () => void } {
  if (!signal && timeout <= 0) return { cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = timeout > 0 ? window.setTimeout(() => controller.abort("timeout"), timeout) : null;
  return {
    signal: controller.signal,
    cleanup: () => {
      signal?.removeEventListener("abort", abort);
      if (timer !== null) window.clearTimeout(timer);
    },
  };
}

export function buildApiRequestHeaders(method: string, configured?: HeadersInit): Headers {
  const headers = new Headers(buildApiFetchHeaders());
  new Headers(configured).forEach((value, key) => headers.set(key, value));
  // This client is exclusively for browser cookie sessions. API Bearers are
  // intentionally usable only by external API clients.
  headers.delete("Authorization");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("csrf_token");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  return headers;
}

function requestBody(data: unknown, headers: Headers): BodyInit | undefined {
  if (data === undefined || data === null) return undefined;
  if (data instanceof FormData || data instanceof URLSearchParams || data instanceof Blob || data instanceof ArrayBuffer || typeof data === "string") {
    return data as BodyInit;
  }
  headers.set("Content-Type", "application/json");
  return JSON.stringify(data);
}

async function parseResponse(response: Response, responseType?: ApiRequestConfig["responseType"]): Promise<unknown> {
  if (response.status === 204) return undefined;
  if (responseType === "blob") return response.blob();
  if (responseType === "arraybuffer") return response.arrayBuffer();
  if (responseType === "text") return response.text();
  const text = await response.text();
  if (!text) return undefined;
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

async function refreshCookies(): Promise<void> {
  await coordinateAuthRefresh(async () => {
    const timeout = combineSignal(undefined, AUTH_REFRESH_TIMEOUT_MS);
    try {
      const response = await fetch(buildApiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
        signal: timeout.signal,
      });
      if (!response.ok) throw new ApiError("Unable to refresh session", { response: { status: response.status, data: await parseResponse(response), headers: Object.fromEntries(response.headers.entries()) } });
    } finally {
      timeout.cleanup();
    }
  });
}

async function request<T>(method: string, path: string, data?: unknown, config: ApiRequestConfig = {}): Promise<ApiResponse<T>> {
  const url = buildApiUrl(path, config.params);
  const headers = buildApiRequestHeaders(method, config.headers);
  const combined = combineSignal(config.signal, config.timeout ?? API_REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: requestBody(data ?? config.data, headers),
        credentials: "include",
        signal: combined.signal,
      });
    } catch (error) {
      const timeout = combined.signal?.aborted && !config.signal?.aborted;
      throw new ApiError(timeout ? "Request timeout" : "Failed to fetch", {
        code: timeout ? "ETIMEDOUT" : undefined,
        cause: error,
      });
    }
    if ((response.status === 401 || response.status === 419) && !isAuthEndpoint(url) && !config._retry) {
      try {
        await refreshCookies();
        return request<T>(method, path, data, { ...config, _retry: true });
      } catch (error) {
        handleAuthRedirect();
        throw error;
      }
    }
    const parsed = await parseResponse(response, config.responseType);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, {
        response: { status: response.status, data: parsed, headers: responseHeaders },
      });
    }
    return { data: parsed as T, status: response.status, headers: responseHeaders };
  } finally {
    combined.cleanup();
  }
}

const client = {
  defaults: { baseURL: API_BASE_URL, timeout: API_REQUEST_TIMEOUT_MS },
  get: <T>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, undefined, config),
  post: <T>(path: string, data?: unknown, config?: ApiRequestConfig) => request<T>("POST", path, data, config),
  put: <T>(path: string, data?: unknown, config?: ApiRequestConfig) => request<T>("PUT", path, data, config),
  patch: <T>(path: string, data?: unknown, config?: ApiRequestConfig) => request<T>("PATCH", path, data, config),
  delete: <T>(path: string, config?: ApiRequestConfig) => request<T>("DELETE", path, undefined, config),
};

export default client;
