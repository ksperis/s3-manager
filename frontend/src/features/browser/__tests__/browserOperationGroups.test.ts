import { describe, expect, it } from "vitest";

import {
  buildOperationGroupSortIndexes,
  buildDownloadOperationGroups,
  buildUploadOperationGroups,
  filterDetailOperationGroups,
  filterUploadOperationGroups,
  summarizeDetailOperationGroups,
} from "../browserOperationGroups";
import type {
  DownloadDetailItem,
  OperationItem,
  UploadQueueItem,
} from "../browserTypes";

function operation(overrides: Partial<OperationItem> = {}): OperationItem {
  return {
    id: "operation-1",
    label: "Operation",
    path: "bucket/key",
    progress: 0,
    status: "downloading",
    ...overrides,
  };
}

describe("browserOperationGroups", () => {
  it("groups detail operations and counts every supported status", () => {
    const details: Record<string, DownloadDetailItem[]> = {
      "download-1": [
        { id: "1", key: "a", label: "a", status: "queued" },
        { id: "2", key: "b", label: "b", status: "downloading" },
        { id: "3", key: "c", label: "c", status: "done" },
        { id: "4", key: "d", label: "d", status: "failed" },
        { id: "5", key: "e", label: "e", status: "cancelled" },
      ],
    };

    const groups = buildDownloadOperationGroups(
      [
        operation({ id: "ignored", kind: "copy" }),
        operation({ id: "download-1", kind: "download" }),
      ],
      details,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].counts).toEqual({
      total: 5,
      queued: 1,
      downloading: 1,
      done: 1,
      failed: 1,
      cancelled: 1,
    });
  });

  it("preserves operation-level completion fallbacks without double counting items", () => {
    const groups = buildDownloadOperationGroups(
      [
        operation({
          id: "failed-fallback",
          kind: "download",
          completedAt: "2026-08-12T08:00:00Z",
          completionStatus: "failed",
        }),
        operation({
          id: "completed-fallback",
          kind: "download",
          completedAt: "2026-08-12T08:01:00Z",
          completionStatus: "done",
        }),
        operation({ id: "item-counts", kind: "download" }),
      ],
      {
        "item-counts": [
          { id: "1", key: "a", label: "a", status: "queued" },
          { id: "2", key: "b", label: "b", status: "done" },
          { id: "3", key: "c", label: "c", status: "cancelled" },
          { id: "4", key: "d", label: "d", status: "failed" },
        ],
      },
    );

    expect(summarizeDetailOperationGroups(groups)).toEqual({
      queued: 1,
      completed: 3,
      failed: 2,
    });
  });

  it("groups upload operations and computes byte-weighted progress", () => {
    const queued = {
      id: "queued",
      file: new File([new Uint8Array(100)], "queued.txt"),
      relativePath: "queued.txt",
      key: "queued.txt",
      bucket: "demo",
      accountId: "account-1",
      groupId: "group-1",
      groupLabel: "Batch",
      groupKind: "files",
      itemLabel: "queued.txt",
    } satisfies UploadQueueItem;

    const groups = buildUploadOperationGroups(
      [
        operation({
          id: "active",
          kind: "upload",
          status: "uploading",
          groupId: "group-1",
          groupLabel: "Batch",
          progress: 50,
          sizeBytes: 100,
          cancelable: true,
        }),
        operation({
          id: "completed",
          kind: "upload",
          status: "uploading",
          groupId: "group-1",
          progress: 100,
          sizeBytes: 100,
          completedAt: "2026-08-12T08:00:00Z",
          completionStatus: "done",
        }),
      ],
      [queued],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "group-1",
      label: "Batch",
      cancelable: true,
      progress: 50,
      totalBytes: 300,
    });
    expect(groups[0].activeItems).toHaveLength(1);
    expect(groups[0].completedItems).toHaveLength(1);
    expect(groups[0].queuedItems).toEqual([queued]);
  });

  it("filters detail groups by active, queued, completed, and failed states", () => {
    const groups = buildDownloadOperationGroups(
      [
        operation({ id: "active", kind: "download" }),
        operation({ id: "queued", kind: "download" }),
        operation({
          id: "completed",
          kind: "download",
          completedAt: "2026-08-12T08:00:00Z",
          completionStatus: "done",
        }),
        operation({
          id: "failed",
          kind: "download",
          completedAt: "2026-08-12T08:01:00Z",
          completionStatus: "failed",
        }),
      ],
      {
        queued: [{ id: "1", key: "a", label: "a", status: "queued" }],
      },
    );

    expect(
      filterDetailOperationGroups(groups, "downloading", {
        active: false,
        queued: false,
        completed: true,
        failed: false,
      }).map((group) => group.op.id),
    ).toEqual(["completed"]);
    expect(
      filterDetailOperationGroups(groups, "downloading", {
        active: true,
        queued: true,
        completed: false,
        failed: true,
      }).map((group) => group.op.id),
    ).toEqual(["active", "queued", "failed"]);
  });

  it("filters mixed upload groups and derives stable cross-kind sort indexes", () => {
    const queue = [
      {
        id: "queued-oldest",
        file: new File([], "oldest.txt"),
        relativePath: "oldest.txt",
        key: "oldest.txt",
        bucket: "demo",
        accountId: "account-1",
        groupId: "queued-group",
        groupLabel: "Queued",
        groupKind: "files",
        itemLabel: "oldest.txt",
      },
      {
        id: "queued-newest",
        file: new File([], "newest.txt"),
        relativePath: "newest.txt",
        key: "newest.txt",
        bucket: "demo",
        accountId: "account-1",
        groupId: "queued-group",
        groupLabel: "Queued",
        groupKind: "files",
        itemLabel: "newest.txt",
      },
    ] satisfies UploadQueueItem[];
    const operations = [
      operation({
        id: "active-upload",
        kind: "upload",
        status: "uploading",
        groupId: "mixed-group",
      }),
      operation({
        id: "failed-upload",
        kind: "upload",
        status: "uploading",
        groupId: "mixed-group",
        completedAt: "2026-08-12T08:00:00Z",
        completionStatus: "failed",
      }),
    ];
    const groups = buildUploadOperationGroups(operations, queue);

    expect(
      filterUploadOperationGroups(groups, {
        active: false,
        queued: false,
        completed: false,
        failed: true,
      }).map((group) => group.id),
    ).toEqual(["mixed-group"]);
    const indexes = buildOperationGroupSortIndexes(operations, queue, groups);
    expect(indexes.operationById).toEqual({
      "active-upload": 2,
      "failed-upload": 1,
    });
    expect(indexes.uploadGroupById).toEqual({
      "mixed-group": 2,
      "queued-group": 2,
    });
    expect(indexes.fallback).toBe(1004);
  });
});
