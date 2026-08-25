import { describe, expect, it } from "vitest";

import {
  completeOperationById,
  patchOperationById,
  prependCompletedActivity,
} from "../browserOperationState";
import type { OperationItem } from "../browserTypes";

const operations: OperationItem[] = [
  {
    id: "target",
    label: "Uploading",
    path: "bucket/file.txt",
    progress: 25,
    status: "uploading",
    cancelable: true,
    errorMessage: "Previous failure",
  },
  {
    id: "other",
    label: "Downloading",
    path: "bucket/other.txt",
    progress: 10,
    status: "downloading",
  },
];

describe("browserOperationState", () => {
  it("patches only the requested operation", () => {
    const result = patchOperationById(operations, "target", {
      label: "Multipart upload",
      progress: 50,
    });

    expect(result[0]).toMatchObject({
      label: "Multipart upload",
      progress: 50,
    });
    expect(result[1]).toBe(operations[1]);
    expect(patchOperationById(operations, null, { progress: 80 })).toBe(
      operations,
    );
  });

  it("completes an operation and retains a previous failure message by default", () => {
    const failed = completeOperationById(
      operations,
      "target",
      "failed",
      "12:34:56",
    );

    expect(failed[0]).toMatchObject({
      progress: 100,
      cancelable: false,
      completedAt: "12:34:56",
      completionStatus: "failed",
      errorMessage: "Previous failure",
    });

    const completed = completeOperationById(
      failed,
      "target",
      "done",
      "12:35:00",
    );
    expect(completed[0]).toMatchObject({
      completionStatus: "done",
      errorMessage: undefined,
    });
  });

  it("caps completed activities without dropping transfer operations", () => {
    const result = prependCompletedActivity(
      [
        operations[0],
        {
          id: "previous-activity",
          label: "Created",
          path: "bucket/previous/",
          progress: 100,
          kind: "activity",
          completedAt: "12:00:00",
          completionStatus: "done",
        },
        operations[1],
      ],
      {
        id: "latest-activity",
        label: "Created",
        path: "bucket/latest/",
        progress: 100,
        kind: "activity",
        completedAt: "12:01:00",
        completionStatus: "done",
      },
      1,
    );

    expect(result.map((operation) => operation.id)).toEqual([
      "latest-activity",
      "target",
      "other",
    ]);
  });
});
