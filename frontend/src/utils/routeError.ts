/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { isRouteErrorResponse } from "react-router-dom";
import type { GeneralSettings } from "../api/appSettings";
import { readStoredUser, resolvePostLoginPath } from "./workspaces";

const BACKEND_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export type RouteErrorKind = "backend_unavailable" | "generic";

function hasBackendUnavailableStatus(status: unknown): boolean {
  return typeof status === "number" && BACKEND_UNAVAILABLE_STATUSES.has(status);
}

function isBackendUnavailableMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const normalized = message.trim().toLowerCase();
  return normalized === "network error" || normalized === "failed to fetch";
}

export function classifyRouteError(error: unknown): RouteErrorKind {
  if (isRouteErrorResponse(error) && hasBackendUnavailableStatus(error.status)) {
    return "backend_unavailable";
  }

  if (axios.isAxiosError(error)) {
    if (hasBackendUnavailableStatus(error.response?.status)) {
      return "backend_unavailable";
    }
    if (!error.response) {
      return "backend_unavailable";
    }
  }

  if (error instanceof Error && isBackendUnavailableMessage(error.message)) {
    return "backend_unavailable";
  }

  if (error && typeof error === "object") {
    const maybeStatus = "status" in error ? error.status : undefined;
    if (hasBackendUnavailableStatus(maybeStatus)) {
      return "backend_unavailable";
    }
    const maybeMessage = "message" in error ? error.message : undefined;
    if (isBackendUnavailableMessage(maybeMessage)) {
      return "backend_unavailable";
    }
  }

  return "generic";
}

export function resolveRouteErrorHomePath(generalSettings: GeneralSettings): string {
  const nextPath = resolvePostLoginPath(readStoredUser(), generalSettings);
  if (nextPath === "/login" || nextPath === "/unauthorized") {
    return "/login";
  }
  return nextPath;
}
