/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const client = axios.create({
  baseURL: API_BASE_URL,
});

function handleAuthRedirect() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  const url = config.url ?? "";
  if (url.startsWith("/manager")) {
    const accountId = localStorage.getItem("selectedS3AccountId");
    if (accountId) {
      const mode = localStorage.getItem(`managerAccessMode:${accountId}`);
      if (mode === "admin" || mode === "portal") {
        config.headers = config.headers ?? {};
        config.headers["X-Manager-Access-Mode"] = mode;
      }
    }
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 419) {
      handleAuthRedirect();
    }
    return Promise.reject(error);
  },
);

export default client;
