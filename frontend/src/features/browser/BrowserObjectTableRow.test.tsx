import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserObjectTableRow from "./BrowserObjectTableRow";
import type { BrowserActionState } from "./browserActions";
import {
  COLUMN_DEFINITIONS,
  createLazyColumnCacheEntry,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";

const fileItem: BrowserItem = {
  id: "object-1",
  key: "reports/object-1.txt",
  name: "object-1.txt",
  type: "file",
  size: "1 KB",
  modified: "25 Aug 2026",
  owner: "owner-1",
  storageClass: "STANDARD",
  etag: "etag-1",
};

const downloadAction: BrowserActionState = {
  id: "download",
  section: "selection",
  label: "Download",
  visible: true,
  enabled: true,
};

const visibleColumns = COLUMN_DEFINITIONS.filter((column) =>
  ["size", "contentType"].includes(column.id),
);

type RowProps = ComponentProps<typeof BrowserObjectTableRow>;

function buildProps(overrides: Partial<RowProps> = {}): RowProps {
  return {
    item: fileItem,
    selected: false,
    compactMode: false,
    nameColumnWidthPx: 320,
    visibleColumns,
    lazyEntry: {
      ...createLazyColumnCacheEntry(),
      contentType: "text/plain",
      metadataStatus: "ready",
    },
    directActions: [downloadAction],
    rowHeightClasses: "row-height",
    rowCellClasses: "row-cell",
    iconBoxClasses: "icon-box",
    nameGapClasses: "name-gap",
    primaryItemButtonHeightClasses: "name-height",
    rowActionButtonClasses: "row-action",
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    onToggleSelection: vi.fn(),
    onNameClick: vi.fn(),
    onRunAction: vi.fn(),
    onOpenActions: vi.fn(),
    ...overrides,
  };
}

function renderRow(props: RowProps) {
  return render(
    <table>
      <tbody>
        <BrowserObjectTableRow {...props} />
      </tbody>
    </table>,
  );
}

describe("BrowserObjectTableRow", () => {
  it("renders a selected file with resolved columns and direct actions", () => {
    const props = buildProps({ selected: true });
    const { container } = renderRow(props);

    const row = container.querySelector("[data-browser-item]");
    expect(row).toHaveAttribute("data-lazy-item-id", "object-1");
    expect(screen.getByRole("checkbox", { name: "Select object-1.txt" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Open file object-1.txt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Object")).toBeInTheDocument();
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("text/plain")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download object-1.txt" }));
    expect(props.onRunAction).toHaveBeenCalledWith("download");
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it("renders deleted objects as non-selectable version entries", () => {
    const props = buildProps({
      item: { ...fileItem, isDeleted: true },
      selected: true,
      directActions: [],
    });
    const { container } = renderRow(props);

    const checkbox = screen.getByRole("checkbox", {
      name: "Select object-1.txt",
    });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(container.querySelector("[data-lazy-item-id]")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open versions for object-1.txt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("(deleted)")).toBeInTheDocument();
    expect(screen.getByText("Deleted object")).toBeInTheDocument();
    expect(screen.getByText("Delete marker")).toBeInTheDocument();
  });

  it("preserves historical folder presentation", () => {
    const props = buildProps({
      item: {
        ...fileItem,
        id: "folder-1",
        key: "reports/",
        name: "reports",
        type: "folder",
        isHistorical: true,
      },
      directActions: [],
    });
    renderRow(props);

    expect(
      screen.getByRole("button", { name: "Open folder reports" }),
    ).toBeInTheDocument();
    expect(screen.getByText("(history)")).toBeInTheDocument();
    expect(screen.getByText("Historical folder")).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });
});
