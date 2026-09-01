import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserObjectTableScaffold,
  BrowserParentFolderRow,
} from "./BrowserObjectTableScaffold";
import {
  COLUMN_DEFINITIONS,
  type BrowserColumnId,
} from "./browserObjectTableModel";

const columns = COLUMN_DEFINITIONS.filter((column) =>
  ["size", "type"].includes(column.id),
);
const columnWidthsPx = Object.fromEntries(
  COLUMN_DEFINITIONS.map((column) => [column.id, column.defaultWidthPx]),
) as Record<BrowserColumnId, number>;

describe("BrowserObjectTableScaffold", () => {
  it("owns table sizing and header interactions", () => {
    const onToggleAll = vi.fn();
    const onSort = vi.fn();
    const onResetColumnWidth = vi.fn();
    const onHeaderContextMenu = vi.fn();
    const resizeHandlers = new Map<BrowserColumnId | "name", ReturnType<typeof vi.fn>>();
    const onStartResize = vi.fn((columnId: BrowserColumnId | "name") => {
      const handler = vi.fn();
      resizeHandlers.set(columnId, handler);
      return handler;
    });
    const { container } = render(
      <BrowserObjectTableScaffold
        minWidthPx={900}
        selectionColumnWidthPx={36}
        nameColumnWidthPx={320}
        actionsColumnWidthPx={108}
        columns={columns}
        columnWidthsPx={columnWidthsPx}
        headerPaddingClasses="header-padding"
        allSelected
        selectionDisabled={false}
        nameHeader={<span>Name controls</span>}
        sortKey="size"
        sortDirection="asc"
        activeResizeColumnId="size"
        onToggleAll={onToggleAll}
        onSort={onSort}
        onStartResize={onStartResize}
        onResetColumnWidth={onResetColumnWidth}
        onHeaderContextMenu={onHeaderContextMenu}
      >
        <tr>
          <td colSpan={5}>Body row</td>
        </tr>
      </BrowserObjectTableScaffold>,
    );

    const table = screen.getByRole("table");
    expect(table).toHaveStyle({ minWidth: "900px" });
    const tableColumns = container.querySelectorAll("col");
    expect(tableColumns).toHaveLength(5);
    expect(tableColumns[0]).toHaveStyle({ width: "36px" });
    expect(tableColumns[1]).not.toHaveAttribute("style");
    expect(tableColumns[4]).toHaveStyle({ width: "108px" });
    expect(screen.getByText("Name controls")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeChecked();
    expect(
      screen.getByRole("columnheader", { name: "Actions" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize Name column" }),
    );
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Resize Size column" }),
    );
    const tableHead = screen
      .getByRole("columnheader", { name: "Actions" })
      .closest("thead");
    if (!tableHead) {
      throw new Error("Expected the Browser object table head.");
    }
    fireEvent.contextMenu(tableHead);

    expect(onToggleAll).toHaveBeenCalledOnce();
    expect(onSort).toHaveBeenCalledWith("size");
    expect(resizeHandlers.get("name")).toHaveBeenCalledOnce();
    expect(onResetColumnWidth).toHaveBeenCalledWith("size");
    expect(onHeaderContextMenu).toHaveBeenCalledOnce();
  });

  it("renders the parent folder row across visible columns", () => {
    const onGoUp = vi.fn();
    const { container } = render(
      <table>
        <tbody>
          <BrowserParentFolderRow
            columns={columns}
            nameColumnWidthPx={320}
            rowHeightClasses="row-height"
            rowCellClasses="row-cell"
            iconBoxClasses="icon-box"
            onGoUp={onGoUp}
          />
        </tbody>
      </table>,
    );

    const row = container.querySelector("tr");
    expect(row?.cells).toHaveLength(5);
    expect(screen.getAllByText("-")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Parent folder" }));
    expect(onGoUp).toHaveBeenCalledOnce();
  });
});
