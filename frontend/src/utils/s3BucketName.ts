/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const S3_BUCKET_NAME_MIN_LENGTH = 3;
export const S3_BUCKET_NAME_MAX_LENGTH = 63;

const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
const BUCKET_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV4_ADDRESS_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export function normalizeS3BucketName(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return "";
  const sanitized = lower.replace(/[^a-z0-9.-]+/g, "-");
  const labels = sanitized
    .split(".")
    .map((label) => label.replace(/^-+/, "").replace(/-+$/, ""))
    .filter(Boolean);
  const joined = labels.join(".");
  return joined.replace(/^[.-]+/, "").replace(/[.-]+$/, "").slice(0, S3_BUCKET_NAME_MAX_LENGTH);
}

export function normalizeS3BucketNameInput(value: string): string {
  const lower = value.toLowerCase();
  if (!lower) return "";
  return lower.replace(/[^a-z0-9.-]+/g, "-").slice(0, S3_BUCKET_NAME_MAX_LENGTH);
}

export function isValidS3BucketName(value: string): boolean {
  if (value.length < S3_BUCKET_NAME_MIN_LENGTH || value.length > S3_BUCKET_NAME_MAX_LENGTH) return false;
  if (!BUCKET_NAME_PATTERN.test(value)) return false;
  if (value.includes("..")) return false;
  if (value.split(".").some((label) => !BUCKET_LABEL_PATTERN.test(label))) return false;
  if (IPV4_ADDRESS_PATTERN.test(value)) return false;
  return true;
}
