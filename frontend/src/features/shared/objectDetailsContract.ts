/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type ObjectDetailsTabId =
  | "preview"
  | "details"
  | "versions"
  | "properties"
  | "protection"
  | "archive";

export type StorageSpaceObjectDetailsView =
  | "preview"
  | "history"
  | "sharing"
  | "details";

export function resolveStorageSpaceObjectDetailsView({
  initialTab,
  intent,
  isDeleted,
}: {
  initialTab?: ObjectDetailsTabId;
  intent?: "create-public-link";
  isDeleted?: boolean;
}): StorageSpaceObjectDetailsView {
  if (isDeleted || initialTab === "versions") return "history";
  if (intent === "create-public-link") return "sharing";
  if (initialTab === "details" || initialTab === "properties") return "details";
  return "preview";
}
