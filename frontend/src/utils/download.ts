/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const triggerBlobDownload = (filename: string, blob: Blob) => {
  if (typeof window === "undefined") return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const triggerDownload = (
  filename: string,
  content: string,
  mimeType: string,
) => {
  if (typeof window === "undefined") return;
  triggerBlobDownload(filename, new Blob([content], { type: mimeType }));
};

export const formatDownloadTimestamp = (value: Date | string) =>
  (typeof value === "string" ? value : value.toISOString()).replace(/[:.]/g, "-");

export const triggerJsonDownload = (filename: string, payload: unknown) =>
  triggerDownload(filename, JSON.stringify(payload, null, 2), "application/json");
