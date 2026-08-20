/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizeS3AccountSelectorId,
  type S3AccountSelector,
} from "../../api/accountParams";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { stableSignature } from "../../utils/stableSignature";
import {
  activateSseCustomerKeyForScope,
  copySseCustomerKeyWithFallback,
  generateAndActivateSseCustomerKeyForScope,
} from "./sseCustomerKeyActions";

function createInputSignature(value: string): string {
  return stableSignature({ sseCustomerKeyInput: value });
}

function resolveActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type UseBrowserSseCustomerKeysOptions = {
  accountIdForApi: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  onManualCopyRequired: (keyBase64: string) => void;
  setStatusMessage: (message: string) => void;
};

export function useBrowserSseCustomerKeys({
  accountIdForApi,
  bucketName,
  enabled,
  onManualCopyRequired,
  setStatusMessage,
}: UseBrowserSseCustomerKeysOptions) {
  const [keysByScope, setKeysByScope] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [input, setInput] = useState("");
  const [initialSignature, setInitialSignature] = useState(() =>
    createInputSignature(""),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const scopeKey = useMemo(() => {
    const accountId = normalizeS3AccountSelectorId(accountIdForApi);
    if (!accountId || !bucketName) return null;
    return `${accountId}::${bucketName}`;
  }, [accountIdForApi, bucketName]);
  const storedKeyBase64 = useMemo(() => {
    if (!scopeKey) return null;
    return keysByScope[scopeKey] ?? null;
  }, [keysByScope, scopeKey]);
  const keyBase64 = enabled ? storedKeyBase64 : null;

  const getKeyForScope = useCallback(
    (selector: S3AccountSelector, bucket: string) => {
      const accountId = normalizeS3AccountSelectorId(selector);
      if (!accountId || !bucket) return null;
      return keysByScope[`${accountId}::${bucket}`] ?? null;
    },
    [keysByScope],
  );

  const open = useCallback(() => {
    if (!enabled || !scopeKey) return;
    const nextInput = keyBase64 ?? "";
    setInput(nextInput);
    setInitialSignature(createInputSignature(nextInput));
    setError(null);
    setNotice(null);
    setVisible(false);
    setShowModal(true);
  }, [enabled, keyBase64, scopeKey]);

  const close = useCallback(() => {
    const nextInput = keyBase64 ?? "";
    setShowModal(false);
    setInput(nextInput);
    setInitialSignature(createInputSignature(nextInput));
    setError(null);
    setNotice(null);
    setVisible(false);
  }, [keyBase64]);

  const currentSignature = useMemo(
    () => createInputSignature(input),
    [input],
  );
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showModal && currentSignature !== initialSignature,
    onClose: close,
  });

  const updateInput = (value: string) => {
    setInput(value);
    if (error) setError(null);
    if (notice) setNotice(null);
  };

  const activate = useCallback(() => {
    if (!scopeKey) return;
    try {
      const result = activateSseCustomerKeyForScope(
        keysByScope,
        scopeKey,
        input,
      );
      setKeysByScope(result.next);
      setInitialSignature(createInputSignature(input));
      setError(null);
      setNotice(null);
      setShowModal(false);
      setStatusMessage("SSE-C key enabled for this bucket.");
    } catch (activationError) {
      setError(
        resolveActionError(
          activationError,
          "Unable to activate SSE-C key.",
        ),
      );
    }
  }, [input, keysByScope, scopeKey, setStatusMessage]);

  const generate = useCallback(async () => {
    if (!scopeKey) return;
    let generatedKey = "";
    try {
      const result = generateAndActivateSseCustomerKeyForScope(
        keysByScope,
        scopeKey,
      );
      generatedKey = result.normalizedKey;
      setKeysByScope(result.next);
      setInput(generatedKey);
      setInitialSignature(createInputSignature(generatedKey));
      setError(null);
      setVisible(false);
    } catch (generationError) {
      setError(
        resolveActionError(generationError, "Unable to generate SSE-C key."),
      );
      setNotice(null);
      return;
    }
    const copyOutcome = await copySseCustomerKeyWithFallback(
      generatedKey,
      navigator.clipboard?.writeText?.bind(navigator.clipboard),
      () => onManualCopyRequired(generatedKey),
    );
    if (copyOutcome === "copied") {
      setNotice(
        "SSE-C key generated and enabled. Copy and save this key now; it will be lost on browser refresh.",
      );
      setStatusMessage(
        "SSE-C key generated, enabled, and copied to clipboard.",
      );
      return;
    }
    setNotice(
      "SSE-C key generated and enabled. Clipboard access failed: copy and save the key now using the manual dialog.",
    );
    setStatusMessage(
      "SSE-C key generated and enabled. Copy it manually from the dialog.",
    );
  }, [keysByScope, onManualCopyRequired, scopeKey, setStatusMessage]);

  const clear = useCallback(() => {
    if (!scopeKey) return;
    setKeysByScope((current) => {
      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
    setInput("");
    setInitialSignature(createInputSignature(""));
    setError(null);
    setNotice(null);
    setVisible(false);
    setShowModal(false);
    setStatusMessage("SSE-C key cleared for this bucket.");
  }, [scopeKey, setStatusMessage]);

  useEffect(() => {
    if (!enabled && showModal) {
      setShowModal(false);
    }
  }, [enabled, showModal]);

  return {
    keyBase64,
    active: Boolean(keyBase64),
    getKeyForScope,
    showModal,
    input,
    visible,
    error,
    notice,
    canGenerate: Boolean(scopeKey),
    open,
    updateInput,
    toggleVisibility: () => setVisible((current) => !current),
    generate,
    clear,
    activate,
    requestClose: closeGuard.requestClose,
    confirmationDialog: closeGuard.confirmationDialog,
  };
}
