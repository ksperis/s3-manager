/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchLoginSettings } from "../../api/appSettings";
import { ExecutionContext } from "../../api/executionContexts";
import { S3Account } from "../../api/accounts";

type DefaultEndpointInfo = {
  defaultEndpointId: number | null;
  defaultEndpointName: string | null;
};

export function useDefaultStorageEndpoint(): DefaultEndpointInfo {
  const [defaultEndpointId, setDefaultEndpointId] = useState<number | null>(null);
  const [defaultEndpointName, setDefaultEndpointName] = useState<string | null>("Default");

  useEffect(() => {
    let isMounted = true;
    fetchLoginSettings()
      .then((settings) => {
        if (!isMounted) return;
        const defaultEndpoint = settings.endpoints.find((endpoint) => endpoint.is_default);
        setDefaultEndpointId(defaultEndpoint?.id ?? null);
        setDefaultEndpointName(defaultEndpoint?.name ?? (settings.endpoints.length > 0 ? null : "Default"));
      })
      .catch(() => {
        if (!isMounted) return;
        setDefaultEndpointId(null);
        setDefaultEndpointName("Default");
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { defaultEndpointId, defaultEndpointName };
}

type AccountLike = ExecutionContext | S3Account;

function isExecutionContext(value: AccountLike): value is ExecutionContext {
  return "display_name" in value;
}

function isDefaultStorageEndpoint(
  context: AccountLike,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null
): boolean {
  // User-scoped connections are always explicit targets and should display their endpoint.
  if ((isExecutionContext(context) && context.kind === "connection") || context.id.startsWith("conn-")) return false;
  if (isExecutionContext(context) ? context.endpoint_id == null : context.storage_endpoint_id == null) return true;
  if (defaultEndpointId !== null) {
    const endpointId = isExecutionContext(context) ? context.endpoint_id : context.storage_endpoint_id;
    return Number(endpointId) === defaultEndpointId;
  }
  if (defaultEndpointName) {
    const endpointName = isExecutionContext(context) ? context.endpoint_name : context.storage_endpoint_name;
    return endpointName === defaultEndpointName;
  }
  const fallbackName = isExecutionContext(context) ? context.endpoint_name : context.storage_endpoint_name;
  return (fallbackName ?? "").startsWith("Default");
}

export function getStorageSuffix(
  context: AccountLike,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null
): string {
  if (isDefaultStorageEndpoint(context, defaultEndpointId, defaultEndpointName)) return "";
  const endpointName = isExecutionContext(context)
    ? context.endpoint_name || context.endpoint_url
    : context.storage_endpoint_name || context.storage_endpoint_url;
  const label = endpointName || "Custom endpoint";
  return ` (${label})`;
}

export function formatAccountLabel(
  context: AccountLike,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null,
  includeS3UserBadge = true
): string {
  const isLegacyUser = isExecutionContext(context)
    ? context.kind === "legacy_user"
    : context.is_s3_user ?? context.id.startsWith("s3u-");
  const isConnection = (isExecutionContext(context) && context.kind === "connection") || context.id.startsWith("conn-");
  const badge = includeS3UserBadge
    ? isConnection
      ? " · Connection"
      : isLegacyUser
        ? " · S3 user"
        : ""
    : "";
  const displayName = isExecutionContext(context) ? context.display_name : context.name;
  const base = `${displayName}${badge}`;
  return `${base}${getStorageSuffix(context, defaultEndpointId, defaultEndpointName)}`;
}
