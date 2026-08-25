import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BrowserTransferOperationGroupCard } from "./BrowserOperationCards";
import type { OperationItem } from "./browserTypes";

const baseOperation: OperationItem = {
  id: "operation-1",
  label: "Transfer reports",
  path: "documents/reports",
  progress: 40,
  status: "downloading",
  kind: "download",
  cancelable: true,
};

const allSections = {
  active: true,
  queued: true,
  completed: true,
  failed: true,
};

describe("BrowserTransferOperationGroupCard", () => {
  it("renders and routes a paginated download group", () => {
    const onToggleExpanded = vi.fn();
    const onShowMore = vi.fn();
    const onCancel = vi.fn();
    const onDownloadDetails = vi.fn();
    render(
      <BrowserTransferOperationGroupCard
        kind="download"
        group={{
          op: baseOperation,
          items: [
            {
              id: "active",
              label: "active.txt",
              status: "downloading",
              sizeBytes: 1024,
            },
            {
              id: "queued-1",
              label: "queued-1.txt",
              status: "queued",
              sizeBytes: 2048,
            },
            {
              id: "queued-2",
              label: "queued-2.txt",
              status: "queued",
              sizeBytes: 4096,
            },
            {
              id: "done",
              label: "done.txt",
              status: "done",
              sizeBytes: 8192,
            },
            {
              id: "failed",
              label: "failed.txt",
              status: "failed",
              sizeBytes: 16_384,
              errorMessage: "Network failure",
            },
          ],
        }}
        expanded
        sections={allSections}
        getSectionVisibleCount={() => 1}
        onToggleExpanded={onToggleExpanded}
        onShowMore={onShowMore}
        onCancel={onCancel}
        onDownloadDetails={onDownloadDetails}
      />,
    );

    expect(
      screen.getByText("1 active · 2 queued · 1 completed · 1 failed · 40%"),
    ).toBeInTheDocument();
    expect(screen.getByText("Downloading · 1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Network failure")).toBeInTheDocument();
    expect(screen.queryByText("queued-2.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Show next 10" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download details (JSON)" }),
    );

    expect(onToggleExpanded).toHaveBeenCalledWith("operation-1");
    expect(onCancel).toHaveBeenCalledWith("operation-1");
    expect(onShowMore).toHaveBeenCalledWith("operation-1", "queued");
    expect(onDownloadDetails).toHaveBeenCalledWith(
      "download",
      "operation-1",
    );
  });

  it("keeps delete-specific labels and omits object sizes", () => {
    render(
      <BrowserTransferOperationGroupCard
        kind="delete"
        group={{
          op: {
            ...baseOperation,
            status: "deleting",
            kind: "delete",
          },
          items: [
            {
              id: "active",
              label: "obsolete.txt",
              status: "deleting",
              sizeBytes: 1024,
            },
          ],
        }}
        expanded
        sections={allSections}
        getSectionVisibleCount={() => 25}
        onToggleExpanded={vi.fn()}
        onShowMore={vi.fn()}
        onCancel={vi.fn()}
        onDownloadDetails={vi.fn()}
      />,
    );

    expect(screen.getByText("Deleting")).toBeInTheDocument();
    expect(screen.queryByText(/1.0 KB/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop all" })).toBeInTheDocument();
  });

  it.each([
    ["download", "Preparing download list..."],
    ["delete", "Preparing delete list..."],
    ["copy", "Preparing copy list..."],
  ] as const)("renders the %s empty-state contract", (kind, emptyLabel) => {
    render(
      <BrowserTransferOperationGroupCard
        kind={kind}
        group={{
          op: {
            ...baseOperation,
            status:
              kind === "download"
                ? "downloading"
                : kind === "delete"
                  ? "deleting"
                  : "copying",
            kind,
          },
          items: [],
        }}
        expanded
        sections={allSections}
        getSectionVisibleCount={() => 25}
        onToggleExpanded={vi.fn()}
        onShowMore={vi.fn()}
        onCancel={vi.fn()}
        onDownloadDetails={vi.fn()}
      />,
    );

    expect(screen.getByText(emptyLabel)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download details (JSON)" }),
    ).toBeInTheDocument();
  });
});
