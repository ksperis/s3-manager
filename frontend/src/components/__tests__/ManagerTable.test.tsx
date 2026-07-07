import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import ManagerTable from "../list/ManagerTable";

describe("ManagerTable", () => {
  it("renders manager table structure, column alignment, and body children", () => {
    render(
      <ManagerTable
        columns={[
          { key: "name", label: "Name" },
          { key: "actions", label: "Actions", align: "right" },
          { key: "select", label: "Select", hideLabel: true },
        ]}
      >
        <tr>
          <td>logs-prod</td>
          <td>Edit</td>
        </tr>
      </ManagerTable>
    );

    expect(screen.getByRole("table")).toHaveClass("manager-table");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("text-left");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: "Select" }).querySelector(".sr-only")).toHaveTextContent("Select");
    expect(screen.getByText("logs-prod")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("adds shared responsive-card metadata when requested", () => {
    render(
      <ManagerTable
        responsiveCards
        columns={[
          { key: "select", label: "Select", hideLabel: true, mobileLabel: "Select" },
          { key: "bucket", label: "Bucket", mobileRole: "primary" },
          { key: "actions", label: "Actions", align: "right", mobileRole: "actions" },
        ]}
      >
        <tr>
          <td>
            <input aria-label="Select logs-prod" type="checkbox" />
          </td>
          <td>logs-prod</td>
          <td>
            <button type="button">Open</button>
          </td>
        </tr>
      </ManagerTable>
    );

    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-hidden", "md:overflow-x-auto");
    expect(screen.getByRole("checkbox", { name: "Select logs-prod" }).closest("td")).toHaveAttribute("data-label", "Select");
    expect(screen.getByText("logs-prod").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByRole("button", { name: "Open" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
  });

  it("renders sortable column labels through the shared header", () => {
    const onSort = vi.fn();

    render(
      <ManagerTable
        columns={[
          { key: "name", label: "Name", sortField: "name" },
          { key: "created", label: "Created", sortField: "created" },
        ]}
        sort={{ field: "name", direction: "asc", onSort }}
      >
        <tr>
          <td>logs-prod</td>
          <td>2026-01-01</td>
        </tr>
      </ManagerTable>
    );

    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "Created" })).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByRole("button", { name: "Created" }));

    expect(onSort).toHaveBeenCalledWith("created");
  });

  it("leaves spanning table states unlabelled in responsive-card mode", () => {
    render(
      <ManagerTable
        responsiveCards
        columns={[
          { key: "bucket", label: "Bucket", mobileRole: "primary" },
          { key: "status", label: "Status" },
        ]}
      >
        <tr>
          <td colSpan={2}>No buckets.</td>
        </tr>
      </ManagerTable>
    );

    expect(screen.getByText("No buckets.").closest("td")).not.toHaveAttribute("data-label");
    expect(screen.getByText("No buckets.").closest("td")).not.toHaveAttribute("data-mobile-primary");
  });

  it("renders shared loading, error, and empty list states", () => {
    const columns = [
      { key: "bucket", label: "Bucket", mobileRole: "primary" as const },
      { key: "status", label: "Status" },
    ];
    const { rerender } = render(
      <ManagerTable
        columns={columns}
        listState={{
          status: "loading",
          loadingMessage: "Loading buckets...",
          errorMessage: "Unable to load buckets.",
          emptyMessage: "No buckets.",
        }}
        responsiveCards
      >
        {null}
      </ManagerTable>
    );

    expect(screen.getByText("Loading buckets...").closest("td")).toHaveAttribute("colspan", "2");

    rerender(
      <ManagerTable
        columns={columns}
        listState={{
          status: "error",
          loadingMessage: "Loading buckets...",
          errorMessage: "Unable to load buckets.",
          emptyMessage: "No buckets.",
        }}
        responsiveCards
      >
        {null}
      </ManagerTable>
    );

    expect(screen.getByText("Unable to load buckets.")).toBeInTheDocument();

    rerender(
      <ManagerTable
        columns={columns}
        listState={{
          status: "empty",
          loadingMessage: "Loading buckets...",
          errorMessage: "Unable to load buckets.",
          emptyMessage: "No buckets.",
        }}
        responsiveCards
      >
        {null}
      </ManagerTable>
    );

    expect(screen.getByText("No buckets.").closest("td")).not.toHaveAttribute("data-mobile-primary");
  });
});
