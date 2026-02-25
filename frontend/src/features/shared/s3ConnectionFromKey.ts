/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ExecutionContext } from "../../api/executionContexts";

export type S3ConnectionOwnerDefaults = {
  ownerType: string;
  ownerIdentifier: string;
};

export const accessKeySuffix = (accessKey: string): string => accessKey.trim().slice(-4);

export const withAccessKeySuffix = (base: string, accessKey: string): string => {
  const normalizedBase = base.trim() || "connection";
  const suffix = accessKeySuffix(accessKey);
  return suffix ? `${normalizedBase}-${suffix}` : normalizedBase;
};

export const buildManagerConnectionDefaults = (
  context: ExecutionContext | undefined,
  principalName: string,
  accessKey: string
): {
  name: string;
  endpointId: number | null;
  endpointUrl: string | null;
  owner: S3ConnectionOwnerDefaults;
} => {
  const principal = principalName.trim() || "user";
  const accountId = context?.rgw_account_id?.trim() || "";
  const ownerType = accountId ? "account_user" : "iam_user";
  const ownerIdentifier = accountId ? `${accountId}:${principal}` : `iam:${principal}`;
  return {
    name: `iam-${withAccessKeySuffix(principal, accessKey)}`,
    endpointId: context?.endpoint_id ?? null,
    endpointUrl: context?.endpoint_url ?? null,
    owner: {
      ownerType,
      ownerIdentifier,
    },
  };
};

export const buildCephConnectionDefaults = (
  uid: string,
  accessKey: string,
  options?: { accountId?: string | null; tenant?: string | null }
): {
  name: string;
  owner: S3ConnectionOwnerDefaults;
} => {
  const normalizedUid = uid.trim() || "user";
  const accountId = options?.accountId?.trim() || "";
  const tenant = options?.tenant?.trim() || "";
  const ownerType = accountId ? "account_user" : "s3_user";
  const ownerIdentifier = accountId || (tenant ? `${tenant}$${normalizedUid}` : normalizedUid);
  return {
    name: `ceph-${withAccessKeySuffix(normalizedUid, accessKey)}`,
    owner: {
      ownerType,
      ownerIdentifier,
    },
  };
};
