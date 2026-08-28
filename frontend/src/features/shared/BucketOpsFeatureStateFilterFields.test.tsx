/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsFeatureStateFilterFields from "./BucketOpsFeatureStateFilterFields";
import { defaultAdvancedFilter } from "./bucketOpsAdvancedFilterModel";

const featureStateOptions = [
  { id: "versioning" as const, label: "Versioning", supported: true },
  { id: "object_lock" as const, label: "Object Lock", supported: true },
];

describe("BucketOpsFeatureStateFilterFields", () => {
  it("delegates typed feature state changes", () => {
    const onFeatureChange = vi.fn();
    render(
      <BucketOpsFeatureStateFilterFields
        advancedApplied={null}
        advancedDraft={defaultAdvancedFilter}
        featureStateOptions={featureStateOptions}
        onFeatureChange={onFeatureChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Versioning"), {
      target: { value: "suspended" },
    });
    fireEvent.change(screen.getByLabelText("Object Lock"), {
      target: { value: "disabled" },
    });

    expect(onFeatureChange).toHaveBeenCalledWith("versioning", "suspended");
    expect(onFeatureChange).toHaveBeenCalledWith("object_lock", "disabled");
  });

  it("keeps suspended states exclusive to versioning", () => {
    render(
      <BucketOpsFeatureStateFilterFields
        advancedApplied={null}
        advancedDraft={defaultAdvancedFilter}
        featureStateOptions={featureStateOptions}
        onFeatureChange={vi.fn()}
      />,
    );

    const versioning = screen.getByLabelText("Versioning");
    const objectLock = screen.getByLabelText("Object Lock");
    expect(within(versioning).getByRole("option", { name: "Suspended" })).toBeInTheDocument();
    expect(
      within(versioning).getByRole("option", {
        name: "Disabled or Suspended",
      }),
    ).toBeInTheDocument();
    expect(within(objectLock).queryByRole("option", { name: "Suspended" })).not.toBeInTheDocument();
  });

  it("disables unsupported endpoint features and marks changed drafts", () => {
    render(
      <BucketOpsFeatureStateFilterFields
        advancedApplied={{
          ...defaultAdvancedFilter,
          features: { ...defaultAdvancedFilter.features, versioning: "enabled" },
        }}
        advancedDraft={{
          ...defaultAdvancedFilter,
          features: { ...defaultAdvancedFilter.features, versioning: "disabled" },
        }}
        featureStateOptions={[
          featureStateOptions[0],
          { ...featureStateOptions[1], supported: false },
        ]}
        onFeatureChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Some features are disabled on this endpoint and cannot be filtered.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Object Lock")).toBeDisabled();
    expect(screen.getByText("Object Lock is disabled on this endpoint.")).toBeInTheDocument();
    expect(screen.getByLabelText("Versioning")).toHaveClass("border-amber-400");
  });
});
