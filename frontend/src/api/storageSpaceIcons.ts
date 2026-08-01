/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type StorageSpaceIconSource = "preset" | "uploaded";
export type StorageSpaceIconPreset = "bucket" | "folder" | "archive" | "database" | "media";

export type StorageSpaceIconDescriptor = {
  source: StorageSpaceIconSource;
  preset?: StorageSpaceIconPreset | null;
  url?: string | null;
  updated_at?: string | null;
};
