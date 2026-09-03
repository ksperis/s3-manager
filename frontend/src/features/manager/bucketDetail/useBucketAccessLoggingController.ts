/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketLogging,
  getBucketLogging,
  putBucketLogging,
} from "../../../api/buckets";
import type { BucketLoggingConfiguration } from "../../../api/bucketContracts";
import {
  deleteCephAdminBucketLogging,
  getCephAdminBucketLogging,
  putCephAdminBucketLogging,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import {
  normalizeAccessLoggingDraft,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketAccessLoggingControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export function useBucketAccessLoggingController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketAccessLoggingControllerOptions) {
  const [config, setConfig] = useState<BucketLoggingConfiguration | null>(null);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [targetBucket, setTargetBucket] = useState("");
  const [targetPrefix, setTargetPrefix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const apply = useCallback((next?: BucketLoggingConfiguration | null) => {
    setConfig(next ?? null);
    if (!next?.enabled) {
      setLoggingEnabled(false);
      setTargetBucket("");
      setTargetPrefix("");
      return;
    }
    setLoggingEnabled(true);
    setTargetBucket(next.target_bucket ?? "");
    setTargetPrefix(next.target_prefix ?? "");
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply(null);
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
          ? await getCephAdminBucketLogging(endpointId, bucketName)
          : { enabled: false }
        : await getBucketLogging(accountId, bucketName);
      apply(data);
    } catch (loadError) {
      apply(null);
      setError(
        extractApiError(loadError, "Unable to load bucket access logging."),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const save = async () => {
    if (!bucketName || !enabled) return;
    setError(null);
    setStatus(null);
    if (loggingEnabled && !targetBucket.trim()) {
      setError("Target bucket is required to enable access logging.");
      return;
    }
    setSaving(true);
    try {
      const payload: BucketLoggingConfiguration = {
        enabled: loggingEnabled,
        target_bucket: targetBucket.trim() || null,
        target_prefix: targetPrefix.trim() || null,
      };
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketLogging(endpointId, bucketName, payload)
          : payload
        : await putBucketLogging(accountId, bucketName, payload);
      apply(saved);
      setStatus(
        loggingEnabled
          ? "Access logging updated."
          : "Access logging disabled.",
      );
    } catch (saveError) {
      setError(extractApiError(saveError, "Unable to update access logging."));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!bucketName || !enabled) return;
    setClearing(true);
    setError(null);
    setStatus(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketLogging(endpointId, bucketName);
      } else {
        await deleteBucketLogging(accountId, bucketName);
      }
      apply({ enabled: false });
      setStatus("Access logging disabled.");
    } catch (clearError) {
      setError(
        extractApiError(clearError, "Unable to disable access logging."),
      );
    } finally {
      setClearing(false);
    }
  };

  const clearFeedback = () => {
    setStatus(null);
    setError(null);
  };
  const updateEnabled = (value: boolean) => {
    setLoggingEnabled(value);
    clearFeedback();
  };
  const updateTargetBucket = (value: string) => {
    setTargetBucket(value);
    clearFeedback();
  };
  const updateTargetPrefix = (value: string) => {
    setTargetPrefix(value);
    clearFeedback();
  };
  const configured = Boolean(
    config?.enabled && (config.target_bucket ?? "").trim(),
  );
  const draftSignature = stableBucketJsonSignature(
    normalizeAccessLoggingDraft({
      enabled: loggingEnabled,
      target_bucket: targetBucket,
      target_prefix: targetPrefix,
    }),
  );
  const snapshotSignature = stableBucketJsonSignature(
    normalizeAccessLoggingDraft(config),
  );
  return {
    clear,
    clearing,
    configured,
    dirty: draftSignature !== snapshotSignature,
    error,
    load,
    loading,
    loggingEnabled,
    save,
    saving,
    status,
    targetBucket,
    targetPrefix,
    updateEnabled,
    updateTargetBucket,
    updateTargetPrefix,
  };
}
