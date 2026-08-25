import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

describe("useBrowserOperationRegistry", () => {
  it("owns the running and completed operation lifecycle", () => {
    const { result } = renderHook(() => useBrowserOperationRegistry());
    let operationId = "";

    act(() => {
      operationId = result.current.startOperation(
        "downloading",
        "Download report",
        "bucket/report.pdf",
        { kind: "download", cancelable: true },
      );
    });
    expect(result.current.operations[0]).toMatchObject({
      id: operationId,
      progress: 0,
      kind: "download",
      cancelable: true,
    });

    act(() => {
      result.current.updateOperation(operationId, { progress: 60 });
      result.current.completeOperation(operationId);
    });
    expect(result.current.operations[0]).toMatchObject({
      progress: 100,
      cancelable: false,
      completionStatus: "done",
      completedAt: expect.any(String),
    });

    act(() => {
      result.current.recordCompletedActivity("Created", "bucket/reports/");
    });
    expect(result.current.operations[0]).toMatchObject({
      label: "Created",
      path: "bucket/reports/",
      kind: "activity",
      progress: 100,
      completionStatus: "done",
    });
  });

  it("cancels every pending detail kind and owns controller cleanup", () => {
    const { result, unmount } = renderHook(() =>
      useBrowserOperationRegistry(),
    );
    const operationId = "operation-1";

    act(() => {
      result.current.setDownloadDetails({
        [operationId]: [
          { id: "download", key: "a", label: "a", status: "downloading" },
        ],
      });
      result.current.setDeleteDetails({
        [operationId]: [
          { id: "delete", key: "b", label: "b", status: "queued" },
        ],
      });
      result.current.setCopyDetails({
        [operationId]: [
          { id: "copy", key: "c", label: "c", status: "copying" },
        ],
      });
    });

    const replacedController = result.current.createOperationController(
      operationId,
    );
    const activeController = result.current.createOperationController(
      operationId,
    );
    expect(replacedController.signal.aborted).toBe(true);

    act(() => {
      result.current.cancelOperation(operationId);
    });
    expect(activeController.signal.aborted).toBe(true);
    expect(result.current.downloadDetails[operationId]?.[0]?.status).toBe(
      "cancelled",
    );
    expect(result.current.deleteDetails[operationId]?.[0]?.status).toBe(
      "cancelled",
    );
    expect(result.current.copyDetails[operationId]?.[0]?.status).toBe(
      "cancelled",
    );

    const unmountController = result.current.createOperationController(
      "operation-2",
    );
    unmount();
    expect(unmountController.signal.aborted).toBe(true);
  });
});
