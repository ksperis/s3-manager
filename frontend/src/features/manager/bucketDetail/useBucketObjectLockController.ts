/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  getBucketObjectLock,
  setBucketVersioning,
  updateBucketObjectLock,
} from "../../../api/buckets";
import type { BucketObjectLockConfiguration } from "../../../api/bucketContracts";
import {
  getCephAdminBucketObjectLock,
  setCephAdminBucketVersioning,
  updateCephAdminBucketObjectLock,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { stableBucketJsonSignature } from "./bucketFeatureState";

type ObjectLockDraft = {
  days: string;
  enabled: boolean | null;
  mode: string;
  years: string;
};

type UseBucketObjectLockControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
  onVersioningEnabled: () => void;
  versioningEnabled: boolean;
};

const emptyDraft: ObjectLockDraft = {
  days: "",
  enabled: null,
  mode: "",
  years: "",
};

function configurationToDraft(
  config?: BucketObjectLockConfiguration | null,
): ObjectLockDraft {
  if (!config) return emptyDraft;
  return {
    days: config.days != null ? String(config.days) : "",
    enabled: config.enabled ?? null,
    mode: config.mode ?? "",
    years: config.years != null ? String(config.years) : "",
  };
}

function signature(draft: ObjectLockDraft): string {
  return stableBucketJsonSignature({
    days: draft.days.trim(),
    enabled: draft.enabled,
    mode: draft.mode.trim(),
    years: draft.years.trim(),
  });
}

export function useBucketObjectLockController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
  onVersioningEnabled,
  versioningEnabled,
}: UseBucketObjectLockControllerOptions) {
  const [configuration, setConfiguration] =
    useState<BucketObjectLockConfiguration | null>(null);
  const [draft, setDraft] = useState<ObjectLockDraft>(emptyDraft);
  const [snapshot, setSnapshot] = useState<ObjectLockDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((next?: BucketObjectLockConfiguration | null) => {
    const normalized = configurationToDraft(next);
    setConfiguration(next ?? null);
    setDraft(normalized);
    setSnapshot(normalized);
  }, []);

  const reset = () => {
    setDraft(snapshot);
    setError(null);
    setStatus(null);
  };

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply();
      setLoadError(null);
      setError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketObjectLock(endpointId, bucketName)
          : null
        : await getBucketObjectLock(accountId, bucketName);
      apply(data);
    } catch (loadFailure) {
      apply();
      setLoadError(
        extractApiError(
          loadFailure,
          "Unable to load Object Lock configuration.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const update = <Key extends keyof ObjectLockDraft>(
    key: Key,
    value: ObjectLockDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setStatus(null);
  };

  const persistentlyEnabled = configuration?.enabled === true;
  const updateEnabled = (value: boolean) => {
    if (persistentlyEnabled) return;
    update("enabled", value);
  };

  const save = async () => {
    if (!bucketName || !enabled || loading || loadError) return;
    setSaving(true);
    setStatus(null);
    setError(null);

    const parsedDays = draft.days.trim() === "" ? null : Number(draft.days);
    const parsedYears = draft.years.trim() === "" ? null : Number(draft.years);
    if (
      (parsedDays !== null && Number.isNaN(parsedDays)) ||
      (parsedYears !== null && Number.isNaN(parsedYears))
    ) {
      setError("Invalid default retention values.");
      setSaving(false);
      return;
    }
    if (parsedDays !== null && parsedYears !== null) {
      setError("Choose days or years, not both.");
      setSaving(false);
      return;
    }
    if ((parsedDays !== null || parsedYears !== null) && !draft.mode) {
      setError("Mode is required to define the default retention.");
      setSaving(false);
      return;
    }
    if (draft.mode && parsedDays === null && parsedYears === null) {
      setError(
        "Provide a duration (days or years) or clear the mode to remove the rule.",
      );
      setSaving(false);
      return;
    }

    try {
      if (draft.enabled === true && !versioningEnabled) {
        if (cephAdmin) {
          if (!endpointId) {
            setError("Select a Ceph endpoint before saving Object Lock.");
            return;
          }
          await setCephAdminBucketVersioning(endpointId, bucketName, true);
        } else {
          await setBucketVersioning(accountId, bucketName, true);
        }
        onVersioningEnabled();
      }

      const payload: BucketObjectLockConfiguration = {
        days: parsedDays,
        enabled: draft.enabled,
        mode: draft.mode || null,
        years: parsedYears,
      };
      const updated = cephAdmin
        ? endpointId
          ? await updateCephAdminBucketObjectLock(endpointId, bucketName, payload)
          : null
        : await updateBucketObjectLock(accountId, bucketName, payload);
      if (!updated) {
        setError("Unable to update the Object Lock configuration.");
        return;
      }
      apply(updated);
      setStatus("Object Lock updated");
    } catch (saveFailure) {
      setError(
        extractApiError(
          saveFailure,
          "Unable to update the Object Lock configuration.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    active: draft.enabled === true || persistentlyEnabled,
    configuration,
    days: draft.days,
    dirty: signature(draft) !== signature(snapshot),
    enabled: draft.enabled,
    error,
    load,
    loadError,
    loading,
    mode: draft.mode,
    persistentlyEnabled,
    reset,
    save,
    saving,
    status,
    updateDays: (value: string) => update("days", value),
    updateEnabled,
    updateMode: (value: string) => update("mode", value),
    updateYears: (value: string) => update("years", value),
    years: draft.years,
  };
}
