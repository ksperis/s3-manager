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
  onShowIntegrityModal: vi.fn(),
  onShowUsageStatsModal: vi.fn(),
  openBulkUpdateModal: vi.fn(),
};

describe("BucketSelectionActionsBar progress", () => {
  const openActions = () => {
    fireEvent.click(screen.getByRole("button", { name: "Actions for 2 selected buckets" }));
  };

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
    expect(screen.getByRole("progressbar", { name: "Preparing CSV export progress" })).toHaveAttribute(
      "aria-valuenow",
      "40"
    );
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
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Configure selected buckets…" }));
    expect(openBulkUpdateModal).toHaveBeenCalledTimes(1);
  });

  it("opens the integrity action from selection", () => {
    const onShowIntegrityModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowIntegrityModal={onShowIntegrityModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Check object integrity…" }));
    expect(onShowIntegrityModal).toHaveBeenCalledTimes(1);
  });

  it("opens the purge action from selection when available", () => {
    const onShowPurgeModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowPurgeModal={onShowPurgeModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Purge bucket contents…" }));
    expect(onShowPurgeModal).toHaveBeenCalledTimes(1);
  });

  it("opens the config backup action for ceph-admin selections", () => {
    const onShowConfigBackupModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowConfigBackupModal={onShowConfigBackupModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back up bucket configurations…" }));
    expect(onShowConfigBackupModal).toHaveBeenCalledTimes(1);
  });

  it("hides config backup for storage-ops selections", () => {
    render(<BucketSelectionActionsBar {...baseProps} isStorageOps onShowConfigBackupModal={vi.fn()} />);
    openActions();
    expect(screen.queryByRole("menuitem", { name: "Back up bucket configurations…" })).not.toBeInTheDocument();
  });

  it("moves focus through the grouped action menu and returns it on Escape", () => {
    render(<BucketSelectionActionsBar {...baseProps} />);
    const trigger = screen.getByRole("button", { name: "Actions for 2 selected buckets" });
    fireEvent.click(trigger);
    const firstItem = screen.getByRole("menuitem", { name: "Manage UI tags…" });
    expect(firstItem).toHaveFocus();
    fireEvent.keyDown(firstItem, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Export selection…" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("disables RGW bulk index checks above the 200 bucket limit", () => {
    render(<BucketSelectionActionsBar {...baseProps} selectedCount={201} onShowIndexCheckModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for 201 selected buckets" }));
    expect(screen.getByRole("menuitem", { name: /Check bucket indexes…/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/limited to 200 buckets/i)).toBeInTheDocument();
  });
});
