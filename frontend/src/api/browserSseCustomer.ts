/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const SSE_CUSTOMER_ALGORITHM = "AES256";

type SseCustomerKeyValidationResult =
  | { valid: true; normalizedKey: string }
  | { valid: false; error: string };

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const decodeBase64 = (value: string): Uint8Array | null => {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let idx = 0; idx < binary.length; idx += 1) {
      bytes[idx] = binary.charCodeAt(idx);
    }
    return bytes;
  } catch {
    return null;
  }
};

const encodeBase64 = (value: Uint8Array): string => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

export function generateSseCustomerKeyBase64(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random generator is unavailable in this browser.");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const keyBase64 = encodeBase64(bytes);
  const validation = validateSseCustomerKeyBase64(keyBase64);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return validation.normalizedKey;
}

export function validateSseCustomerKeyBase64(
  value: string,
): SseCustomerKeyValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: "SSE-C key is required." };
  }
  if (!BASE64_PATTERN.test(trimmed)) {
    return { valid: false, error: "SSE-C key must be valid base64." };
  }
  const bytes = decodeBase64(trimmed);
  if (!bytes) {
    return { valid: false, error: "SSE-C key must be valid base64." };
  }
  const normalized = encodeBase64(bytes);
  if (normalized !== trimmed) {
    return { valid: false, error: "SSE-C key must be strict base64." };
  }
  if (bytes.length !== 32) {
    return { valid: false, error: "SSE-C key must decode to exactly 32 bytes." };
  }
  return { valid: true, normalizedKey: normalized };
}

export function buildSseCustomerBackendHeaders(
  sseCustomerKeyBase64?: string | null,
): Record<string, string> {
  if (!sseCustomerKeyBase64) {
    return {};
  }
  const validation = validateSseCustomerKeyBase64(sseCustomerKeyBase64);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return {
    "X-S3-SSE-C-Key": validation.normalizedKey,
    "X-S3-SSE-C-Algorithm": SSE_CUSTOMER_ALGORITHM,
  };
}
