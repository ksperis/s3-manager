import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DetailsDrawerShell from "./DetailsDrawerShell";

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("preview");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open details</button>
      {open ? (
        <DetailsDrawerShell
          title="report.csv"
          subtitle={<span title="reports/2026/report.csv">reports/2026/report.csv</span>}
          actions={<button type="button">Download</button>}
          activeTab={tab}
          tabs={[
            { id: "preview", label: "Preview" },
            { id: "details", label: "Details" },
          ]}
          onTabChange={setTab}
          onClose={() => setOpen(false)}
        >
          <div className="w-[80rem]">Drawer content</div>
        </DetailsDrawerShell>
      ) : null}
    </>
  );
}

describe("DetailsDrawerShell", () => {
  beforeEach(() => installMatchMedia(false));

  it("is a non-modal desktop complement with keyboard tabs and clipped horizontal overflow", () => {
    render(<DrawerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    const drawer = screen.getByRole("complementary", { name: "report.csv" });
    expect(drawer).not.toHaveAttribute("aria-modal");
    const panel = within(drawer).getByRole("tabpanel", { name: "Preview" });
    expect(panel).toHaveClass("overflow-x-hidden", "overflow-y-auto");

    const previewTab = within(drawer).getByRole("tab", { name: "Preview" });
    previewTab.focus();
    fireEvent.keyDown(previewTab, { key: "ArrowRight" });
    expect(within(drawer).getByRole("tab", { name: "Details" })).toHaveFocus();
    expect(within(drawer).getByRole("tabpanel", { name: "Details" })).toBeInTheDocument();
  });

  it("becomes modal on narrow screens, closes with Escape, and restores focus", () => {
    installMatchMedia(true);
    render(<DrawerHarness />);
    const opener = screen.getByRole("button", { name: "Open details" });
    opener.focus();
    fireEvent.click(opener);

    const drawer = screen.getByRole("dialog", { name: "report.csv" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "report.csv" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});
