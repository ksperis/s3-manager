/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  createBrowserBucket,
  ensureBucketCors,
} from "../../api/browser";
import type { BucketCorsStatus } from "../../api/browserContracts";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import {
  isValidS3BucketName,
  normalizeS3BucketName,
} from "../../utils/s3BucketName";
import { stableSignature } from "../../utils/stableSignature";

const INVALID_BUCKET_NAME_MESSAGE =
  "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.";

function createBucketSignature(name: string, versioning: boolean): string {
  return stableSignature({
    createBucketNameValue: name,
    createBucketVersioning: versioning,
  });
}

type UseBrowserCreateBucketOptions = {
  accountIdForApi: S3AccountSelector;
  currentBucketName: string;
  enabled: boolean;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
  uiOrigin?: string | null;
  onCreated: (bucketName: string) => Promise<void> | void;
  setCorsError: (message: string | null) => void;
  setCorsStatus: (status: BucketCorsStatus) => void;
  setStatusMessage: (message: string) => void;
};

export function useBrowserCreateBucket({
  accountIdForApi,
  currentBucketName,
  enabled,
  hasContext,
  requestOptions,
  uiOrigin,
  onCreated,
  setCorsError,
  setCorsStatus,
  setStatusMessage,
}: UseBrowserCreateBucketOptions) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [versioning, setVersioning] = useState(false);
  const [initialSignature, setInitialSignature] = useState(() =>
    createBucketSignature("", false),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setVersioning(false);
    setInitialSignature(createBucketSignature("", false));
    setError(null);
  }, []);

  const open = useCallback(() => {
    if (!enabled) return;
    reset();
    setShowModal(true);
  }, [enabled, reset]);

  const close = useCallback(() => {
    if (loading) return;
    setShowModal(false);
    reset();
  }, [loading, reset]);

  const currentSignature = useMemo(
    () => createBucketSignature(name, versioning),
    [name, versioning],
  );
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showModal && currentSignature !== initialSignature,
    onClose: close,
    disabled: loading,
  });

  const updateName = (value: string) => {
    setName(value);
    if (error) setError(null);
  };

  const submit = async () => {
    if (!hasContext || !enabled || loading) return;
    const normalizedName = normalizeS3BucketName(name);
    if (!normalizedName) {
      setError("Bucket name is required.");
      return;
    }
    if (!isValidS3BucketName(normalizedName)) {
      setError(INVALID_BUCKET_NAME_MESSAGE);
      return;
    }
    setLoading(true);
    setError(null);
    setCorsError(null);
    try {
      await createBrowserBucket(accountIdForApi, normalizedName, {
        versioning,
        ...requestOptions,
      });
      let corsApplied = false;
      if (uiOrigin) {
        try {
          const status = await ensureBucketCors(
            accountIdForApi,
            normalizedName,
            uiOrigin,
            requestOptions,
          );
          corsApplied = status.enabled;
          if (currentBucketName === normalizedName) {
            setCorsStatus(status);
          }
          if (!status.enabled && status.error) {
            setCorsError(status.error);
          }
        } catch {
          setCorsError("Bucket created, but unable to auto-apply CORS.");
        }
      }
      setShowModal(false);
      reset();
      setStatusMessage(
        uiOrigin
          ? corsApplied
            ? `Bucket ${normalizedName} created with CORS enabled.`
            : `Bucket ${normalizedName} created. CORS could not be auto-enabled.`
          : `Bucket ${normalizedName} created.`,
      );
      await onCreated(normalizedName);
    } catch (submitError) {
      setError(extractApiError(submitError, "Unable to create bucket."));
    } finally {
      setLoading(false);
    }
  };

  return {
    showModal,
    name,
    versioning,
    loading,
    error,
    isNameValid: !name || isValidS3BucketName(name),
    invalidNameMessage: INVALID_BUCKET_NAME_MESSAGE,
    open,
    updateName,
    setVersioning,
    submit,
    requestClose: closeGuard.requestClose,
    confirmationDialog: closeGuard.confirmationDialog,
  };
}
