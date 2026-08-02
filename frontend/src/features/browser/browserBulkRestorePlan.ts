/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BrowserObject,
  BrowserObjectVersion,
} from "../../api/browser";
import { normalizePrefix } from "./browserUtils";
import type { BrowserItem } from "./browserTypes";

type VersionListing = {
  versions: BrowserObjectVersion[];
  deleteMarkers: BrowserObjectVersion[];
};

type BuildBulkRestorePlanOptions = {
  items: BrowserItem[];
  restoreLatestDeleted: boolean;
  targetTime: number;
  deleteMissing: boolean;
  listVersionsForKey: (key: string) => Promise<VersionListing>;
  listVersionsForPrefix: (prefix: string) => Promise<VersionListing>;
  listObjectsForPrefix: (prefix: string) => Promise<BrowserObject[]>;
};

type BulkRestorePlan = {
  restoreList: Array<{ key: string; versionId: string }>;
  deleteList: string[];
  unchangedKeys: Set<string>;
};

function entryTime(entry: BrowserObjectVersion): number {
  if (!entry.last_modified) return 0;
  const parsed = new Date(entry.last_modified).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortedByDateDesc(
  entries: BrowserObjectVersion[],
): BrowserObjectVersion[] {
  return entries.slice().sort((a, b) => entryTime(b) - entryTime(a));
}

function versionAtOrBefore(
  entries: BrowserObjectVersion[],
  targetTime: number,
): BrowserObjectVersion | undefined {
  return sortedByDateDesc(entries).find(
    (entry) =>
      Boolean(entry.last_modified) && entryTime(entry) <= targetTime,
  );
}

function latestRestorableVersion(
  entries: BrowserObjectVersion[],
): BrowserObjectVersion | undefined {
  return sortedByDateDesc(entries).find(
    (entry) =>
      !entry.is_delete_marker &&
      typeof entry.version_id === "string" &&
      entry.version_id.length > 0,
  );
}

function classifyVersions(
  key: string,
  entries: BrowserObjectVersion[],
  options: Pick<
    BuildBulkRestorePlanOptions,
    "restoreLatestDeleted" | "targetTime"
  >,
  plan: {
    restoreCandidates: Map<string, string>;
    presentAtDate: Set<string>;
    unchangedKeys: Set<string>;
  },
): void {
  const latest = entries.find((entry) => entry.is_latest);
  if (options.restoreLatestDeleted) {
    const restorable = latestRestorableVersion(entries);
    if (latest?.is_delete_marker && restorable?.version_id) {
      plan.restoreCandidates.set(key, restorable.version_id);
    }
    return;
  }

  const match = versionAtOrBefore(entries, options.targetTime);
  if (!match || match.is_delete_marker || !match.version_id) return;
  if (
    latest &&
    !latest.is_delete_marker &&
    latest.version_id === match.version_id
  ) {
    plan.unchangedKeys.add(key);
  } else {
    plan.restoreCandidates.set(key, match.version_id);
  }
  plan.presentAtDate.add(key);
}

export async function buildBulkRestorePlan({
  items,
  restoreLatestDeleted,
  targetTime,
  deleteMissing,
  listVersionsForKey,
  listVersionsForPrefix,
  listObjectsForPrefix,
}: BuildBulkRestorePlanOptions): Promise<BulkRestorePlan> {
  const restoreCandidates = new Map<string, string>();
  const presentAtDate = new Set<string>();
  const deleteCandidates = new Set<string>();
  const unchangedKeys = new Set<string>();
  const classification = {
    restoreCandidates,
    presentAtDate,
    unchangedKeys,
  };
  const classificationOptions = { restoreLatestDeleted, targetTime };

  for (const item of items.filter((entry) => entry.type === "file")) {
    const { versions, deleteMarkers } = await listVersionsForKey(item.key);
    classifyVersions(
      item.key,
      [...versions, ...deleteMarkers],
      classificationOptions,
      classification,
    );
    if (
      !restoreLatestDeleted &&
      deleteMissing &&
      !presentAtDate.has(item.key)
    ) {
      deleteCandidates.add(item.key);
    }
  }

  for (const folder of items.filter((entry) => entry.type === "folder")) {
    const prefix = normalizePrefix(folder.key);
    const { versions, deleteMarkers } = await listVersionsForPrefix(prefix);
    const versionsByKey = new Map<string, BrowserObjectVersion[]>();
    for (const entry of [...versions, ...deleteMarkers]) {
      const entries = versionsByKey.get(entry.key) ?? [];
      entries.push(entry);
      versionsByKey.set(entry.key, entries);
    }
    for (const [key, entries] of versionsByKey) {
      classifyVersions(
        key,
        entries,
        classificationOptions,
        classification,
      );
    }

    if (!restoreLatestDeleted && deleteMissing) {
      const currentObjects = await listObjectsForPrefix(prefix);
      for (const object of currentObjects) {
        if (!presentAtDate.has(object.key)) {
          deleteCandidates.add(object.key);
        }
      }
    }
  }

  return {
    restoreList: Array.from(restoreCandidates, ([key, versionId]) => ({
      key,
      versionId,
    })),
    deleteList: Array.from(deleteCandidates),
    unchangedKeys,
  };
}
