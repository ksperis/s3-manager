/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { generateSseCustomerKeyBase64, validateSseCustomerKeyBase64 } from "../../api/browser";

export type CopySseCustomerKeyOutcome = "copied" | "manual_copy_required";

export const resolveSseCustomerKeyInputType = (visible: boolean): "password" | "text" =>
  visible ? "text" : "password";

export function activateSseCustomerKeyForScope(
  current: Record<string, string>,
  scopeKey: string,
  candidateKeyBase64: string
): { next: Record<string, string>; normalizedKey: string } {
  const validation = validateSseCustomerKeyBase64(candidateKeyBase64);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return {
    next: {
      ...current,
      [scopeKey]: validation.normalizedKey,
    },
    normalizedKey: validation.normalizedKey,
  };
}

export function generateAndActivateSseCustomerKeyForScope(
  current: Record<string, string>,
  scopeKey: string
): { next: Record<string, string>; normalizedKey: string } {
  const generated = generateSseCustomerKeyBase64();
  return activateSseCustomerKeyForScope(current, scopeKey, generated);
}

export async function copySseCustomerKeyWithFallback(
  keyBase64: string,
  writeText: ((value: string) => Promise<void>) | null | undefined,
  onManualCopyRequired: () => void
): Promise<CopySseCustomerKeyOutcome> {
  if (writeText) {
    try {
      await writeText(keyBase64);
      return "copied";
    } catch {
      // Fallback below.
    }
  }
  onManualCopyRequired();
  return "manual_copy_required";
}
