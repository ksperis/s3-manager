/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BucketOpsColumnControls from "./BucketOpsColumnControls";

const featureColumnOptions = [
  { id: "versioning" as const, label: "Versioning" },
  { id: "object_lock" as const, label: "Object Lock" },
];

describe("BucketOpsColumnControls", () => {
  it("owns menu visibility and closes it on outside interaction", async () => {
    const user = userEvent.setup();
    render(
      <BucketOpsColumnControls
        defaultVisibleColumns={["owner"]}
        featureColumnOptions={featureColumnOptions}
        isStorageOps={false}
        onReset={vi.fn()}
        onToggle={vi.fn()}
        visibleColumns={["owner"]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Columns" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Visible columns")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Visible columns")).not.toBeInTheDocument();
  });

  it("filters context columns by surface and delegates toggles", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <BucketOpsColumnControls
        defaultVisibleColumns={["owner"]}
        featureColumnOptions={featureColumnOptions}
        isStorageOps={false}
        onReset={vi.fn()}
        onToggle={onToggle}
        visibleColumns={["owner"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByLabelText("Context")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Owner"));
    expect(onToggle).toHaveBeenCalledWith("owner");

    rerender(
      <BucketOpsColumnControls
        defaultVisibleColumns={["owner"]}
        featureColumnOptions={featureColumnOptions}
        isStorageOps
        onReset={vi.fn()}
        onToggle={onToggle}
        visibleColumns={["owner"]}
      />,
    );
    expect(screen.getByLabelText("Context")).toBeInTheDocument();
  });

  it("enables the external reset only for customized columns", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(
      <BucketOpsColumnControls
        defaultVisibleColumns={["owner"]}
        featureColumnOptions={featureColumnOptions}
        isStorageOps={false}
        onReset={onReset}
        onToggle={vi.fn()}
        visibleColumns={["owner"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Reset Columns" })).toBeDisabled();
    rerender(
      <BucketOpsColumnControls
        defaultVisibleColumns={["tenant"]}
        featureColumnOptions={featureColumnOptions}
        isStorageOps={false}
        onReset={onReset}
        onToggle={vi.fn()}
        visibleColumns={["owner"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reset Columns" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
