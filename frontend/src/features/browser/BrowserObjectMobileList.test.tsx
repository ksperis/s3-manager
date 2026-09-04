import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserObjectMobileList from "./BrowserObjectMobileList";
import type { BrowserItem } from "./browserTypes";

const fileItem: BrowserItem = {
  id: "object-1",
  key: "reports/object-1.txt",
  name: "object-1.txt",
  type: "file",
  size: "1 KB",
  modified: "25 Aug 2026",
  owner: "owner-1",
  storageClass: "STANDARD",
  etag: "etag-1",
};

type MobileListProps = ComponentProps<typeof BrowserObjectMobileList>;

function buildProps(
  overrides: Partial<MobileListProps> = {},
): MobileListProps {
  return {
    items: [],
    selectedIds: new Set<string>(),
    loading: false,
    hasBucket: true,
    showParentFolder: false,
    hasActiveSearchFilters: false,
    workspaceNoun: "bucket",
    workspaceObjectNounPlural: "objects",
    rowActionButtonClasses: "row-action",
    onGoUp: vi.fn(),
    onItemContextMenu: vi.fn(),
    onToggleSelection: vi.fn(),
    onItemNameClick: vi.fn(),
    onOpenActions: vi.fn(),
    ...overrides,
  };
}

describe("BrowserObjectMobileList", () => {
  it("renders parent navigation and contextual empty states", () => {
    const props = buildProps({
      showParentFolder: true,
      issueTitle: "Object listing failed",
    });
    const { rerender } = render(<BrowserObjectMobileList {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Parent folder" }));
    expect(props.onGoUp).toHaveBeenCalledOnce();
    expect(screen.getByText("Object listing failed")).toBeInTheDocument();

    rerender(
      <BrowserObjectMobileList
        {...props}
        hasBucket={false}
        showParentFolder={false}
        issueTitle={undefined}
      />,
    );
    expect(
      screen.getByText("Select a bucket to browse objects."),
    ).toBeInTheDocument();
  });

  it("routes file interactions without treating controls as row selection", () => {
    const props = buildProps({
      items: [fileItem],
      selectedIds: new Set([fileItem.id]),
    });
    render(<BrowserObjectMobileList {...props} />);
    const row = screen.getByRole("listitem");

    expect(row).toHaveAttribute("data-lazy-item-id", fileItem.id);
    expect(
      screen.getByRole("checkbox", { name: "Select object-1.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Open file object-1.txt" }),
    ).toBeInTheDocument();
    expect(row).toHaveClass("bg-primary-100/90");

    fireEvent.click(row);
    fireEvent.contextMenu(row);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select object-1.txt" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open file object-1.txt" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More actions for object-1.txt" }),
    );

    expect(props.onItemNameClick).toHaveBeenCalledTimes(2);
    expect(props.onItemNameClick).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      fileItem,
    );
    expect(props.onItemContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      fileItem,
    );
    expect(props.onToggleSelection).toHaveBeenCalledWith(fileItem, false);
    expect(props.onItemNameClick).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      fileItem,
    );
    expect(props.onOpenActions).toHaveBeenCalledWith(
      expect.anything(),
      fileItem,
    );
  });

  it("keeps deleted and historical entries distinguishable", () => {
    const deletedItem: BrowserItem = {
      ...fileItem,
      id: "deleted-1",
      isDeleted: true,
    };
    const historicalFolder: BrowserItem = {
      ...fileItem,
      id: "history-1",
      key: "reports/",
      name: "reports",
      type: "folder",
      isHistorical: true,
    };
    const props = buildProps({
      items: [deletedItem, historicalFolder],
      selectedIds: new Set([deletedItem.id]),
    });
    const { container } = render(<BrowserObjectMobileList {...props} />);

    const deletedCheckbox = screen.getByRole("checkbox", {
      name: "Select object-1.txt",
    });
    expect(deletedCheckbox).toBeDisabled();
    expect(deletedCheckbox).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Open versions for object-1.txt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(container.querySelector('[data-lazy-item-id="deleted-1"]')).toBeNull();

    fireEvent.click(screen.getAllByRole("listitem")[0]);
    expect(props.onItemNameClick).toHaveBeenCalledWith(
      expect.anything(),
      deletedItem,
    );
  });
});
