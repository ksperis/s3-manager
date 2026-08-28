/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import BucketOpsAdvancedFilterDrawer from "./BucketOpsAdvancedFilterDrawer";
import {
  FEATURE_STATE_OPTIONS,
  defaultAdvancedFilter,
  type AdvancedFilterState,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import type { BucketListState } from "./bucketOpsListState";
import { useBucketOpsFilterController } from "./useBucketOpsFilterController";

const featureSupport = Object.fromEntries(
  FEATURE_STATE_OPTIONS.map(({ id }) => [id, true]),
) as Record<FeatureKey, boolean>;
const featureStateOptions = FEATURE_STATE_OPTIONS.map((option) => ({
  ...option,
  supported: true,
}));

type DrawerHarnessProps = {
  initialDraft?: AdvancedFilterState;
};

function DrawerHarness({
  initialDraft = defaultAdvancedFilter,
}: DrawerHarnessProps) {
  const [advancedApplied, setAdvancedApplied] =
    useState<AdvancedFilterState | null>(null);
  const [advancedDraft, setAdvancedDraft] =
    useState<AdvancedFilterState>(initialDraft);
  const [filter, setFilter] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [, setPage] = useState(1);
  const [quickFilterMode, setQuickFilterMode] =
    useState<TextMatchMode>("contains");
  const [, setTagFilterMode] =
    useState<BucketListState["tagFilterMode"]>("any");
  const [, setTagFilters] = useState<number[]>([]);
  const controller = useBucketOpsFilterController({
    advancedApplied,
    advancedDraft,
    featureSupport,
    filter,
    filterValue,
    isStorageOps: false,
    quickFilterMode,
    setAdvancedApplied,
    setAdvancedDraft,
    setFilter,
    setFilterValue,
    setPage,
    setQuickFilterMode,
    setTagFilterMode,
    setTagFilters,
    usageFeatureEnabled: true,
  });

  return (
    <>
      <button type="button" onClick={controller.openAdvancedFilterDrawer}>
        Open advanced filter
      </button>
      <output data-testid="applied-tenant">
        {advancedApplied?.tenant ?? ""}
      </output>
      <output data-testid="draft-tenant">{advancedDraft.tenant}</output>
      <BucketOpsAdvancedFilterDrawer
        advancedApplied={advancedApplied}
        advancedDraft={advancedDraft}
        controller={controller}
        draftSummaryItems={
          advancedDraft.tenant
            ? [{ id: "tenant", label: `Tenant: ${advancedDraft.tenant}` }]
            : []
        }
        featureStateOptions={featureStateOptions}
        isStorageOps={false}
        sseFeatureEnabled
        usageFeatureEnabled
        usageUnavailableBadge="Unavailable"
        usageUnavailableDescription="Stats unavailable"
      />
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("BucketOpsAdvancedFilterDrawer", () => {
  it("guards a pending draft before closing", async () => {
    const user = userEvent.setup();
    render(
      <DrawerHarness
        initialDraft={{ ...defaultAdvancedFilter, tenant: "finance" }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open advanced filter" }),
    );
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);

    expect(
      screen.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(
      screen.queryByRole("button", { name: "Apply filters" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-tenant")).toHaveTextContent("");
  });

  it("applies the current draft and closes", async () => {
    const user = userEvent.setup();
    render(
      <DrawerHarness
        initialDraft={{ ...defaultAdvancedFilter, tenant: "finance" }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open advanced filter" }),
    );
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(screen.getByTestId("applied-tenant")).toHaveTextContent("finance");
    expect(
      screen.queryByRole("button", { name: "Apply filters" }),
    ).not.toBeInTheDocument();
  });

  it("toggles advanced sections and clears the draft", async () => {
    const user = userEvent.setup();
    render(
      <DrawerHarness
        initialDraft={{
          ...defaultAdvancedFilter,
          tenant: "finance",
          minOwnerQuotaBytes: "1",
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open advanced filter" }),
    );
    const metricsSection = screen.getByRole("button", {
      name: /Storage Metrics and Quota/,
    });
    expect(metricsSection).toHaveAttribute("aria-expanded", "true");

    await user.click(metricsSection);
    expect(metricsSection).toHaveAttribute("aria-expanded", "false");
    await user.click(metricsSection);
    expect(metricsSection).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByTestId("draft-tenant")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  });
});
