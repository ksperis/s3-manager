import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserObjectExplorer from "./BrowserObjectExplorer";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  resolveBrowserActions,
} from "./browserActions";
import {
  COLUMN_DEFINITIONS,
  type BrowserColumnId,
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

const visibleColumns = COLUMN_DEFINITIONS.filter(
  (column) => column.id === "size",
);
const columnWidthsPx = Object.fromEntries(
  COLUMN_DEFINITIONS.map((column) => [column.id, column.defaultWidthPx]),
) as Record<BrowserColumnId, number>;

type ExplorerProps = ComponentProps<typeof BrowserObjectExplorer>;

function buildProps(overrides: Partial<ExplorerProps> = {}): ExplorerProps {
  return {
    viewportRef: createRef<HTMLDivElement>(),
    dragging: false,
    mobile: false,
    bucketName: "documents",
    normalizedPrefix: "reports/",
    workspaceNoun: "bucket",
    workspaceObjectNounPlural: "objects",
    items: [fileItem],
    selectedIds: new Set([fileItem.id]),
    loading: false,
    loadingMore: false,
    canLoadMore: false,
    objectsIsTruncated: false,
    deletedObjectsIsTruncated: false,
    showDeletedObjects: false,
    showParentFolder: false,
    hasActiveSearchFilters: true,
    searchStatusChips: [{ label: "Query", value: "object" }],
    issue: null,
    lazyColumnCache: {},
    isPortalProfile: false,
    table: {
      scaffold: {
        minWidthPx: 720,
        selectionColumnWidthPx: 36,
        nameColumnWidthPx: 320,
        actionsColumnWidthPx: 108,
        columns: visibleColumns,
        columnWidthsPx,
        headerPaddingClasses: "header-padding",
        allSelected: true,
        selectionDisabled: false,
        nameHeader: <span>Name controls</span>,
        sortKey: "name",
        sortDirection: "asc",
        activeResizeColumnId: null,
        onToggleAll: vi.fn(),
        onSort: vi.fn(),
        onStartResize: vi.fn(() => vi.fn()),
        onResetColumnWidth: vi.fn(),
        onHeaderContextMenu: vi.fn(),
      },
      row: {
        compactMode: false,
        rowHeightClasses: "row-height",
        rowCellClasses: "row-cell",
        iconBoxClasses: "icon-box",
        nameGapClasses: "name-gap",
        primaryItemButtonHeightClasses: "name-height",
        rowActionButtonClasses: "row-action",
      },
    },
    loadMoreButtonClasses: "load-more",
    resolveItemActions: (item) =>
      resolveBrowserActions({
        scope: "item",
        items: [item],
        bucketName: "documents",
        hasS3AccountContext: true,
        versioningEnabled: true,
        canPaste: true,
        functionalProfile: "advanced",
        capabilityFacts: FULL_BROWSER_CAPABILITY_FACTS,
        previewAvailable: true,
      }),
    onDragEnter: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    onPathContextMenu: vi.fn(),
    onListBackgroundClick: vi.fn(),
    onListKeyDown: vi.fn(),
    onGoUp: vi.fn(),
    onSelectItem: vi.fn(),
    onItemDoubleClick: vi.fn(),
    onItemContextMenu: vi.fn(),
    onToggleSelection: vi.fn(),
    onItemNameClick: vi.fn(),
    onRunItemAction: vi.fn(),
    onOpenActions: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
}

describe("BrowserObjectExplorer", () => {
  it("composes desktop search, table rows, and item interactions", () => {
    const props = buildProps();
    render(<BrowserObjectExplorer {...props} />);

    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("1 result")).toBeInTheDocument();
    expect(screen.getByTitle("Query: object")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    const row = screen.getByRole("button", {
      name: "Open file object-1.txt",
    }).closest("tr");
    if (!row) throw new Error("Expected the object table row.");

    fireEvent.click(row);
    fireEvent.doubleClick(row);
    fireEvent.contextMenu(row);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select object-1.txt" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download object-1.txt" }),
    );

    expect(props.onSelectItem).toHaveBeenCalledTimes(1);
    expect(props.onSelectItem).toHaveBeenCalledWith(
      expect.anything(),
      fileItem,
    );
    expect(props.onItemDoubleClick).toHaveBeenCalledWith(
      expect.anything(),
      fileItem,
    );
    expect(props.onItemContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      fileItem,
    );
    expect(props.onToggleSelection).toHaveBeenCalledWith(fileItem);
    expect(props.onRunItemAction).toHaveBeenCalledWith(fileItem, "download");
  });

  it("keeps deleted rows non-selectable and exposes deleted-history pagination", () => {
    const deletedItem = { ...fileItem, isDeleted: true };
    const props = buildProps({
      items: [deletedItem],
      selectedIds: new Set([deletedItem.id]),
      canLoadMore: true,
      deletedObjectsIsTruncated: true,
    });
    render(<BrowserObjectExplorer {...props} />);

    const deletedRow = screen.getByRole("button", {
      name: "Open versions for object-1.txt",
    }).closest("tr");
    if (!deletedRow) throw new Error("Expected the deleted object row.");
    fireEvent.click(deletedRow);
    expect(props.onSelectItem).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Select object-1.txt" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Continue loading deleted files",
      }),
    );
    expect(props.onLoadMore).toHaveBeenCalledOnce();
  });

  it("renders drag feedback and delegates mobile presentation", () => {
    const props = buildProps({
      dragging: true,
      mobile: true,
      showParentFolder: true,
      hasActiveSearchFilters: false,
    });
    const { container } = render(<BrowserObjectExplorer {...props} />);

    expect(screen.getByText("Drop files or folders to upload")).toBeInTheDocument();
    expect(screen.getByText("documents/reports/")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Objects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parent folder" }));
    expect(props.onGoUp).toHaveBeenCalledOnce();

    const explorer = container.firstElementChild;
    if (!explorer) throw new Error("Expected the explorer root.");
    fireEvent.dragEnter(explorer);
    fireEvent.dragOver(explorer);
    fireEvent.dragLeave(explorer);
    fireEvent.drop(explorer);
    expect(props.onDragEnter).toHaveBeenCalledOnce();
    expect(props.onDragOver).toHaveBeenCalledOnce();
    expect(props.onDragLeave).toHaveBeenCalledOnce();
    expect(props.onDrop).toHaveBeenCalledOnce();
  });
});
