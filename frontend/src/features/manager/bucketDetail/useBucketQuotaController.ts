/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import { updateBucketQuota } from "../../../api/bucketDetails";
import type { BucketQuotaUpdate } from "../../../api/bucketContracts";
import { updateCephAdminBucketQuota } from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";

export type BucketQuotaUnit = "MiB" | "GiB" | "TiB";

type BucketQuotaDraft = {
  maxObjects: string;
  maxSize: string;
  unit: BucketQuotaUnit;
};

type UseBucketQuotaControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  editable: boolean;
  enabled: boolean;
  endpointId?: number | null;
  maxObjects?: number | null;
  maxSizeBytes?: number | null;
  onSaved: () => Promise<void> | void;
};

const emptyDraft: BucketQuotaDraft = {
  maxObjects: "",
  maxSize: "",
  unit: "GiB",
};

function quotaToDraft(
  maxSizeBytes?: number | null,
  maxObjects?: number | null,
): BucketQuotaDraft {
  const sizeInGiB =
    maxSizeBytes != null && maxSizeBytes > 0
      ? maxSizeBytes / 1024 ** 3
      : null;
  return {
    maxObjects: maxObjects != null && maxObjects > 0 ? String(maxObjects) : "",
    maxSize:
      sizeInGiB == null
        ? ""
        : sizeInGiB % 1 === 0
          ? String(sizeInGiB)
          : sizeInGiB.toFixed(1),
    unit: "GiB",
  };
}

function normalizedDraft(draft: BucketQuotaDraft): BucketQuotaDraft {
  return {
    maxObjects: draft.maxObjects.trim(),
    maxSize: draft.maxSize.trim(),
    unit: draft.unit,
  };
}

function draftsMatch(left: BucketQuotaDraft, right: BucketQuotaDraft): boolean {
  const normalizedLeft = normalizedDraft(left);
  const normalizedRight = normalizedDraft(right);
  return (
    normalizedLeft.maxObjects === normalizedRight.maxObjects &&
    normalizedLeft.maxSize === normalizedRight.maxSize &&
    normalizedLeft.unit === normalizedRight.unit
  );
}

export function useBucketQuotaController({
  accountId,
  bucketName,
  cephAdmin,
  editable,
  enabled,
  endpointId,
  maxObjects,
  maxSizeBytes,
  onSaved,
}: UseBucketQuotaControllerOptions) {
  const [draft, setDraft] = useState<BucketQuotaDraft>(emptyDraft);
  const [snapshot, setSnapshot] = useState<BucketQuotaDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = enabled
      ? quotaToDraft(maxSizeBytes, maxObjects)
      : emptyDraft;
    setDraft(next);
    setSnapshot(next);
  }, [
    accountId,
    bucketName,
    cephAdmin,
    enabled,
    endpointId,
    maxObjects,
    maxSizeBytes,
  ]);

  useEffect(() => {
    setError(null);
    setStatus(null);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const update = (patch: Partial<BucketQuotaDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setStatus(null);
  };

  const save = async () => {
    if (!bucketName || !enabled || !editable || saving) return;
    if (cephAdmin && !endpointId) return;
    if (draftsMatch(draft, snapshot)) return;

    const normalized = normalizedDraft(draft);
    const parsedSize =
      normalized.maxSize === "" ? null : Number(normalized.maxSize);
    const parsedObjects =
      normalized.maxObjects === "" ? null : Number(normalized.maxObjects);
    if (
      (parsedSize !== null && (!Number.isFinite(parsedSize) || parsedSize < 0)) ||
      (parsedObjects !== null &&
        (!Number.isSafeInteger(parsedObjects) || parsedObjects < 0))
    ) {
      setError("Invalid quota values.");
      return;
    }

    const payload: BucketQuotaUpdate = {
      max_objects: parsedObjects ?? undefined,
      max_size_gb: parsedSize ?? undefined,
      max_size_unit: parsedSize != null ? normalized.unit : undefined,
    };
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await updateCephAdminBucketQuota(endpointId, bucketName, payload);
      } else {
        await updateBucketQuota(accountId, bucketName, payload);
      }
      setDraft(normalized);
      setSnapshot(normalized);
      setStatus("Quota updated");
      await onSaved();
    } catch (saveFailure) {
      setError(extractApiError(saveFailure, "Unable to update the quota."));
    } finally {
      setSaving(false);
    }
  };

  return {
    configured: snapshot.maxSize !== "" || snapshot.maxObjects !== "",
    dirty: !draftsMatch(draft, snapshot),
    error,
    maxObjects: draft.maxObjects,
    maxSize: draft.maxSize,
    save,
    saving,
    status,
    unit: draft.unit,
    updateMaxObjects: (value: string) => update({ maxObjects: value }),
    updateMaxSize: (value: string) => update({ maxSize: value }),
    updateUnit: (value: BucketQuotaUnit) => update({ unit: value }),
  };
}
