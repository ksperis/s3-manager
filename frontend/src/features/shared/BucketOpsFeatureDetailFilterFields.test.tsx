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
    Object.keys(defaultFeatureDetailFilters).forEach((field) => {
      expect(
        document.getElementById("bucket-ops-feature-detail-" + field),
      ).toBeInTheDocument();
    });

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

  it("preserves typed mode, option, and comparison controls", () => {
    const onFieldChange = vi.fn();
    render(
      <BucketOpsFeatureDetailFilterFields
        filters={{
          ...defaultFeatureDetailFilters,
          lifecycleRuleTypeMode: "has",
          notificationRuleTypeMode: "has",
        }}
        onFieldChange={onFieldChange}
        sseFeatureEnabled
      />,
    );

    const ruleTypeValues = screen.getAllByLabelText("Rule type value");
    expect(
      within(ruleTypeValues[0]).getByRole("option", {
        name: "Expiration (current versions)",
      }),
    ).toBeInTheDocument();
    expect(
      within(ruleTypeValues[1]).getByRole("option", {
        name: "Topic configurations",
      }),
    ).toBeInTheDocument();
    expect(
      within(ruleTypeValues[1]).queryByRole("option", { name: "EventBridge" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rule name mode"), {
      target: { value: "has_not_named" },
    });
    fireEvent.change(screen.getByLabelText("Website routing rules operator"), {
      target: { value: ">=" },
    });

    expect(onFieldChange).toHaveBeenCalledWith(
      "lifecycleRuleNameMode",
      "has_not_named",
    );
    expect(onFieldChange).toHaveBeenCalledWith(
      "websiteRoutingRuleCountOp",
      ">=",
    );
  });
});
