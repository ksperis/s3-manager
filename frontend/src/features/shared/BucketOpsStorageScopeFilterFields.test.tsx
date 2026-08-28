/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsStorageScopeFilterFields from "./BucketOpsStorageScopeFilterFields";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";

type ScopeController = ComponentProps<
  typeof BucketOpsStorageScopeFilterFields
>["controller"];

function createController(): ScopeController {
  const context = {
    id: "account:7",
    name: "Finance",
    kind: "account" as const,
    typeLabel: "Account",
    endpointName: "endpoint-a",
    tagItems: [],
    haystack: "finance endpoint-a account",
  };
  const endpoint = {
    name: "endpoint-a",
    contextNames: ["Finance"],
    tagItems: [],
    haystack: "endpoint-a finance",
  };

  return {
    allFilteredStorageOpsContextsSelected: false,
    allFilteredStorageOpsEndpointsSelected: false,
    deselectFilteredStorageOpsContexts: vi.fn(),
    deselectFilteredStorageOpsEndpoints: vi.fn(),
    filteredStorageOpsContextItems: [context],
    filteredStorageOpsEndpointItems: [endpoint],
    hasFilteredStorageOpsContextSelection: true,
    hasFilteredStorageOpsEndpointSelection: true,
    selectFilteredStorageOpsContexts: vi.fn(),
    selectFilteredStorageOpsEndpoints: vi.fn(),
    setStorageOpsContextFilter: vi.fn(),
    setStorageOpsEndpointFilter: vi.fn(),
    storageOpsContextFilter: "",
    storageOpsContextItems: [context],
    storageOpsContextLabelById: new Map([[context.id, context.name]]),
    storageOpsContextSelectionSet: new Set([context.id]),
    storageOpsContextsError: null,
    storageOpsContextsLoading: false,
    storageOpsEndpointFilter: "",
    storageOpsEndpointItems: [endpoint],
    storageOpsEndpointSelectionSet: new Set<string>(),
    toggleAdvancedContextId: vi.fn(),
    toggleAdvancedEndpointName: vi.fn(),
  };
}

describe("BucketOpsStorageScopeFilterFields", () => {
  it("renders scope projections and delegates every selection control", () => {
    const controller = createController();
    const neutralFieldState = buildAdvancedFilterFieldState(false, false);
    render(
      <BucketOpsStorageScopeFilterFields
        contextDraftIds={["account:7"]}
        contextFieldState={neutralFieldState}
        controller={controller}
        endpointDraftNames={[]}
        endpointFieldState={neutralFieldState}
      />,
    );

    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("endpoint-a").length).toBeGreaterThan(0);
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter contexts"), {
      target: { value: "fin" },
    });
    fireEvent.change(screen.getByLabelText("Filter endpoints"), {
      target: { value: "endpoint" },
    });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Deselect filtered" })[1]);

    expect(controller.setStorageOpsContextFilter).toHaveBeenCalledWith("fin");
    expect(controller.setStorageOpsEndpointFilter).toHaveBeenCalledWith("endpoint");
    expect(controller.toggleAdvancedContextId).toHaveBeenCalledWith("account:7");
    expect(controller.toggleAdvancedEndpointName).toHaveBeenCalledWith("endpoint-a");
    expect(controller.selectFilteredStorageOpsContexts).toHaveBeenCalledOnce();
    expect(controller.deselectFilteredStorageOpsEndpoints).toHaveBeenCalledOnce();
  });

  it("shows shared loading and error states for context and endpoint lists", () => {
    const neutralFieldState = buildAdvancedFilterFieldState(false, false);
    const loadingController = {
      ...createController(),
      storageOpsContextsLoading: true,
    };
    const { rerender } = render(
      <BucketOpsStorageScopeFilterFields
        contextDraftIds={[]}
        contextFieldState={neutralFieldState}
        controller={loadingController}
        endpointDraftNames={[]}
        endpointFieldState={neutralFieldState}
      />,
    );

    expect(screen.getByText("Loading contexts...")).toBeInTheDocument();
    expect(screen.getByText("Loading endpoints...")).toBeInTheDocument();

    rerender(
      <BucketOpsStorageScopeFilterFields
        contextDraftIds={[]}
        contextFieldState={neutralFieldState}
        controller={{
          ...createController(),
          storageOpsContextsError: "Unable to load scopes",
        }}
        endpointDraftNames={[]}
        endpointFieldState={neutralFieldState}
      />,
    );

    expect(screen.getAllByText("Unable to load scopes")).toHaveLength(2);
  });
});
