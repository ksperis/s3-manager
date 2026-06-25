/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { sanitizeErrorMessage } from "./apiError";

type ConsoleLevel = "error" | "warn";

const SENSITIVE_KEY_PATTERN = /(?:access[_-]?key|secret[_-]?key|session[_-]?token|security[_-]?token|token|password|credential|signature)/i;

let installed = false;

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeErrorMessage(value, "");
  }
  if (value instanceof Error) {
    return `${value.name || "Error"}: ${sanitizeErrorMessage(value.message, "Unexpected error")}`;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  try {
    return JSON.parse(
      JSON.stringify(value, (key, nestedValue) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return "[redacted]";
        }
        if (typeof nestedValue === "string") {
          return sanitizeErrorMessage(nestedValue, "");
        }
        return nestedValue;
      })
    ) as unknown;
  } catch {
    return "[redacted-object]";
  }
}

export function sanitizeConsoleArgs(args: unknown[]): unknown[] {
  return args.map(sanitizeDiagnosticValue);
}

export function reportRuntimeError(context: string, error: unknown): void {
  console.error(context, ...sanitizeConsoleArgs([error]));
}

export function reportRuntimeWarning(context: string, error: unknown): void {
  console.warn(context, ...sanitizeConsoleArgs([error]));
}

export function installConsoleRedaction(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;

  (["error", "warn"] as ConsoleLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...sanitizeConsoleArgs(args));
    };
  });
}
