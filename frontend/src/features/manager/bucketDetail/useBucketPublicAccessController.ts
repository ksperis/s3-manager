/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  getBucketPublicAccessBlock,
  updateBucketPublicAccessBlock,
  type BucketPublicAccessBlock,
} from "../../../api/buckets";
import {
  getCephAdminBucketPublicAccessBlock,
  updateCephAdminBucketPublicAccessBlock,
} from "../../../api/cephAdmin";
import { extractApiError } from "../../../utils/apiError";
import {
  normalizePublicAccessDraft,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketPublicAccessControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

const defaultPublicAccessBlock: BucketPublicAccessBlock = {
  block_public_acls: false,
  ignore_public_acls: false,
  block_public_policy: false,
  restrict_public_buckets: false,
};

const publicAccessKeys: (keyof BucketPublicAccessBlock)[] = [
  "block_public_acls",
  "ignore_public_acls",
  "block_public_policy",
  "restrict_public_buckets",
];

function normalize(config?: BucketPublicAccessBlock | null) {
  return {
    ...defaultPublicAccessBlock,
    block_public_acls: Boolean(config?.block_public_acls),
    ignore_public_acls: Boolean(config?.ignore_public_acls),
    block_public_policy: Boolean(config?.block_public_policy),
    restrict_public_buckets: Boolean(config?.restrict_public_buckets),
  };
}

export function useBucketPublicAccessController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketPublicAccessControllerOptions) {
  const [config, setConfig] = useState(() => normalize());
  const [snapshot, setSnapshot] = useState(() => normalize());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((next?: BucketPublicAccessBlock | null) => {
    const normalized = normalize(next);
    setConfig(normalized);
    setSnapshot(normalized);
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply();
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
          ? await getCephAdminBucketPublicAccessBlock(endpointId, bucketName)
          : defaultPublicAccessBlock
        : await getBucketPublicAccessBlock(accountId, bucketName);
      apply(data);
    } catch (loadError) {
      apply();
      setError(
        extractApiError(
          loadError,
          "Unable to load public access block settings.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const save = async () => {
    if (!bucketName || !enabled) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    const payload = normalize(config);
    try {
      const saved = cephAdmin
        ? endpointId
          ? await updateCephAdminBucketPublicAccessBlock(
              endpointId,
              bucketName,
              payload,
            )
          : payload
        : await updateBucketPublicAccessBlock(accountId, bucketName, payload);
      apply(saved);
      setStatus("Public access block updated.");
    } catch (saveError) {
      setError(
        extractApiError(saveError, "Unable to update public access block."),
      );
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof BucketPublicAccessBlock, value: boolean) => {
    setConfig((current) => normalize({ ...current, [key]: value }));
    setError(null);
    setStatus(null);
  };
  const fullyEnabled = publicAccessKeys.every((key) => config[key] === true);
  const partiallyEnabled =
    !fullyEnabled && publicAccessKeys.some((key) => config[key] === true);
  return {
    config,
    dirty:
      stableBucketJsonSignature(normalizePublicAccessDraft(config)) !==
      stableBucketJsonSignature(normalizePublicAccessDraft(snapshot)),
    error,
    fullyEnabled,
    load,
    loading,
    partiallyEnabled,
    save,
    saving,
    status,
    update,
  };
}
