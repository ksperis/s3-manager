/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  createFolder,
  type BrowserRequestOptions,
} from "../../api/browser";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { stableSignature } from "../../utils/stableSignature";

function createFolderSignature(name: string): string {
  return stableSignature({ newFolderName: name });
}

type CreatedFolder = {
  name: string;
  prefix: string;
};

type UseBrowserCreateFolderOptions = {
  accountIdForApi: S3AccountSelector;
  bucketName: string;
  hasContext: boolean;
  parentPrefix: string;
  requestOptions?: BrowserRequestOptions;
  onCreated: (folder: CreatedFolder) => Promise<void> | void;
};

export function useBrowserCreateFolder({
  accountIdForApi,
  bucketName,
  hasContext,
  parentPrefix,
  requestOptions,
  onCreated,
}: UseBrowserCreateFolderOptions) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [initialSignature, setInitialSignature] = useState(() =>
    createFolderSignature(""),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setName("");
    setInitialSignature(createFolderSignature(""));
    setError(null);
  }, []);

  const open = useCallback(() => {
    if (!bucketName || !hasContext) return;
    reset();
    setLoading(false);
    setShowModal(true);
  }, [bucketName, hasContext, reset]);

  const close = useCallback(() => {
    if (loading) return;
    setShowModal(false);
    reset();
  }, [loading, reset]);

  const currentSignature = useMemo(
    () => createFolderSignature(name),
    [name],
  );
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showModal && currentSignature !== initialSignature,
    onClose: close,
    disabled: loading,
  });

  const submit = async () => {
    if (!bucketName || !hasContext || loading) return;
    const normalizedName = name.replace(/^\/+|\/+$/g, "");
    if (!normalizedName) {
      setError("Folder name is required.");
      return;
    }
    const folderPrefix = `${parentPrefix}${normalizedName}/`;
    setLoading(true);
    setError(null);
    try {
      await createFolder(
        accountIdForApi,
        bucketName,
        folderPrefix,
        requestOptions,
      );
      setShowModal(false);
      reset();
      await onCreated({ name: normalizedName, prefix: folderPrefix });
    } catch {
      setError("Unable to create folder.");
    } finally {
      setLoading(false);
    }
  };

  return {
    showModal,
    inputRef,
    name,
    loading,
    error,
    open,
    setName,
    submit,
    requestClose: closeGuard.requestClose,
    confirmationDialog: closeGuard.confirmationDialog,
  };
}
