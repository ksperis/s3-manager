import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ObjectDetailsDrawer from "./ObjectDetailsDrawer";

describe("ObjectDetailsDrawer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("uses the shared floating menu and lets Escape dismiss it before the drawer", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();

    render(
      <ObjectDetailsDrawer
        name="report.csv"
        path="reports/2026/report.csv"
        copyPathLabel="Copy path"
        moreLabel="More"
        onCopyPath={vi.fn()}
        onClose={onClose}
        secondaryActions={[
          {
            id: "delete",
            label: "Delete",
            tone: "danger",
            onSelect: onDelete,
          },
        ]}
      >
        Drawer content
      </ObjectDetailsDrawer>,
    );

    const moreButton = screen.getByRole("button", { name: "More" });
    fireEvent.click(moreButton);
    expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
