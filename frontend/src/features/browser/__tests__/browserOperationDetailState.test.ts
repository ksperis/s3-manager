import { describe, expect, it } from "vitest";

import {
  cancelPendingOperationDetails,
  updateOperationDetailById,
  updateOperationDetailsByKey,
} from "../browserOperationDetailState";
import type { DownloadDetailItem } from "../browserTypes";

const records: Record<string, DownloadDetailItem[]> = {
  operation: [
    { id: "queued", key: "a", label: "a", status: "queued" },
    {
      id: "active",
      key: "b",
      label: "b",
      status: "downloading",
      errorMessage: "stale",
    },
    { id: "done", key: "c", label: "c", status: "done" },
  ],
};

describe("browserOperationDetailState", () => {
  it("updates a detail by id and retains the previous failure message by default", () => {
    const failed = updateOperationDetailById(
      records,
      "operation",
      "active",
      "failed",
    );

    expect(failed.operation[1]).toMatchObject({
      status: "failed",
      errorMessage: "stale",
    });
    const completed = updateOperationDetailById(
      failed,
      "operation",
      "active",
      "done",
    );
    expect(completed.operation[1]).toMatchObject({
      status: "done",
      errorMessage: undefined,
    });
  });

  it("updates matching keys and leaves other operations untouched", () => {
    const other = [{ id: "other", key: "a", label: "a", status: "queued" }] satisfies DownloadDetailItem[];
    const source = { ...records, other };

    const result = updateOperationDetailsByKey(
      source,
      "operation",
      ["a", "c"],
      "failed",
      "Batch failed",
    );

    expect(result.operation.map((item) => item.status)).toEqual([
      "failed",
      "downloading",
      "failed",
    ]);
    expect(result.other).toBe(other);
  });

  it("cancels only queued and active details and preserves missing records", () => {
    const result = cancelPendingOperationDetails(
      records,
      "operation",
      "downloading",
      "cancelled",
    );

    expect(result.operation.map((item) => item.status)).toEqual([
      "cancelled",
      "cancelled",
      "done",
    ]);
    expect(result.operation[1].errorMessage).toBeUndefined();
    expect(
      cancelPendingOperationDetails(
        records,
        "missing",
        "downloading",
        "cancelled",
      ),
    ).toBe(records);
  });
});
