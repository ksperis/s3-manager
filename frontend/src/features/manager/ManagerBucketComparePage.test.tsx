/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerBucketComparePage from "./ManagerBucketComparePage";

const clearSelection = vi.fn();
const selectAllFiltered = vi.fn();
const setFilter = vi.fn();
const toggleBucket = vi.fn();
const useManagerBucketSelectionMock = vi.fn();

vi.mock("./useManagerBucketSelection", () => ({
  useManagerBucketSelection: () => useManagerBucketSelectionMock(),
}));

vi.mock("./useManagerContexts", () => ({
  useManagerContexts: () => ({
    contexts: [
      { id: "context-1", display_name: "Primary account" },
      { id: "context-2", display_name: "Secondary account" },
    ],
    contextsLoading: false,
    contextsError: null,
  }),
}));

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({ managerBrowserEnabled: true }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      browser_enabled: true,
      browser_manager_enabled: true,
    },
  }),
}));

vi.mock("./ManagerBucketCompareModal", () => ({
  default: (props: {
    sourceContextId: string;
    sourceContextName: string;
    sourceBuckets: string[];
    contexts: Array<{ id: string }>;
    managerBrowserEnabled: boolean;
  }) => (
    <div data-testid="compare-modal">
      {props.sourceContextId}|{props.sourceContextName}|{props.sourceBuckets.join(",")}|
      {props.contexts.length}|{String(props.managerBrowserEnabled)}
    </div>
  ),
}));

describe("ManagerBucketComparePage", () => {
  beforeEach(() => {
    clearSelection.mockReset();
    selectAllFiltered.mockReset();
    setFilter.mockReset();
    toggleBucket.mockReset();
    useManagerBucketSelectionMock.mockReturnValue({
      clearSelection,
      error: null,
      filter: "",
      filteredBuckets: [{ name: "alpha" }, { name: "beta" }],
      loading: false,
      requiresS3AccountSelection: true,
      selectedBucketList: ["alpha"],
      selectedBuckets: new Set(["alpha"]),
      selectAllFiltered,
      setFilter,
      sourceContext: { id: "context-1", display_name: "Primary account" },
      sourceContextId: "context-1",
      tableStatus: "ready",
      toggleBucket,
    });
  });

  it("delegates source inventory selection and opens compare with the shared result", () => {
    render(
      <MemoryRouter>
        <ManagerBucketComparePage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Filter source buckets"), {
      target: { value: "alp" },
    });
    expect(setFilter).toHaveBeenCalledWith("alp");

    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    expect(selectAllFiltered).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearSelection).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select beta" }));
    expect(toggleBucket).toHaveBeenCalledWith("beta");

    fireEvent.click(screen.getByRole("button", { name: "Compare selected (1)" }));
    expect(screen.getByTestId("compare-modal")).toHaveTextContent(
      "context-1|Primary account|alpha|2|true",
    );
  });
});
