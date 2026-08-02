/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CredentialOwnerType } from "../../api/connections";

type S3ConnectionOwnerDefaults = {
  ownerType: CredentialOwnerType;
  ownerIdentifier: string;
};

const accessKeySuffix = (accessKey: string): string => accessKey.trim().slice(-4);

const withAccessKeySuffix = (base: string, accessKey: string): string => {
  const normalizedBase = base.trim() || "connection";
  const suffix = accessKeySuffix(accessKey);
  return suffix ? `${normalizedBase}-${suffix}` : normalizedBase;
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
