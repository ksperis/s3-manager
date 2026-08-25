import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserObjectSearchHeader from "./BrowserObjectSearchHeader";

const buildProps = (
  overrides: Partial<ComponentProps<typeof BrowserObjectSearchHeader>> = {},
): ComponentProps<typeof BrowserObjectSearchHeader> => ({
  rootRef: createRef<HTMLDivElement>(),
  optionsButtonRef: createRef<HTMLButtonElement>(),
  optionsMenuRef: createRef<HTMLDivElement>(),
  portalProfile: false,
  optionsOpen: false,
  filter: "",
  objectNounPlural: "objects",
  nameSortActive: true,
  sortDirection: "asc",
  advancedOptionsActive: false,
  hasSearchQuery: false,
  searchScope: "prefix",
  recursive: false,
  exactMatch: false,
  caseSensitive: false,
  typeFilter: "all",
  storageFilter: "all",
  storageClasses: ["STANDARD", "GLACIER"],
  canReset: false,
  onSortName: vi.fn(),
  onFilterChange: vi.fn(),
  onToggleOptions: vi.fn(),
  onScopeChange: vi.fn(),
  onRecursiveChange: vi.fn(),
  onExactMatchChange: vi.fn(),
  onCaseSensitiveChange: vi.fn(),
  onTypeFilterChange: vi.fn(),
  onStorageFilterChange: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe("BrowserObjectSearchHeader", () => {
  it("forwards search, sort, and advanced-option interactions", () => {
    const rootRef = createRef<HTMLDivElement>();
    const optionsButtonRef = createRef<HTMLButtonElement>();
    const optionsMenuRef = createRef<HTMLDivElement>();
    const onSortName = vi.fn();
    const onFilterChange = vi.fn();
    const onToggleOptions = vi.fn();
    const onScopeChange = vi.fn();
    const onRecursiveChange = vi.fn();
    const onExactMatchChange = vi.fn();
    const onCaseSensitiveChange = vi.fn();
    const onTypeFilterChange = vi.fn();
    const onStorageFilterChange = vi.fn();
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(
      <BrowserObjectSearchHeader
        {...buildProps({
          rootRef,
          optionsButtonRef,
          optionsMenuRef,
          optionsOpen: true,
          filter: "invoice",
          advancedOptionsActive: true,
          hasSearchQuery: true,
          canReset: true,
          onSortName,
          onFilterChange,
          onToggleOptions,
          onScopeChange,
          onRecursiveChange,
          onExactMatchChange,
          onCaseSensitiveChange,
          onTypeFilterChange,
          onStorageFilterChange,
          onClear,
          onClose,
        })}
      />,
    );

    const optionsButton = screen.getByRole("button", {
      name: "Search options",
    });
    expect(optionsButtonRef.current).toBe(optionsButton);
    expect(rootRef.current).toContainElement(optionsButton);
    expect(optionsMenuRef.current).toContainElement(
      screen.getByRole("combobox", { name: "Search scope" }),
    );
    expect(optionsButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search objects" }), {
      target: { value: "report" },
    });
    fireEvent.click(optionsButton);
    fireEvent.change(screen.getByRole("combobox", { name: "Search scope" }), {
      target: { value: "bucket" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Search recursively in subfolders",
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Use exact match" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Case-sensitive search" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Object type filter" }),
      { target: { value: "file" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Storage class filter" }),
      { target: { value: "GLACIER" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSortName).toHaveBeenCalledOnce();
    expect(onFilterChange).toHaveBeenCalledWith("report");
    expect(onToggleOptions).toHaveBeenCalledOnce();
    expect(onScopeChange).toHaveBeenCalledWith("bucket");
    expect(onRecursiveChange).toHaveBeenCalledWith(true);
    expect(onExactMatchChange).toHaveBeenCalledWith(true);
    expect(onCaseSensitiveChange).toHaveBeenCalledWith(true);
    expect(onTypeFilterChange).toHaveBeenCalledWith("file");
    expect(onStorageFilterChange).toHaveBeenCalledWith("GLACIER");
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps query-dependent controls disabled until a query exists", () => {
    render(
      <BrowserObjectSearchHeader
        {...buildProps({ optionsOpen: true, searchScope: "bucket" })}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Search scope" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Search recursively in subfolders",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Use exact match" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Case-sensitive search" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("keeps the Portal profile on the simple search contract", () => {
    render(
      <BrowserObjectSearchHeader
        {...buildProps({ portalProfile: true, optionsOpen: true })}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Search objects" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search options" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Search scope" }),
    ).not.toBeInTheDocument();
  });
});
