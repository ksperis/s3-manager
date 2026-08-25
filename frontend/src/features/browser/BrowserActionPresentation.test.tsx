import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserActionIcon,
  BrowserDirectItemActionButton,
  BrowserToolbarActionMenuItem,
} from "./BrowserActionPresentation";
import type { BrowserActionState } from "./browserActions";

const enabledDownloadAction: BrowserActionState = {
  id: "download",
  section: "selection",
  label: "Download",
  visible: true,
  enabled: true,
};

describe("BrowserActionPresentation", () => {
  it("renders icons for actions omitted by the old partial mapping", () => {
    const { container } = render(
      <>
        <BrowserActionIcon actionId="refresh" />
        <BrowserActionIcon actionId="toggleShowFolders" />
        <BrowserActionIcon actionId="properties" />
      </>,
    );

    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });

  it("runs direct row actions without selecting the row", () => {
    const onSelect = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <BrowserDirectItemActionButton
          action={enabledDownloadAction}
          itemName="report.txt"
          className="row-action"
          onSelect={onSelect}
        />
      </div>,
    );

    const button = screen.getByRole("button", {
      name: "Download report.txt",
    });
    expect(button).toHaveClass("row-action");
    expect(button).toHaveAttribute("title", "Download");

    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("preserves disabled reasons and menu item behavior", () => {
    const onDirectSelect = vi.fn();
    const onMenuSelect = vi.fn();
    const disabledDeleteAction: BrowserActionState = {
      id: "delete",
      section: "selection",
      label: "Delete",
      visible: true,
      enabled: false,
      disabledReason: "Read-only access",
    };
    const { rerender } = render(
      <BrowserDirectItemActionButton
        action={disabledDeleteAction}
        itemName="report.txt"
        className="row-action"
        onSelect={onDirectSelect}
      />,
    );

    const directButton = screen.getByRole("button", {
      name: "Delete report.txt. Unavailable: Read-only access",
    });
    expect(directButton).toBeDisabled();
    expect(directButton).toHaveClass("text-rose-600");
    expect(directButton).toHaveAttribute("title", "Read-only access");
    fireEvent.click(directButton);
    expect(onDirectSelect).not.toHaveBeenCalled();

    rerender(
      <BrowserToolbarActionMenuItem
        action={enabledDownloadAction}
        onSelect={onMenuSelect}
      />,
    );
    const menuItem = screen.getByRole("menuitem", { name: "Download" });
    fireEvent.click(menuItem);
    expect(onMenuSelect).toHaveBeenCalledOnce();
  });
});
