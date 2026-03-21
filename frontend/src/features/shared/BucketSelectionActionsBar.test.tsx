import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import type { ActionProgressState } from "./actionProgress";

const baseProps = {
  selectedCount: 2,
  hiddenSelectedCount: 0,
  clearSelection: vi.fn(),
  availableUiTags: [],
  selectedUiTagSuggestions: [],
  selectionTagAddInput: "",
  setSelectionTagAddInput: vi.fn(),
  parsedSelectionTagAddInput: [],
  selectionTagActionLoading: null as "add" | "remove" | null,
  applyUiTagToSelection: vi.fn(),
  selectionExportLoading: null as "text" | "csv" | "json" | null,
  exportSelectedBuckets: vi.fn(),
  selectionActionProgress: null as ActionProgressState | null,
  isStorageOps: false,
  onShowCompareModal: vi.fn(),
  openBulkUpdateModal: vi.fn(),
};

describe("BucketSelectionActionsBar progress", () => {
  it("renders selection action progress with percent and failures", () => {
    render(
      <BucketSelectionActionsBar
        {...baseProps}
        selectionActionProgress={{
          label: "Preparing CSV export",
          completed: 4,
          total: 10,
          failed: 2,
        }}
      />
    );

    expect(screen.getByText("Preparing CSV export · 4 / 10")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Failures so far: 2")).toBeInTheDocument();
  });

  it("does not render progress card when no action is running", () => {
    render(<BucketSelectionActionsBar {...baseProps} />);
    expect(screen.queryByText(/Failures so far:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Preparing CSV export/)).not.toBeInTheDocument();
  });

  it("keeps existing actions usable", () => {
    const openBulkUpdateModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} openBulkUpdateModal={openBulkUpdateModal} />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk update" }));
    expect(openBulkUpdateModal).toHaveBeenCalledTimes(1);
  });
});
