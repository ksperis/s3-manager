/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketPolicyApi,
  getBucketPolicy,
  putBucketPolicy,
} from "../../../api/buckets";
import {
  deleteCephAdminBucketPolicy,
  getCephAdminBucketPolicy,
  putCephAdminBucketPolicy,
} from "../../../api/cephAdmin";
import { extractApiError } from "../../../utils/apiError";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketPolicyControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export function buildPolicyExample(bucketName?: string) {
  return `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${bucketName || "bucket"}/*"
    }
  ]
}`;
}

export function useBucketPolicyController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketPolicyControllerOptions) {
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      setPolicy(null);
      setText("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketPolicy(endpointId, bucketName)
          : { policy: null }
        : await getBucketPolicy(accountId, bucketName);
      setPolicy(data.policy);
      setText(data.policy ? JSON.stringify(data.policy, null, 2) : "");
    } catch (loadError) {
      setError(extractApiError(loadError, "Unable to load the bucket policy."));
      setPolicy(null);
      setText("");
    } finally {
      setLoading(false);
    }
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const save = async () => {
    if (!bucketName || !enabled) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = text.trim() ? JSON.parse(text) : {};
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketPolicy(endpointId, bucketName, parsed)
          : { policy: parsed }
        : await putBucketPolicy(accountId, bucketName, parsed);
      const savedPolicy = saved.policy ?? parsed;
      setPolicy(savedPolicy);
      setText(JSON.stringify(savedPolicy, null, 2));
    } catch {
      setError("Invalid or unsaved policy (JSON required).");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!bucketName || !enabled) return;
    setDeleting(true);
    setError(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketPolicy(endpointId, bucketName);
      } else {
        await deleteBucketPolicyApi(accountId, bucketName);
      }
      setPolicy(null);
      setText("");
    } catch (removeError) {
      setError(
        extractApiError(removeError, "Unable to delete the bucket policy."),
      );
    } finally {
      setDeleting(false);
    }
  };

  const policyValue = policy ?? {};
  const configured = Boolean(Object.keys(policyValue).length);
  const snapshotSignature = stableBucketJsonSignature(policyValue);
  const draftSignature = jsonTextSignature(text, policyValue);
  const dirty = draftSignature.signature !== snapshotSignature;
  return {
    configured,
    deleting,
    dirty,
    error,
    load,
    loading,
    remove,
    save,
    saving,
    setText,
    text,
  };
}
