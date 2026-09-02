import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../list/DataTableShell";

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
    expect(screen.getByRole("button", { name: /Name/ })).toHaveClass("uppercase");

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("passes custom page-size options to the shared pagination controls", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();

    render(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        pagination={{
          page: 1,
          pageSize: 200,
          total: 250,
          onPageChange: vi.fn(),
          onPageSizeChange,
          pageSizeOptions: [25, 100, 200],
        }}
      />
    );

    const pageSizeSelect = screen.getByLabelText("Page size");
    expect(screen.getByRole("option", { name: "200" })).toBeInTheDocument();
    await user.selectOptions(pageSizeSelect, "100");

    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });

  it("applies row attributes while keeping shared row styling", () => {
    render(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        rowClassName="selected-row"
        rowAttributes={(row) => ({ "aria-current": row.id === "a" ? "true" : undefined })}
      />
    );

    expect(screen.getByText("Archive").closest("tr")).toHaveClass("selected-row");
    expect(screen.getByText("Archive").closest("tr")).toHaveAttribute("aria-current", "true");
  });

  it("delegates a neutral cell click to the declared default action", async () => {
    const user = userEvent.setup();
    const onDefaultAction = vi.fn();

    render(
      <DataTableShell
        columns={[
          ...columns,
          {
            id: "actions",
            label: "Actions",
            render: () => (
              <button type="button" onClick={onDefaultAction} {...dataTableDefaultActionProps}>
                Open
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    const row = screen.getByText("Archive").closest("tr");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).not.toHaveAttribute("role", "button");

    await user.click(screen.getByText("3"));
    expect(onDefaultAction).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onDefaultAction).toHaveBeenCalledTimes(2);
  });

  it("preserves secondary controls instead of triggering the row action", async () => {
    const user = userEvent.setup();
    const onDefaultAction = vi.fn();
    const onSecondaryAction = vi.fn();

    render(
      <DataTableShell
        columns={[
          {
            ...columns[0],
            render: (row) => (
              <label>
                <input type="checkbox" aria-label={`Select ${row.name}`} />
                {row.name}
              </label>
            ),
          },
          columns[1],
          {
            id: "actions",
            label: "Actions",
            render: () => (
              <div>
                <button type="button" onClick={onDefaultAction} {...dataTableDefaultActionProps}>
                  Open
                </button>
                <button type="button" onClick={onSecondaryAction}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Select Archive" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDefaultAction).not.toHaveBeenCalled();
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it("does not activate disabled or unmarked row actions", async () => {
    const user = userEvent.setup();
    const onDisabledAction = vi.fn();
    const onUnmarkedAction = vi.fn();

    const { rerender } = render(
      <DataTableShell
        columns={[
          ...columns,
          {
            id: "actions",
            label: "Actions",
            render: () => (
              <button type="button" disabled onClick={onDisabledAction} {...dataTableDefaultActionProps}>
                Open
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    await user.click(screen.getByText("3"));
    expect(onDisabledAction).not.toHaveBeenCalled();

    rerender(
      <DataTableShell
        columns={[
          ...columns,
          {
            id: "actions",
            label: "Actions",
            render: () => (
              <button type="button" onClick={onUnmarkedAction}>
                Open
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    await user.click(screen.getByText("3"));
    expect(onUnmarkedAction).not.toHaveBeenCalled();
  });

  it("ignores neutral clicks while text is selected, including in responsive cards", async () => {
    const user = userEvent.setup();
    const onDefaultAction = vi.fn();
    const selectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);

    render(
      <DataTableShell
        columns={[
          ...columns,
          {
            id: "actions",
            label: "Actions",
            mobileRole: "actions",
            render: () => (
              <button type="button" onClick={onDefaultAction} {...dataTableDefaultActionProps}>
                Open
              </button>
            ),
          },
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

    await user.click(screen.getByText("3"));
    expect(onDefaultAction).not.toHaveBeenCalled();
    selectionSpy.mockRestore();
  });

  it("delegates neutral cell clicks in responsive cards", async () => {
    const user = userEvent.setup();
    const onDefaultAction = vi.fn();

    render(
      <DataTableShell
        columns={[
          ...columns,
          {
            id: "actions",
            label: "Actions",
            mobileRole: "actions",
            render: () => (
              <button type="button" onClick={onDefaultAction} {...dataTableDefaultActionProps}>
                Open
              </button>
            ),
          },
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

    await user.click(screen.getByText("3"));

    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(onDefaultAction).toHaveBeenCalledTimes(1);
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
    const actionCell = screen.getByRole("button", { name: "Open" }).closest("td");
    expect(actionCell).toHaveAttribute("data-mobile-actions", "true");
    expect(actionCell).toHaveAttribute("data-table-actions", "true");
    expect(actionCell).toHaveClass("w-px", "whitespace-nowrap", "md:[&>*]:!flex-nowrap");
    const actionHeader = screen.getByRole("columnheader", { name: "Actions" });
    expect(actionHeader).toHaveAttribute("data-table-actions", "true");
    expect(actionHeader).toHaveClass("w-px", "whitespace-nowrap", "md:[&>*]:!flex-nowrap");
  });

  it("can keep responsive actions in the table flow without making them sticky", () => {
    render(
      <DataTableShell
        columns={[
          { ...columns[0], primary: true },
          {
            id: "actions",
            label: "Actions",
            align: "right",
            mobileRole: "actions",
            render: () => <button type="button">Open</button>,
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        responsiveCards
        stickyActions={false}
      />
    );

    const actionCell = screen.getByRole("button", { name: "Open" }).closest("td");
    expect(actionCell).toHaveAttribute("data-mobile-actions", "true");
    expect(actionCell).not.toHaveAttribute("data-table-actions");
    expect(actionCell).toHaveClass("w-px", "whitespace-nowrap", "md:[&>*]:!flex-nowrap");
    const actionHeader = screen.getByRole("columnheader", { name: "Actions" });
    expect(actionHeader).not.toHaveAttribute("data-table-actions");
    expect(actionHeader).toHaveClass("w-px", "whitespace-nowrap", "md:[&>*]:!flex-nowrap");
  });

  it("renders custom column headers for selection controls", () => {
    render(
      <DataTableShell
        columns={[
          {
            id: "select",
            label: "Select",
            header: <input type="checkbox" aria-label="Select all rows" />,
            render: () => <input type="checkbox" aria-label="Select Archive" />,
          },
          ...columns,
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
      />
    );

    expect(screen.getByRole("checkbox", { name: "Select all rows" }).closest("th")).toHaveClass("text-left");
    expect(screen.getByRole("checkbox", { name: "Select Archive" }).closest("td")).not.toHaveAttribute("data-label");
  });

  it("renders optional expanded rows across all columns", () => {
    render(
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status="ready"
        loadingMessage="Loading rows..."
        errorMessage="Unable to load rows."
        emptyMessage="No rows."
        expandedRow={(row) => <span>Details for {row.name}</span>}
      />
    );

    expect(screen.getByText("Details for Archive").closest("tr")).toHaveAttribute("data-expanded-row", "true");
    expect(screen.getByText("Details for Archive").closest("td")).toHaveAttribute("colspan", String(columns.length));
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
