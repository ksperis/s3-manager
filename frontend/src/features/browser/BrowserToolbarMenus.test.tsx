import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserColumnsMenu,
  BrowserUploadQuickMenu,
} from "./BrowserToolbarMenus";
import type { BrowserColumnId } from "./browserObjectTableModel";

describe("BrowserToolbarMenus", () => {
  it("exposes only the available quick-upload actions", () => {
    const menuRef = createRef<HTMLDivElement>();
    const onUploadFiles = vi.fn();
    const onUploadFolder = vi.fn();
    render(
      <BrowserUploadQuickMenu
        open
        anchorRef={createRef<HTMLButtonElement>()}
        menuRef={menuRef}
        canUploadFiles
        canUploadFolder={false}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
      />,
    );

    const menu = screen.getByRole("menu", { name: "Upload" });
    expect(menuRef.current).toBe(menu);
    const uploadFiles = within(menu).getByRole("menuitem", {
      name: "Upload files",
    });
    const uploadFolder = within(menu).getByRole("menuitem", {
      name: "Upload folder",
    });
    expect(uploadFiles).toBeEnabled();
    expect(uploadFolder).toBeDisabled();

    fireEvent.click(uploadFiles);
    fireEvent.click(uploadFolder);

    expect(onUploadFiles).toHaveBeenCalledOnce();
    expect(onUploadFolder).not.toHaveBeenCalled();
  });

  it("forwards column toggles and reset from the current visibility set", () => {
    const menuRef = createRef<HTMLDivElement>();
    const onToggleColumn = vi.fn();
    const onReset = vi.fn();
    render(
      <BrowserColumnsMenu
        open
        anchorRef={createRef<HTMLButtonElement>()}
        menuRef={menuRef}
        columns={[
          { id: "size", label: "Size" },
          { id: "modified", label: "Modified" },
        ]}
        visibleColumnIds={new Set<BrowserColumnId>(["size"])}
        onToggleColumn={onToggleColumn}
        onReset={onReset}
      />,
    );

    const menu = screen.getByRole("menu", { name: "Columns" });
    expect(menuRef.current).toBe(menu);
    const size = within(menu).getByRole("menuitemcheckbox", { name: "Size" });
    const modified = within(menu).getByRole("menuitemcheckbox", {
      name: "Modified",
    });
    expect(size).toHaveAttribute("aria-checked", "true");
    expect(modified).toHaveAttribute("aria-checked", "false");

    fireEvent.click(modified);
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Reset columns" }),
    );

    expect(onToggleColumn).toHaveBeenCalledWith("modified");
    expect(onReset).toHaveBeenCalledOnce();
  });
});
