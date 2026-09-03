/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketEncryption,
  getBucketEncryption,
  putBucketEncryption,
} from "../../../api/buckets";
import {
  deleteCephAdminBucketEncryption,
  getCephAdminBucketEncryption,
  putCephAdminBucketEncryption,
} from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketEncryptionControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export const defaultEncryptionExample = `[
  {
    "ApplyServerSideEncryptionByDefault": {
      "SSEAlgorithm": "AES256"
    }
  }
]`;

export function useBucketEncryptionController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketEncryptionControllerOptions) {
  const [rules, setRules] = useState<Record<string, unknown>[] | null>(null);
  const [text, setText] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      setRules(null);
      setText("[]");
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
          ? await getCephAdminBucketEncryption(endpointId, bucketName)
          : { rules: [] }
        : await getBucketEncryption(accountId, bucketName);
      const loadedRules = data.rules ?? [];
      setRules(loadedRules);
      setText(loadedRules.length ? JSON.stringify(loadedRules, null, 2) : "[]");
    } catch (loadError) {
      setRules(null);
      setText("[]");
      setError(
        extractApiError(
          loadError,
          "Unable to load bucket encryption settings.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const save = async () => {
    if (!bucketName || !enabled) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const parsed = text.trim() ? JSON.parse(text) : [];
      if (!Array.isArray(parsed)) throw new Error();
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketEncryption(endpointId, bucketName, parsed)
          : { rules: parsed }
        : await putBucketEncryption(accountId, bucketName, parsed);
      const savedRules = saved.rules ?? parsed;
      setRules(savedRules);
      setText(savedRules.length ? JSON.stringify(savedRules, null, 2) : "[]");
      setStatus(
        savedRules.length
          ? "Bucket encryption updated."
          : "Bucket encryption disabled.",
      );
    } catch {
      setError(
        "Invalid or unsaved bucket encryption configuration (JSON array required).",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!bucketName || !enabled) return;
    setDeleting(true);
    setError(null);
    setStatus(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketEncryption(endpointId, bucketName);
      } else {
        await deleteBucketEncryption(accountId, bucketName);
      }
      setRules([]);
      setText("[]");
      setStatus("Bucket encryption disabled.");
    } catch (removeError) {
      setError(
        extractApiError(removeError, "Unable to disable bucket encryption."),
      );
    } finally {
      setDeleting(false);
    }
  };

  const rulesValue = rules ?? [];
  const dirty =
    jsonTextSignature(text, rulesValue).signature !==
    stableBucketJsonSignature(rulesValue);
  return {
    clearStatus: () => setStatus(null),
    configured: rulesValue.length > 0,
    deleting,
    dirty,
    error,
    load,
    loading,
    remove,
    save,
    saving,
    setText,
    status,
    text,
  };
}
