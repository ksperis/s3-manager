/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserObject } from "../../api/browserContracts";
import type { MultipartUploadItem } from "../../api/browserMultipart";

export const getDeletedObjectEntryId = (
  value: Pick<BrowserObject, "key" | "version_id">,
) => `${value.key}::${value.version_id ?? "null"}`;

export const getMultipartUploadEntryId = (
  upload: Pick<MultipartUploadItem, "key" | "upload_id">,
) => `${upload.key}::${upload.upload_id}`;

export const mergeUniqueStringsWithLimit = (
  base: string[],
  incoming: string[],
  limit: number,
) => {
  if (base.length >= limit || incoming.length === 0) {
    return {
      items: base.slice(0, limit),
      limitReached: base.length >= limit,
    };
  }
  const merged = Array.from(new Set([...base, ...incoming]));
  return {
    items: merged.slice(0, limit),
    limitReached: merged.length > limit,
  };
};

export const mergeDeletedObjectsWithLimit = (
  base: BrowserObject[],
  incoming: BrowserObject[],
  limit: number,
) => {
  const byId = new Map<string, BrowserObject>();
  let limitReached = base.length > limit;
  base.forEach((item) => byId.set(getDeletedObjectEntryId(item), item));
  incoming.forEach((item) => {
    const entryId = getDeletedObjectEntryId(item);
    if (byId.size < limit || byId.has(entryId)) {
      byId.set(entryId, item);
    } else {
      limitReached = true;
    }
  });
  const items = Array.from(byId.values());
  return {
    items: items.slice(0, limit),
    limitReached: limitReached || items.length > limit || byId.size > limit,
  };
};
