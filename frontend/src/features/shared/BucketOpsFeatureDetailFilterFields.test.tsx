/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultFeatureDetailFilters } from "../cephAdmin/filtering/bucketAdvancedFilter";
import BucketOpsFeatureDetailFilterFields from "./BucketOpsFeatureDetailFilterFields";

describe("BucketOpsFeatureDetailFilterFields", () => {
  it("renders every feature group and delegates representative changes", () => {
    const onFieldChange = vi.fn();
    render(
      <BucketOpsFeatureDetailFilterFields
        filters={defaultFeatureDetailFilters}
        onFieldChange={onFieldChange}
        sseFeatureEnabled
      />,
    );

    [
      "Lifecycle",
      "Notifications",
      "Object Lock and BPA",
      "CORS and Logging",
      "Website and Policy",
      "Server-side encryption",
    ].forEach((title) => expect(screen.getByText(title)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("incoming/"), {
      target: { value: "archive/" },
    });
    fireEvent.change(screen.getByPlaceholderText("AES256"), {
      target: { value: "aws:kms" },
    });
    const websiteAndPolicyCard = screen.getByText("Website and Policy").parentElement;
    expect(websiteAndPolicyCard).not.toBeNull();
    fireEvent.change(
      within(websiteAndPolicyCard as HTMLElement).getAllByPlaceholderText("count")[0],
      { target: { value: "3" } },
    );

    expect(onFieldChange).toHaveBeenCalledWith(
      "notificationFilterPrefixValue",
      "archive/",
    );
    expect(onFieldChange).toHaveBeenCalledWith("sseAlgorithm", "aws:kms");
    expect(onFieldChange).toHaveBeenCalledWith(
      "websiteRoutingRuleCount",
      "3",
    );
  });

  it("disables only server-side encryption fields when unavailable", () => {
    render(
      <BucketOpsFeatureDetailFilterFields
        filters={defaultFeatureDetailFilters}
        onFieldChange={vi.fn()}
        sseFeatureEnabled={false}
      />,
    );

    expect(
      screen.getByText("Server-side encryption is disabled on this endpoint."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("AES256")).toBeDisabled();
    expect(screen.getByPlaceholderText("key-id or ARN")).toBeDisabled();
    expect(screen.getByPlaceholderText("GET")).toBeEnabled();
  });
});
