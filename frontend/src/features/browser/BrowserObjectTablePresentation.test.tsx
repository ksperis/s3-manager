import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserColumnResizeHandle,
  BrowserObjectColumnHeaderContent,
  BrowserObjectColumnValue,
} from "./BrowserObjectTablePresentation";
import {
  COLUMN_DEFINITIONS,
  createLazyColumnCacheEntry,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime } from "./browserUtils";

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

describe("BrowserObjectTablePresentation", () => {
  it("renders immediate and lazy object column states", () => {
    const readyEntry = {
      ...createLazyColumnCacheEntry(),
      tagsCount: 3,
      restoreStatus: "Restored until 2026-08-25T10:00:00Z",
      metadataStatus: "ready" as const,
      tagsStatus: "ready" as const,
    };
    const { rerender } = render(
      <BrowserObjectColumnValue
        item={fileItem}
        columnId="tagsCount"
        lazyEntry={readyEntry}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();

    rerender(
      <BrowserObjectColumnValue
        item={fileItem}
        columnId="restoreStatus"
        lazyEntry={readyEntry}
      />,
    );
    expect(
      screen.getByText(
        `Restored until ${formatDateTime("2026-08-25T10:00:00Z")}`,
      ),
    ).toBeInTheDocument();

    rerender(
      <BrowserObjectColumnValue
        item={fileItem}
        columnId="contentType"
        lazyEntry={{
          ...createLazyColumnCacheEntry(),
          metadataStatus: "loading",
        }}
      />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(
      <BrowserObjectColumnValue
        item={fileItem}
        columnId="contentType"
        lazyEntry={{
          ...createLazyColumnCacheEntry(),
          metadataStatus: "error",
        }}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();

    rerender(
      <BrowserObjectColumnValue
        item={{ ...fileItem, type: "folder", isHistorical: true }}
        columnId="type"
      />,
    );
    expect(screen.getByText("Historical folder")).toBeInTheDocument();
  });

  it("keeps sortable and passive column headers distinct", () => {
    const onSort = vi.fn();
    const sizeColumn = COLUMN_DEFINITIONS.find(
      (column) => column.id === "size",
    );
    const typeColumn = COLUMN_DEFINITIONS.find(
      (column) => column.id === "type",
    );
    if (!sizeColumn || !typeColumn) {
      throw new Error("Expected browser table columns are missing.");
    }

    const { rerender } = render(
      <BrowserObjectColumnHeaderContent
        column={sizeColumn}
        sortKey="size"
        sortDirection="asc"
        onSort={onSort}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(onSort).toHaveBeenCalledWith("size");

    rerender(
      <BrowserObjectColumnHeaderContent
        column={typeColumn}
        sortKey="size"
        sortDirection="asc"
        onSort={onSort}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Type" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("owns resize interactions without leaking click events", () => {
    const onPointerDown = vi.fn();
    const onReset = vi.fn();
    const onParentClick = vi.fn();
    const onParentContextMenu = vi.fn();
    render(
      <div onClick={onParentClick} onContextMenu={onParentContextMenu}>
        <BrowserColumnResizeHandle
          label="Modified"
          active
          onPointerDown={onPointerDown}
          onReset={onReset}
        />
      </div>,
    );

    const handle = screen.getByRole("separator", {
      name: "Resize Modified column",
    });
    expect(handle).toHaveStyle({ width: "12px" });

    fireEvent.pointerDown(handle);
    fireEvent.doubleClick(handle);
    fireEvent.click(handle);
    fireEvent.contextMenu(handle);

    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentContextMenu).not.toHaveBeenCalled();
  });
});
