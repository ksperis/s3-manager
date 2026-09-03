/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketNotifications,
  getBucketNotifications,
  putBucketNotifications,
} from "../../../api/bucketDetails";
import {
  deleteCephAdminBucketNotifications,
  getCephAdminBucketNotifications,
  putCephAdminBucketNotifications,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import {
  jsonTextSignature,
  normalizeNotificationConfiguration,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type UseBucketNotificationsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export const defaultNotificationTemplate = '{\n  "TopicConfigurations": []\n}';

export function buildNotificationExample(accountId: string) {
  return `{
  "TopicConfigurations": [
    {
      "Id": "ObjectCreateAll",
      "TopicArn": "arn:aws:sns:default:${accountId}:example-topic",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            { "Name": "prefix", "Value": "uploads/" }
          ]
        }
      }
    }
  ]
}`;
}

export function useBucketNotificationsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketNotificationsControllerOptions) {
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [text, setText] = useState(defaultNotificationTemplate);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const apply = useCallback((configuration: unknown) => {
    const normalized = normalizeNotificationConfiguration(configuration);
    setSnapshot(normalized);
    setText(
      Object.keys(normalized).length
        ? JSON.stringify(normalized, null, 2)
        : defaultNotificationTemplate,
    );
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply({});
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
          ? await getCephAdminBucketNotifications(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketNotifications(accountId, bucketName);
      apply(data.configuration ?? {});
    } catch (loadError) {
      apply({});
      setError(
        extractApiError(loadError, "Unable to load bucket notifications."),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const save = async () => {
    if (!bucketName || !enabled) return;
    setError(null);
    setStatus(null);
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
    } catch {
      setError("Notifications must be valid JSON.");
      return;
    }
    setSaving(true);
    try {
      const configuration = parsed as Record<string, unknown>;
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketNotifications(
              endpointId,
              bucketName,
              configuration,
            )
          : { configuration }
        : await putBucketNotifications(accountId, bucketName, configuration);
      apply(saved.configuration ?? configuration);
      setStatus("Notifications updated.");
    } catch (saveError) {
      setError(
        extractApiError(saveError, "Unable to update bucket notifications."),
      );
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
        await deleteCephAdminBucketNotifications(endpointId, bucketName);
      } else {
        await deleteBucketNotifications(accountId, bucketName);
      }
      apply({});
      setStatus("Notifications cleared.");
    } catch (clearError) {
      setError(
        extractApiError(clearError, "Unable to delete bucket notifications."),
      );
    } finally {
      setClearing(false);
    }
  };

  const updateText = (value: string) => {
    setText(value);
    setStatus(null);
  };
  const normalizedSnapshot = normalizeNotificationConfiguration(snapshot);
  const draftSignature = jsonTextSignature(
    text,
    normalizedSnapshot,
    normalizeNotificationConfiguration,
  );
  return {
    clear,
    clearing,
    configured: Object.keys(normalizedSnapshot).length > 0,
    dirty:
      draftSignature.signature !==
      stableBucketJsonSignature(normalizedSnapshot),
    error,
    load,
    loading,
    save,
    saving,
    status,
    text,
    updateText,
  };
}
