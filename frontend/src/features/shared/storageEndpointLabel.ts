/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ExecutionContext } from "../../api/executionContexts";

type StoredAccount = {
  name: string;
  storage_endpoint_name: string;
  storage_endpoint_is_default: boolean;
};

type AccountLike = ExecutionContext | StoredAccount;

function isExecutionContext(value: AccountLike): value is ExecutionContext {
  return "display_name" in value;
}

function isDefaultStorageEndpoint(context: AccountLike): boolean {
  // User-scoped connections are always explicit targets and should display their endpoint.
  if (isExecutionContext(context) && context.kind === "connection") return false;
  return isExecutionContext(context)
    ? context.endpoint_is_default
    : context.storage_endpoint_is_default;
}

function getStorageSuffix(context: AccountLike): string {
  if (isDefaultStorageEndpoint(context)) return "";
  const endpointName = isExecutionContext(context)
    ? context.endpoint_name
    : context.storage_endpoint_name;
  const label = endpointName || "Custom endpoint";
  return ` (${label})`;
}

export function formatAccountLabel(
  context: AccountLike,
  includeContextBadge = true
): string {
  const isS3User = isExecutionContext(context) && context.kind === "s3_user";
  const isConnection = isExecutionContext(context) && context.kind === "connection";
  const badge = includeContextBadge
    ? isConnection
      ? " · Connection"
      : isS3User
        ? " · S3 user"
        : ""
    : "";
  const displayName = isExecutionContext(context) ? context.display_name : context.name;
  const base = `${displayName}${badge}`;
  return `${base}${getStorageSuffix(context)}`;
}
