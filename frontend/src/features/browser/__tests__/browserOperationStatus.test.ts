import { describe, expect, it } from "vitest";

import {
  buildOperationStatusPill,
  operationCompletionLabel,
  operationInProgressStatusClasses,
} from "../browserOperationStatus";

describe("browserOperationStatus", () => {
  it("maps active operation types to the shared status colors", () => {
    expect(operationInProgressStatusClasses("uploading")).toContain("bg-emerald-100");
    expect(operationInProgressStatusClasses("downloading")).toContain("bg-amber-100");
    expect(operationInProgressStatusClasses("copying")).toContain("bg-sky-100");
    expect(operationInProgressStatusClasses("deleting")).toContain("bg-rose-100");
  });

  it("prioritizes failed and queued states for operation status pills", () => {
    expect(
      buildOperationStatusPill({
        hasFailed: true,
        isCompleted: false,
        queuedOnly: false,
        status: "copying",
      })
    ).toMatchObject({ label: "Failed", classes: expect.stringContaining("bg-rose-100") });

    expect(
      buildOperationStatusPill({
        hasFailed: false,
        isCompleted: false,
        queuedOnly: true,
        status: "downloading",
      })
    ).toMatchObject({ label: "Queued", classes: expect.stringContaining("bg-slate-100") });
  });

  it("keeps completed labels aligned across the operations panel and modal", () => {
    expect(operationCompletionLabel()).toBe("Completed");
    expect(operationCompletionLabel("done")).toBe("Completed");
    expect(operationCompletionLabel("cancelled")).toBe("Cancelled");
    expect(operationCompletionLabel("failed")).toBe("Failed");
  });
});
