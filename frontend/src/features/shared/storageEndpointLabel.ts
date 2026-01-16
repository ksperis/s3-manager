/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchLoginSettings } from "../../api/appSettings";
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

function isDefaultStorageEndpoint(
  account: S3Account,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null
): boolean {
  // User-scoped connections are always explicit targets and should display their endpoint.
  if (account.id.startsWith("conn-")) return false;
  if (account.storage_endpoint_id == null) return true;
  if (defaultEndpointId !== null) {
    return Number(account.storage_endpoint_id) === defaultEndpointId;
  }
  if (defaultEndpointName) {
    return account.storage_endpoint_name === defaultEndpointName;
  }
  return (account.storage_endpoint_name ?? "").startsWith("Default");
}

export function getStorageSuffix(
  account: S3Account,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null
): string {
  if (isDefaultStorageEndpoint(account, defaultEndpointId, defaultEndpointName)) return "";
  const endpointName = account.storage_endpoint_name || account.storage_endpoint_url || "Custom endpoint";
  return ` (${endpointName})`;
}

export function formatAccountLabel(
  account: S3Account,
  defaultEndpointId: number | null,
  defaultEndpointName: string | null,
  includeS3UserBadge = true
): string {
  const isS3User = account.is_s3_user ?? account.id.startsWith("s3u-");
  const isConnection = account.id.startsWith("conn-");
  const badge = includeS3UserBadge
    ? isConnection
      ? " · Connection"
      : isS3User
        ? " · S3 user"
        : ""
    : "";
  const base = `${account.name}${badge}`;
  return `${base}${getStorageSuffix(account, defaultEndpointId, defaultEndpointName)}`;
}
