/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios, { AxiosRequestConfig } from "axios";
import { CLIENT_STORAGE_KEYS, clearAuthStorage, readClientJson, readClientStorage, writeClientStorage } from "../utils/clientStorage";
import { coordinateAuthRefresh } from "./authRefreshCoordinator";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
type ApiRequestProfile = "interactive" | "long_running";

export const API_REQUEST_TIMEOUT_MS = 0;
export const INTERACTIVE_REQUEST_TIMEOUT_MS = 15_000;
export const AUTH_REFRESH_TIMEOUT_MS = 8_000;
export const LONG_RUNNING_REQUEST_TIMEOUT_MS = 0;

export function buildApiUrl(
  path: string,
  params?: Record<string, unknown>,
): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(`${base}/${normalizedPath}`, origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

export function buildApiFetchHeaders(
  additionalHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...additionalHeaders };
  const token = readClientStorage(CLIENT_STORAGE_KEYS.authToken);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const parsed = readClientJson<{ authType?: string }>(CLIENT_STORAGE_KEYS.sessionUser);
  if (parsed?.authType === "s3_session") {
    const endpoint = readClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
    if (endpoint) {
      headers["X-S3-Endpoint"] = endpoint;
    }
  }
  return headers;
}

export function timeoutForRequestProfile(profile: ApiRequestProfile): number {
  return profile === "interactive" ? INTERACTIVE_REQUEST_TIMEOUT_MS : LONG_RUNNING_REQUEST_TIMEOUT_MS;
}

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: API_REQUEST_TIMEOUT_MS,
});

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: AUTH_REFRESH_TIMEOUT_MS,
});

type RetriableRequestConfig = AxiosRequestConfig & { _retry?: boolean };

type RefreshResponse = {
  access_token: string;
  token_type: string;
};

function readBearerToken(config: RetriableRequestConfig): string | null {
  const headers = config.headers as Record<string, unknown> & { get?: (name: string) => unknown } | undefined;
  const authorization = headers?.Authorization ?? headers?.authorization ?? headers?.get?.("Authorization");
  return typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

function handleAuthRedirect() {
  if (typeof window === "undefined") return;
  clearAuthStorage();
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

function isAuthEndpoint(url: string) {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/login-s3") ||
    url.includes("/auth/ldap/") ||
    url.includes("/auth/oidc/") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(observedToken: string | null): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = coordinateAuthRefresh(observedToken, () => refreshClient
      .post<RefreshResponse>("/auth/refresh")
      .then((response) => {
        const token = response.data.access_token;
        writeClientStorage(CLIENT_STORAGE_KEYS.authToken, token);
        return token;
      }))
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

client.interceptors.request.use((config) => {
  const fetchHeaders = buildApiFetchHeaders();
  if (Object.keys(fetchHeaders).length > 0) {
    config.headers = config.headers ?? {};
    Object.assign(config.headers, fetchHeaders);
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error?.config as RetriableRequestConfig | undefined;
    const url = originalRequest?.url ?? "";
    const shouldAttemptRefresh =
      (status === 401 || status === 419) &&
      !isAuthEndpoint(url) &&
      originalRequest &&
      !originalRequest._retry;
    if (shouldAttemptRefresh) {
      originalRequest._retry = true;
      try {
        const token = await refreshAccessToken(readBearerToken(originalRequest));
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return client(originalRequest);
      } catch (refreshError) {
        handleAuthRedirect();
        return Promise.reject(refreshError);
      }
    }
    if ((status === 401 || status === 419) && !isAuthEndpoint(url)) {
      handleAuthRedirect();
    }
    return Promise.reject(error);
  },
);

export default client;
