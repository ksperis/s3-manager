/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  getBucketAcl,
  updateBucketAcl,
} from "../../../api/buckets";
import type { BucketAcl } from "../../../api/bucketContracts";
import {
  getCephAdminBucketAcl,
  updateCephAdminBucketAcl,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { stableBucketJsonSignature } from "./bucketFeatureState";

type UseBucketAclControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

type AclDraft = {
  custom: string;
  preset: string;
};

const privateDraft: AclDraft = { custom: "", preset: "private" };

export const bucketAclOptions = [
  { value: "private", label: "Private (bucket owner full control)" },
  { value: "public-read", label: "Public read" },
  { value: "public-read-write", label: "Public read/write" },
  { value: "authenticated-read", label: "Authenticated users read" },
  { value: "bucket-owner-read", label: "Bucket owner read" },
  { value: "bucket-owner-full-control", label: "Bucket owner full control" },
  { value: "log-delivery-write", label: "Log delivery write" },
  { value: "custom", label: "Custom canned ACL" },
];

function inferPreset(acl?: BucketAcl | null): string {
  if (!acl?.grants?.length) return "private";
  const allUsersUri = "http://acs.amazonaws.com/groups/global/AllUsers";
  const authenticatedUsersUri =
    "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
  const allUsersPermissions = new Set(
    acl.grants
      .filter((grant) => grant.grantee?.uri === allUsersUri)
      .map((grant) => grant.permission),
  );
  const authenticatedUsersPermissions = new Set(
    acl.grants
      .filter((grant) => grant.grantee?.uri === authenticatedUsersUri)
      .map((grant) => grant.permission),
  );
  if (
    allUsersPermissions.has("READ") &&
    allUsersPermissions.has("WRITE")
  ) {
    return "public-read-write";
  }
  if (allUsersPermissions.has("READ")) return "public-read";
  if (authenticatedUsersPermissions.has("READ")) return "authenticated-read";
  if (
    acl.grants.length === 1 &&
    acl.grants[0]?.grantee.type === "CanonicalUser" &&
    acl.grants[0]?.permission === "FULL_CONTROL"
  ) {
    return "private";
  }
  return "custom";
}

function signature(draft: AclDraft): string {
  return stableBucketJsonSignature({
    custom: draft.custom.trim(),
    preset: draft.preset.trim(),
  });
}

export function useBucketAclController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketAclControllerOptions) {
  const [acl, setAcl] = useState<BucketAcl | null>(null);
  const [draft, setDraft] = useState<AclDraft>(privateDraft);
  const [snapshot, setSnapshot] = useState<AclDraft>(privateDraft);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyLoaded = useCallback((next?: BucketAcl | null) => {
    const loadedDraft = { custom: "", preset: inferPreset(next) };
    setAcl(next ?? null);
    setDraft(loadedDraft);
    setSnapshot(loadedDraft);
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyLoaded();
      setError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketAcl(endpointId, bucketName)
          : null
        : await getBucketAcl(accountId, bucketName);
      applyLoaded(data);
    } catch (loadError) {
      applyLoaded();
      setError(extractApiError(loadError, "Unable to load bucket ACL."));
    } finally {
      setLoading(false);
    }
  }, [accountId, applyLoaded, bucketName, cephAdmin, enabled, endpointId]);

  const updatePreset = (preset: string) => {
    setDraft((current) => ({ ...current, preset }));
    setError(null);
    setStatus(null);
  };

  const updateCustom = (custom: string) => {
    setDraft((current) => ({ ...current, custom }));
    setError(null);
    setStatus(null);
  };

  const save = async () => {
    if (!bucketName || !enabled) return;
    const aclValue =
      draft.preset === "custom" ? draft.custom.trim() : draft.preset;
    if (!aclValue) {
      setError("ACL value is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const updated = cephAdmin
        ? endpointId
          ? await updateCephAdminBucketAcl(endpointId, bucketName, aclValue)
          : null
        : await updateBucketAcl(accountId, bucketName, aclValue);
      setAcl(updated);

      const savedDraft = {
        custom: draft.preset === "custom" ? aclValue : "",
        preset: draft.preset,
      };
      setDraft(savedDraft);
      setSnapshot(savedDraft);
      setStatus("Bucket ACL updated.");
    } catch (saveError) {
      setError(extractApiError(saveError, "Unable to update bucket ACL."));
    } finally {
      setSaving(false);
    }
  };

  return {
    acl,
    configured: inferPreset(acl) !== "private",
    custom: draft.custom,
    dirty: signature(draft) !== signature(snapshot),
    error,
    load,
    loading,
    preset: draft.preset,
    save,
    saving,
    status,
    updateCustom,
    updatePreset,
  };
}
