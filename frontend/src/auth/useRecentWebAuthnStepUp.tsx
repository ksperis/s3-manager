/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  beginRecentWebAuthnVerification,
  finishRecentWebAuthnVerification,
} from "../api/security";
import Modal from "../components/Modal";
import PageBanner from "../components/PageBanner";
import UiButton from "../components/ui/UiButton";
import { authenticatePasskey } from "./webauthn";
import { extractApiError, isRecentWebAuthnRequired } from "../utils/apiError";

type PendingRetry = {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class RecentWebAuthnVerificationCancelledError extends Error {
  constructor() {
    super("Passkey verification cancelled");
    this.name = "RecentWebAuthnVerificationCancelledError";
  }
}

export function isRecentWebAuthnVerificationCancelled(error: unknown): boolean {
  return error instanceof RecentWebAuthnVerificationCancelledError;
}

function verificationFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Passkey verification was cancelled or timed out. Please try again.";
  }
  return extractApiError(error, "Passkey verification failed. Please try again.");
}

export function useRecentWebAuthnStepUp() {
  const pendingRetryRef = useRef<PendingRetry | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  useEffect(() => () => {
    pendingRetryRef.current?.reject(new RecentWebAuthnVerificationCancelledError());
    pendingRetryRef.current = null;
  }, []);

  const verifyNow = useCallback(async (): Promise<boolean> => {
    setVerifying(true);
    setVerificationError(null);
    try {
      const options = await beginRecentWebAuthnVerification();
      const credential = await authenticatePasskey(options);
      await finishRecentWebAuthnVerification(credential);
      return true;
    } catch (error) {
      setVerificationError(verificationFailureMessage(error));
      return false;
    } finally {
      setVerifying(false);
    }
  }, []);

  const queueRetry = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    if (pendingRetryRef.current) {
      return Promise.reject(new Error("Passkey verification is already pending"));
    }
    setVerificationError(null);
    setPromptOpen(true);
    return new Promise<T>((resolve, reject) => {
      pendingRetryRef.current = {
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      };
    });
  }, []);

  const runWithStepUp = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (!isRecentWebAuthnRequired(error)) throw error;
      return queueRetry(operation);
    }
  }, [queueRetry]);

  const cancelPrompt = useCallback(() => {
    if (verifying) return;
    const pending = pendingRetryRef.current;
    pendingRetryRef.current = null;
    setPromptOpen(false);
    setVerificationError(null);
    pending?.reject(new RecentWebAuthnVerificationCancelledError());
  }, [verifying]);

  const confirmPrompt = useCallback(async () => {
    if (!pendingRetryRef.current || !(await verifyNow())) return;
    const pending = pendingRetryRef.current;
    pendingRetryRef.current = null;
    setPromptOpen(false);
    setVerificationError(null);
    try {
      pending.resolve(await pending.operation());
    } catch (error) {
      pending.reject(error);
    }
  }, [verifyNow]);

  const verificationDialog = useMemo(() => promptOpen ? (
    <Modal
      title="Verify with passkey"
      onClose={cancelPrompt}
      maxWidthClass="max-w-lg"
      closeOnBackdropClick={!verifying}
      closeOnEscape={!verifying}
    >
      <div className="space-y-4">
        <p className="ui-body text-[var(--ui-text)]">
          Confirm your identity to continue this sensitive action in the current session.
        </p>
        {verificationError ? <PageBanner tone="error">{verificationError}</PageBanner> : null}
        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" onClick={cancelPrompt} disabled={verifying}>Cancel</UiButton>
          <UiButton onClick={() => void confirmPrompt()} loading={verifying}>Verify with passkey</UiButton>
        </div>
      </div>
    </Modal>
  ) : null, [cancelPrompt, confirmPrompt, promptOpen, verificationError, verifying]);

  return {
    runWithStepUp,
    verificationDialog,
    verificationError,
    verifying,
    verifyNow,
  };
}
