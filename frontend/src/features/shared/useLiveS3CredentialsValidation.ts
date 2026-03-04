/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useRef, useState } from "react";

export type S3CredentialsValidationPayload = {
  storage_endpoint_id?: number | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean;
  verify_tls?: boolean;
};

export type S3CredentialsValidationResult = {
  ok: boolean;
  severity: "success" | "warning" | "error";
  code?: string | null;
  message: string;
};

type UseLiveS3CredentialsValidationParams = {
  enabled: boolean;
  payload: S3CredentialsValidationPayload | null;
  validate: (payload: S3CredentialsValidationPayload) => Promise<S3CredentialsValidationResult>;
  debounceMs?: number;
};

export type LiveS3CredentialsValidationState = {
  status: "idle" | "loading" | "done";
  result: S3CredentialsValidationResult | null;
};

const IDLE_STATE: LiveS3CredentialsValidationState = {
  status: "idle",
  result: null,
};

function extractValidationError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Unable to validate credentials.";
}

export function useLiveS3CredentialsValidation({
  enabled,
  payload,
  validate,
  debounceMs = 450,
}: UseLiveS3CredentialsValidationParams): LiveS3CredentialsValidationState {
  const [state, setState] = useState<LiveS3CredentialsValidationState>(IDLE_STATE);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !payload) {
      requestIdRef.current += 1;
      setState(IDLE_STATE);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setState({ status: "loading", result: null });
      try {
        const result = await validate(payload);
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({ status: "done", result });
      } catch (err) {
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({
          status: "done",
          result: {
            ok: false,
            severity: "error",
            code: null,
            message: extractValidationError(err),
          },
        });
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [debounceMs, enabled, payload, validate]);

  return state;
}
