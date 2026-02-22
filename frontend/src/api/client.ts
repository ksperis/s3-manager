/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios, { AxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

type RetriableRequestConfig = AxiosRequestConfig & { _retry?: boolean };

type RefreshResponse = {
  access_token: string;
  token_type: string;
};

function handleAuthRedirect() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("s3SessionEndpoint");
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

function isAuthEndpoint(url: string) {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/login-s3") ||
    url.includes("/auth/oidc/") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<RefreshResponse>("/auth/refresh")
      .then((response) => {
        const token = response.data.access_token;
        localStorage.setItem("token", token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  const url = config.url ?? "";
  if (url.startsWith("/manager")) {
    const accountId = localStorage.getItem("selectedExecutionContextId");
    if (accountId) {
      const mode = localStorage.getItem(`managerAccessMode:${accountId}`);
      if (mode === "admin" || mode === "portal") {
        config.headers = config.headers ?? {};
        config.headers["X-Manager-Access-Mode"] = mode;
      }
    }
  }
  const userRaw = localStorage.getItem("user");
  if (userRaw) {
    try {
      const parsed = JSON.parse(userRaw) as { authType?: string };
      if (parsed?.authType === "s3_session") {
        const endpoint = localStorage.getItem("s3SessionEndpoint");
        if (endpoint) {
          config.headers = config.headers ?? {};
          config.headers["X-S3-Endpoint"] = endpoint;
        }
      }
    } catch (err) {
      console.warn("Unable to parse stored user payload", err);
    }
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
        const token = await refreshAccessToken();
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
