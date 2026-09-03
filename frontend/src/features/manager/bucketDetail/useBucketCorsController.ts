/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketCors,
  getBucketCors,
  putBucketCors,
} from "../../../api/buckets";
import {
  deleteCephAdminBucketCors,
  getCephAdminBucketCors,
  putCephAdminBucketCors,
} from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketCorsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export const defaultCorsExample = `[
  {
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedHeaders": ["*"]
  }
]`;

export function useBucketCorsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketCorsControllerOptions) {
  const [rules, setRules] = useState<Record<string, unknown>[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      setRules(null);
      setText("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketCors(endpointId, bucketName)
          : { rules: [] }
        : await getBucketCors(accountId, bucketName);
      const loadedRules = data.rules ?? [];
      setRules(loadedRules);
      setText(loadedRules.length ? JSON.stringify(loadedRules, null, 2) : "[]");
    } catch (loadError) {
      setError(
        extractApiError(loadError, "Unable to load the CORS configuration."),
      );
      setRules(null);
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
      const parsed = text.trim() ? JSON.parse(text) : [];
      if (!Array.isArray(parsed)) throw new Error();
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketCors(endpointId, bucketName, parsed)
          : { rules: parsed }
        : await putBucketCors(accountId, bucketName, parsed);
      const savedRules = saved.rules ?? parsed;
      setRules(savedRules);
      setText(JSON.stringify(savedRules, null, 2));
    } catch {
      setError("Invalid or unsaved CORS (JSON array required).");
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
        await deleteCephAdminBucketCors(endpointId, bucketName);
      } else {
        await deleteBucketCors(accountId, bucketName);
      }
      setRules([]);
      setText("[]");
    } catch (removeError) {
      setError(
        extractApiError(
          removeError,
          "Unable to delete the CORS configuration.",
        ),
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
    text,
  };
}
