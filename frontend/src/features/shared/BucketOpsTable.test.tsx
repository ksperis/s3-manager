/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsTable, { type BucketOpsTableColumn } from "./BucketOpsTable";

const columns: BucketOpsTableColumn[] = [
  {
    id: "select",
    label: "",
    header: <input aria-label="Select all" type="checkbox" />,
    render: (bucket) => (
      <input aria-label={`Select ${bucket.name}`} type="checkbox" />
    ),
  },
  {
    id: "name",
    label: "Name",
    field: "name",
    render: (bucket) => bucket.name,
  },
  {
    id: "used_bytes",
    label: "Used",
    field: "used_bytes",
    expensive: true,
    render: (bucket) => bucket.used_bytes,
  },
];

const bucket = { name: "archive", tenant: "tenant-a", used_bytes: 42 };

describe("BucketOpsTable", () => {
  it("renders sticky columns, detail loading state, and available sorting", () => {
    const onSort = vi.fn();
    const { container } = render(
      <BucketOpsTable
        columns={columns}
        detailLoadingColumnIds={new Set(["used_bytes"])}
        items={[bucket]}
        loadingDetails
        onSort={onSort}
        showAdvancedFilter
        sort={{ field: "name", direction: "asc" }}
        status="ready"
        usageFeatureEnabled
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));

    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.getByRole("columnheader", { name: "Select all" })).toHaveClass(
      "sticky",
      "left-0",
    );
    expect(screen.getByText("archive").closest("td")).toHaveClass(
      "sticky",
      "left-10",
    );
    expect(screen.getByRole("columnheader", { name: "Used" })).toHaveClass(
      "animate-pulse",
    );
    expect(screen.getByText("42").closest("td")).toHaveClass(
      "animate-pulse",
      "bg-amber-100/70",
    );
    expect(container.firstElementChild).toHaveClass("overflow-x-hidden");
  });

  it("disables statistics sorting when usage data is unavailable", () => {
    render(
      <BucketOpsTable
        columns={columns}
        detailLoadingColumnIds={new Set()}
        items={[bucket]}
        loadingDetails={false}
        onSort={vi.fn()}
        showAdvancedFilter={false}
        sort={{ field: "name", direction: "asc" }}
        status="ready"
        usageFeatureEnabled={false}
      />,
    );

    expect(
      within(screen.getByRole("columnheader", { name: "Used" })).queryByRole(
        "button",
      ),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["loading", "Loading buckets..."],
    ["error", "Unable to load buckets."],
    ["empty", "No buckets."],
  ] as const)("renders the %s table status", (status, message) => {
    render(
      <BucketOpsTable
        columns={columns}
        detailLoadingColumnIds={new Set()}
        items={[]}
        loadingDetails={false}
        onSort={vi.fn()}
        showAdvancedFilter={false}
        sort={{ field: "name", direction: "asc" }}
        status={status}
        usageFeatureEnabled
      />,
    );

    expect(screen.getByText(message)).toHaveAttribute("colspan", "3");
  });
});
