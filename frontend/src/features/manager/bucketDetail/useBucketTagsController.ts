/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketTags,
  getBucketTags,
  putBucketTags,
} from "../../../api/bucketDetails";
import type { BucketTag } from "../../../api/bucketContracts";
import {
  deleteCephAdminBucketTags,
  getCephAdminBucketTags,
  putCephAdminBucketTags,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { createUiDraftId } from "../../../utils/uiDraftId";
import { stableBucketJsonSignature } from "./bucketFeatureState";

type BucketTagDraft = BucketTag & { uiId: string };

type UseBucketTagsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function createDraft(tag: BucketTag = { key: "", value: "" }): BucketTagDraft {
  return { ...tag, uiId: createUiDraftId("bucket-tag") };
}

function normalize(tags: BucketTag[]): BucketTag[] {
  return tags
    .map((tag) => ({
      key: String(tag.key ?? "").trim(),
      value: String(tag.value ?? "").trim(),
    }))
    .sort((left, right) => {
      const keyOrder = left.key.localeCompare(right.key);
      return keyOrder !== 0 ? keyOrder : left.value.localeCompare(right.value);
    });
}

export function useBucketTagsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketTagsControllerOptions) {
  const [tags, setTags] = useState<BucketTagDraft[]>([]);
  const [snapshot, setSnapshot] = useState<BucketTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const apply = useCallback((next: BucketTag[]) => {
    const normalized = next
      .map((tag) => ({
        key: String(tag.key ?? "").trim(),
        value: String(tag.value ?? ""),
      }))
      .filter((tag) => tag.key.length > 0);
    setTags(normalized.map(createDraft));
    setSnapshot(normalized);
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply([]);
      setError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const response = cephAdmin
        ? endpointId
          ? await getCephAdminBucketTags(endpointId, bucketName)
          : { tags: [] }
        : await getBucketTags(accountId, bucketName);
      apply(response.tags ?? []);
    } catch (loadError) {
      apply([]);
      setError(extractApiError(loadError, "Unable to load bucket tags."));
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const clearFeedback = () => {
    setError(null);
    setStatus(null);
  };

  const add = () => {
    setTags((current) => [...current, createDraft()]);
    clearFeedback();
  };

  const remove = (uiId: string) => {
    setTags((current) => current.filter((tag) => tag.uiId !== uiId));
    clearFeedback();
  };

  const update = (uiId: string, patch: Partial<BucketTag>) => {
    setTags((current) =>
      current.map((tag) => (tag.uiId === uiId ? { ...tag, ...patch } : tag)),
    );
    clearFeedback();
  };

  const save = async () => {
    if (!bucketName || !enabled) return;
    setSaving(true);
    clearFeedback();
    try {
      const normalized = tags.map((tag) => ({
        key: String(tag.key ?? "").trim(),
        value: String(tag.value ?? "").trim(),
      }));
      if (normalized.some((tag) => !tag.key && tag.value.length > 0)) {
        throw new Error("Tag key is required when a value is provided.");
      }
      const filtered = normalized.filter((tag) => tag.key.length > 0);
      const seen = new Set<string>();
      for (const tag of filtered) {
        if (seen.has(tag.key)) {
          throw new Error(`Duplicate tag key: ${tag.key}`);
        }
        seen.add(tag.key);
      }

      if (filtered.length === 0) {
        if (cephAdmin) {
          if (!endpointId) return;
          await deleteCephAdminBucketTags(endpointId, bucketName);
        } else {
          await deleteBucketTags(accountId, bucketName);
        }
        apply([]);
        setStatus("Bucket tags cleared.");
      } else {
        if (cephAdmin) {
          if (!endpointId) return;
          await putCephAdminBucketTags(endpointId, bucketName, filtered);
        } else {
          await putBucketTags(accountId, bucketName, filtered);
        }
        apply(filtered);
        setStatus("Bucket tags updated.");
      }
    } catch (saveError) {
      setError(extractApiError(saveError, "Unable to update bucket tags."));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!bucketName || !enabled) return;
    setClearing(true);
    clearFeedback();
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketTags(endpointId, bucketName);
      } else {
        await deleteBucketTags(accountId, bucketName);
      }
      apply([]);
      setStatus("Bucket tags cleared.");
    } catch (clearError) {
      setError(extractApiError(clearError, "Unable to clear bucket tags."));
    } finally {
      setClearing(false);
    }
  };

  return {
    add,
    clear,
    clearing,
    configured: tags.length > 0,
    dirty:
      stableBucketJsonSignature(normalize(tags)) !==
      stableBucketJsonSignature(normalize(snapshot)),
    error,
    load,
    loading,
    remove,
    save,
    saving,
    status,
    tags,
    update,
  };
}
