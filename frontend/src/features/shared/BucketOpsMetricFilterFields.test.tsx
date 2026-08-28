/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsMetricFilterFields from "./BucketOpsMetricFilterFields";
import { defaultAdvancedFilter } from "./bucketOpsAdvancedFilterModel";

describe("BucketOpsMetricFilterFields", () => {
  it("delegates typed metric range changes", () => {
    const onFieldChange = vi.fn();
    render(
      <BucketOpsMetricFilterFields
        advancedApplied={null}
        advancedDraft={defaultAdvancedFilter}
        onFieldChange={onFieldChange}
        usageFeatureEnabled
        usageUnavailableDescription="Stats unavailable"
      />,
    );

    fireEvent.change(screen.getByLabelText("Usage Bytes minimum"), {
      target: { value: "1024" },
    });
    fireEvent.change(screen.getByLabelText("Owner quota Objects maximum"), {
      target: { value: "500" },
    });

    expect(onFieldChange).toHaveBeenCalledWith("minUsedBytes", "1024");
    expect(onFieldChange).toHaveBeenCalledWith("maxOwnerQuotaObjects", "500");
  });

  it("disables stats ranges while keeping owner quota filters available", () => {
    render(
      <BucketOpsMetricFilterFields
        advancedApplied={null}
        advancedDraft={defaultAdvancedFilter}
        onFieldChange={vi.fn()}
        usageFeatureEnabled={false}
        usageUnavailableDescription="Stats unavailable for this endpoint."
      />,
    );

    expect(screen.getByText("Stats unavailable for this endpoint.")).toBeInTheDocument();
    expect(screen.getByLabelText("Usage Bytes minimum")).toBeDisabled();
    expect(screen.getByLabelText("Quota Objects maximum")).toBeDisabled();
    expect(
      screen.getByLabelText("Owner usage % Size % minimum"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Owner quota Bytes minimum")).toBeEnabled();
  });

  it("marks changed bounds as an unsaved draft", () => {
    render(
      <BucketOpsMetricFilterFields
        advancedApplied={{ ...defaultAdvancedFilter, minUsedBytes: "100" }}
        advancedDraft={{ ...defaultAdvancedFilter, minUsedBytes: "200" }}
        onFieldChange={vi.fn()}
        usageFeatureEnabled
        usageUnavailableDescription="Stats unavailable"
      />,
    );

    expect(screen.getByLabelText("Usage Bytes minimum")).toHaveClass(
      "border-amber-400",
    );
  });
});
