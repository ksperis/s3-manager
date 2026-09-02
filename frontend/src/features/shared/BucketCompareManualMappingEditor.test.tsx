import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BucketCompareManualMappingEditor,
  parseRawMappingText,
} from "./bucketCompareShared";

describe("BucketCompareManualMappingEditor", () => {
  it("keeps raw mappings authoritative and emits editable mapping changes", () => {
    const onRawMappingTextChange = vi.fn();
    const onManualMappingChange = vi.fn();
    const rawMappingText = "source-a => target-a\ninvalid";

    render(
      <BucketCompareManualMappingEditor
        rawMappingText={rawMappingText}
        onRawMappingTextChange={onRawMappingTextChange}
        parsedRawMapping={parseRawMappingText(rawMappingText)}
        sourceBuckets={["source-a", "source-b"]}
        resolvedManualMapping={new Map([["source-b", "source-b"]])}
        manualMapping={{ "source-b": "" }}
        onManualMappingChange={onManualMappingChange}
        availableTargetBucketNames={["target-a", "source-b"]}
        disabled={false}
        controlClass="control"
        compactControlClass="compact"
      />
    );

    fireEvent.click(screen.getByText("Raw mapping (priority)"));
    expect(screen.getByText("Parsed entries: 1. Invalid lines: 1.")).toBeInTheDocument();
    expect(screen.getByText("- invalid")).toBeInTheDocument();

    const targetInputs = screen.getAllByPlaceholderText("target bucket");
    expect(targetInputs[0]).toBeDisabled();
    expect(targetInputs[0]).toHaveValue("target-a");
    expect(screen.getByText("Overridden by raw mapping.")).toBeInTheDocument();
    expect(screen.getByText("Fallback 1:1 applied: source-b")).toBeInTheDocument();

    fireEvent.change(targetInputs[1], { target: { value: "archive" } });
    expect(onManualMappingChange).toHaveBeenCalledWith("source-b", "archive");

    const textarea = screen.getByPlaceholderText(/source-bucket-a/);
    fireEvent.change(textarea, { target: { value: "source-b => archive" } });
    expect(onRawMappingTextChange).toHaveBeenCalledWith("source-b => archive");

    const optionsId = targetInputs[1].getAttribute("list");
    expect(optionsId).toBeTruthy();
    expect(document.getElementById(optionsId ?? "")?.querySelectorAll("option")).toHaveLength(2);
  });
});
