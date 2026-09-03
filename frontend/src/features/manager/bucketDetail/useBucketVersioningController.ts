/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  getBucketVersioning,
  setBucketVersioning,
} from "../../../api/buckets";
import {
  getCephAdminBucketVersioning,
  setCephAdminBucketVersioning,
} from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";

type UseBucketVersioningControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function statusIsEnabled(status?: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === "enabled";
}

export function useBucketVersioningController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketVersioningControllerOptions) {
  const [status, setStatus] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyStatus = useCallback((next?: string | null) => {
    const normalized = next?.trim() || null;
    setStatus(normalized);
    setDraftEnabled(statusIsEnabled(normalized));
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyStatus(null);
      setLoadError(null);
      setSaveError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketVersioning(endpointId, bucketName)
          : { status: null }
        : await getBucketVersioning(accountId, bucketName);
      applyStatus(data.status ?? null);
    } catch (loadFailure) {
      applyStatus(null);
      setLoadError(
        extractApiError(loadFailure, "Unable to load bucket versioning."),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, applyStatus, bucketName, cephAdmin, enabled, endpointId]);

  const updateDraft = (value: boolean) => {
    setDraftEnabled(value);
    setSaveError(null);
  };

  const markEnabled = () => {
    applyStatus("Enabled");
    setLoadError(null);
    setSaveError(null);
  };

  const save = async (disableBlocked: boolean) => {
    if (!bucketName || !enabled || loading || loadError) return;
    if (disableBlocked && !draftEnabled) {
      setSaveError(
        "Versioning cannot be disabled while Object Lock is enabled.",
      );
      return;
    }
    const currentlyEnabled = statusIsEnabled(status);
    if (draftEnabled === currentlyEnabled) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await setCephAdminBucketVersioning(
          endpointId,
          bucketName,
          draftEnabled,
        );
      } else {
        await setBucketVersioning(accountId, bucketName, draftEnabled);
      }
      applyStatus(draftEnabled ? "Enabled" : "Suspended");
    } catch (saveFailure) {
      setSaveError(
        extractApiError(saveFailure, "Failed to update versioning."),
      );
    } finally {
      setSaving(false);
    }
  };

  const normalizedStatus = (status ?? "").trim().toLowerCase();
  const isEnabled = normalizedStatus === "enabled";
  return {
    dirty: draftEnabled !== isEnabled,
    draftEnabled,
    isEnabled,
    isSuspended: normalizedStatus === "suspended",
    load,
    loadError,
    loading,
    markEnabled,
    save,
    saveError,
    saving,
    status,
    updateDraft,
  };
}
