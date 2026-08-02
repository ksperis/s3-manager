/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ExecutionContext } from "../../api/executionContexts";
import { S3Account } from "../../api/accounts";

type AccountLike = ExecutionContext | S3Account;

function isExecutionContext(value: AccountLike): value is ExecutionContext {
  return "display_name" in value;
}

function isDefaultStorageEndpoint(context: AccountLike): boolean {
  // User-scoped connections are always explicit targets and should display their endpoint.
  if (isExecutionContext(context) && context.kind === "connection") return false;
  const explicitDefault = isExecutionContext(context)
    ? context.endpoint_is_default
    : context.storage_endpoint_is_default;
  if (explicitDefault != null) return explicitDefault;
  return isExecutionContext(context)
    ? context.endpoint_id == null
    : context.storage_endpoint_id == null;
}

function getStorageSuffix(context: AccountLike): string {
  if (isDefaultStorageEndpoint(context)) return "";
  const endpointName = isExecutionContext(context)
    ? context.endpoint_name || context.endpoint_url
    : context.storage_endpoint_name;
  const label = endpointName || "Custom endpoint";
  return ` (${label})`;
}

export function formatAccountLabel(
  context: AccountLike,
  includeContextBadge = true
): string {
  const isLegacyUser = isExecutionContext(context)
    ? context.kind === "legacy_user"
    : context.is_s3_user;
  const isConnection = isExecutionContext(context) && context.kind === "connection";
  const badge = includeContextBadge
    ? isConnection
      ? " · Connection"
      : isLegacyUser
        ? " · S3 user"
        : ""
    : "";
  const displayName = isExecutionContext(context) ? context.display_name : context.name;
  const base = `${displayName}${badge}`;
  return `${base}${getStorageSuffix(context)}`;
}
