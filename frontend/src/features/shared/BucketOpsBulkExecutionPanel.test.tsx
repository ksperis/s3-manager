/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsBulkExecutionPanel, {
  type BucketOpsBulkExecutionPanelProps,
} from "./BucketOpsBulkExecutionPanel";

const createProps = (
  overrides: Partial<BucketOpsBulkExecutionPanelProps> = {},
): BucketOpsBulkExecutionPanelProps => ({
  applyDisabled: true,
  applyError: null,
  applyLoading: false,
  applyProgress: null,
  applySummary: null,
  copyDisabled: true,
  copyError: null,
  copyLoading: false,
  copyProgress: null,
  copySummary: null,
  onApply: vi.fn(),
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onExport: vi.fn(),
  onPreview: vi.fn(),
  operation: "enable_versioning",
  pasteError: null,
  previewDisabled: true,
  previewError: null,
  previewItems: [],
  previewLoading: false,
  previewProgress: null,
  previewReady: false,
  ...overrides,
});

describe("BucketOpsBulkExecutionPanel", () => {
  it("renders a ready preview and delegates its actions", () => {
    const props = createProps({
      applyDisabled: false,
      previewDisabled: false,
      previewItems: [
        {
          bucket: "archive",
          before: [{ text: "Disabled", tone: "removed" }],
          after: [{ text: "Enabled", tone: "added" }],
          changed: true,
        },
      ],
      previewReady: true,
    });
    render(<BucketOpsBulkExecutionPanel {...props} />);

    expect(screen.getByText("Changes: 1 / Unchanged: 0 / Errors: 0")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getByText("Versioning")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Export changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onPreview).toHaveBeenCalledOnce();
    expect(props.onExport).toHaveBeenCalledOnce();
    expect(props.onApply).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps copy configuration on its dedicated action path", () => {
    const props = createProps({
      copyDisabled: false,
      copySummary: "Copied 2 bucket configurations.",
      operation: "copy_configs",
    });
    render(<BucketOpsBulkExecutionPanel {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy selected configs" }),
    );

    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(
      screen.getByText("Copied 2 bucket configurations."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply changes" }),
    ).not.toBeInTheDocument();
  });

  it("renders paste errors and shared progress without duplicating progress markup", () => {
    render(
      <BucketOpsBulkExecutionPanel
        {...createProps({
          operation: "paste_configs",
          pasteError: "Destination mapping is incomplete.",
          previewLoading: true,
          previewProgress: {
            label: "Previewing changes",
            completed: 1,
            total: 2,
            failed: 1,
          },
        })}
      />,
    );

    expect(
      screen.getByText("Destination mapping is incomplete."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Previewing changes · 1 / 2 buckets"),
    ).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Failures so far: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previewing..." })).toBeDisabled();
  });
});
