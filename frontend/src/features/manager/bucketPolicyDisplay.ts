/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(toDisplayText).filter(Boolean).join(", ");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key}: ${toDisplayText(nestedValue)}`)
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function getStatementField(statement: Record<string, unknown>, field: "Action" | "NotAction" | "Resource" | "NotResource") {
  const lowerCamel = `${field.charAt(0).toLowerCase()}${field.slice(1)}`;
  return statement[field] ?? statement[lowerCamel] ?? statement[field.toLowerCase()];
}

export function hasBucketPolicyDocument(policy?: Record<string, unknown> | null): policy is Record<string, unknown> {
  return isRecord(policy) && Object.keys(policy).length > 0;
}

export function getBucketPolicyStatements(policy?: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!hasBucketPolicyDocument(policy)) return [];
  const rawStatements = policy.Statement ?? policy.statement;
  if (Array.isArray(rawStatements)) {
    return rawStatements.filter(isRecord);
  }
  return isRecord(rawStatements) ? [rawStatements] : [];
}

export function getBucketPolicyStatementSid(statement: Record<string, unknown>, index: number): string {
  const sid = statement.Sid ?? statement.sid;
  return typeof sid === "string" && sid.trim() ? sid : `Statement ${index + 1}`;
}

export function getBucketPolicyStatementEffect(statement: Record<string, unknown>): string {
  const effect = statement.Effect ?? statement.effect;
  return typeof effect === "string" && effect.trim() ? effect : "-";
}

export function formatBucketPolicyPrincipal(statement: Record<string, unknown>): string {
  const principal =
    statement.Principal ?? statement.principal ?? statement.NotPrincipal ?? statement.notPrincipal ?? statement.notprincipal;
  const formatted = toDisplayText(principal);
  return formatted || "-";
}

export function describeBucketPolicyActions(statement: Record<string, unknown>): string {
  const action = getStatementField(statement, "Action");
  const notAction = getStatementField(statement, "NotAction");
  const label = action === undefined && notAction !== undefined ? "NotAction" : "Action";
  const formatted = toDisplayText(action ?? notAction);
  return formatted ? `${label}: ${formatted}` : "No actions";
}

export function formatBucketPolicyResources(statement: Record<string, unknown>): string {
  const resource = getStatementField(statement, "Resource");
  const notResource = getStatementField(statement, "NotResource");
  const label = resource === undefined && notResource !== undefined ? "NotResource" : "Resource";
  const formatted = toDisplayText(resource ?? notResource);
  return formatted ? `${label}: ${formatted}` : "";
}
