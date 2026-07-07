import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTableShell, { type DataTableColumn } from "../list/DataTableShell";

type Row = {
  id: string;
  name: string;
  count: number;
};

const rows: Row[] = [{ id: "a", name: "Archive", count: 3 }];
const columns: Array<DataTableColumn<Row, "name" | "count">> = [
  { id: "name", label: "Name", field: "name", render: (row) => row.name },
  { id: "count", label: "Count", field: "count", align: "right", render: (row) => row.count },
];

describe("DataTableShell", () => {
  it("renders sortable rows and pagination through shared primitives", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const onPageChange = vi.fn();

    render(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        primaryColumnId="name"
        sort={{ field: "name", direction: "asc", onSort }}
        pagination={{ page: 1, pageSize: 10, total: 11, onPageChange }}
      />
    );

    expect(screen.getByRole("table")).toHaveClass("manager-table");
    expect(screen.getByText("Archive")).toHaveClass("font-semibold");
    expect(screen.getByRole("columnheader", { name: "Count" })).toHaveClass("text-right");

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders empty state messages in the table body", () => {
    render(
      <DataTableShell
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        status="empty"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    expect(screen.getByText("No rows.")).toBeInTheDocument();
  });

  it("adds mobile card labels only when responsive cards are enabled", () => {
    render(
      <DataTableShell
        columns={[
          { ...columns[0], primary: true },
          columns[1],
          { id: "actions", label: "Actions", align: "right", mobileRole: "actions", render: () => <button type="button">Open</button> },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        responsiveCards
      />
    );

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(screen.getByText("Archive").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("3").closest("td")).toHaveAttribute("data-label", "Count");
    expect(screen.getByRole("button", { name: "Open" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
  });

  it("keeps responsive tables fully clipped when horizontal overflow is disabled", () => {
    const { rerender } = render(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        responsiveCards
      />
    );

    const getOverflowContainer = () => screen.getByRole("table").parentElement;
    expect(getOverflowContainer()).toHaveClass("overflow-x-hidden", "md:overflow-x-auto");

    rerender(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        responsiveCards
        overflowXHidden
      />
    );

    expect(getOverflowContainer()).toHaveClass("overflow-x-hidden");
    expect(getOverflowContainer()).not.toHaveClass("md:overflow-x-auto");
  });
});
