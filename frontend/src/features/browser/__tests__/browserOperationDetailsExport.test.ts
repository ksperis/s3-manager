import { describe, expect, it } from "vitest";

import { buildBrowserOperationDetailsExport } from "../browserOperationDetailsExport";
import type {
  DownloadOperationGroup,
  OperationItem,
  UploadOperationGroup,
} from "../browserTypes";

const exportedAt = "2026-08-12T08:09:10.123Z";

function operation(overrides: Partial<OperationItem> = {}): OperationItem {
  return {
    id: "operation-1",
    label: "Operation",
    path: "bucket/key",
    progress: 25,
    status: "downloading",
    ...overrides,
  };
}

function buildExport(
  overrides: Partial<
    Parameters<typeof buildBrowserOperationDetailsExport>[0]
  > = {},
) {
  return buildBrowserOperationDetailsExport({
    kind: "other",
    operationId: "operation-1",
    exportedAt,
    operations: [],
    downloadGroups: [],
    deleteGroups: [],
    copyGroups: [],
    uploadGroups: [],
    ...overrides,
  });
}

describe("browserOperationDetailsExport", () => {
  it("builds a deterministic detail export filename and payload", () => {
    const group: DownloadOperationGroup = {
      op: operation({
        id: "download/1",
        kind: "download",
        completionStatus: "failed",
        completedAt: exportedAt,
        errorMessage: "Network error",
      }),
      items: [
        {
          id: "item-1",
          key: "folder/file.txt",
          label: "file.txt",
          status: "failed",
          sizeBytes: 42,
          errorMessage: "Network error",
        },
      ],
      counts: {
        total: 1,
        queued: 0,
        downloading: 0,
        done: 0,
        failed: 1,
        cancelled: 0,
      },
    };

    expect(
      buildExport({
        kind: "download",
        operationId: "download/1",
        downloadGroups: [group],
      }),
    ).toEqual({
      filename: "operation-download-download_1-2026-08-12T08-09-10-123Z.json",
      payload: {
        exportedAt,
        kind: "download",
        operation: {
          id: "download/1",
          kind: "download",
          label: "Operation",
          path: "bucket/key",
          status: "downloading",
          progress: 25,
          completionStatus: "failed",
          completedAt: exportedAt,
          errorMessage: "Network error",
        },
        counts: group.counts,
        items: [
          {
            id: "item-1",
            key: "folder/file.txt",
            label: "file.txt",
            status: "failed",
            sizeBytes: 42,
            errorMessage: "Network error",
          },
        ],
      },
    });
  });

  it("normalizes upload entries and counts each exported state", () => {
    const group: UploadOperationGroup = {
      id: "upload-group",
      label: "Uploads",
      kind: "files",
      activeItems: [
        operation({
          id: "active",
          kind: "upload",
          status: "copying",
          itemLabel: "active.txt",
        }),
      ],
      completedItems: [
        operation({
          id: "completed",
          kind: "upload",
          status: "uploading",
          completionStatus: "cancelled",
        }),
      ],
      queuedItems: [
        {
          id: "queued",
          file: new File([new Uint8Array(8)], "queued.txt"),
          relativePath: "folder/queued.txt",
          key: "folder/queued.txt",
          bucket: "demo",
          accountId: "account-1",
          groupId: "upload-group",
          groupLabel: "Uploads",
          groupKind: "files",
          itemLabel: "queued.txt",
        },
      ],
      cancelable: true,
      progress: 50,
      totalBytes: 16,
    };

    const result = buildExport({
      kind: "upload",
      operationId: group.id,
      uploadGroups: [group],
    });

    expect(result?.payload.counts).toEqual({
      total: 3,
      queued: 1,
      uploading: 1,
      done: 0,
      failed: 0,
      cancelled: 1,
    });
    expect(result?.payload.items).toEqual([
      expect.objectContaining({ id: "active", state: "uploading" }),
      expect.objectContaining({ id: "completed", state: "cancelled" }),
      expect.objectContaining({
        id: "queued",
        state: "queued",
        path: "demo/folder/queued.txt",
        sizeBytes: 8,
      }),
    ]);
  });

  it("returns null when the requested operation is unknown", () => {
    expect(buildExport()).toBeNull();
  });
});
