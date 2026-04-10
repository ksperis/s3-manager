import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "../Layout";
import {
  DESKTOP_SIDEBAR_SESSION_STORAGE_KEY,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_COMPACT_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "../sidebarSizing";

vi.mock("../../api/auth", () => ({
  logout: vi.fn(() => Promise.resolve()),
}));

vi.mock("../Header", () => ({
  default: ({ title }: { title: string }) => <div data-testid="layout-header">{title}</div>,
}));

vi.mock("../Topbar", () => ({
  default: ({
    mobileMenuOpen,
    onMobileMenuToggle,
    showMobileMenuButton,
  }: {
    mobileMenuOpen: boolean;
    onMobileMenuToggle: () => void;
    showMobileMenuButton?: boolean;
  }) => (
    <div data-testid="layout-topbar">
      {showMobileMenuButton ? (
        <button type="button" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} onClick={onMobileMenuToggle}>
          Menu
        </button>
      ) : null}
    </div>
  ),
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          element={
            <Layout
              headerTitle="Manager"
              sidebarTitle="MANAGER"
              sidebarAction={<button type="button">Quick action</button>}
              navSections={[
                {
                  label: "Overview",
                  links: [
                    { to: "/", label: "Dashboard", end: true },
                    { to: "/metrics", label: "Metrics" },
                  ],
                },
              ]}
            />
          }
        >
          <Route index element={<div>Dashboard content</div>} />
          <Route path="metrics" element={<div>Metrics content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function getDesktopSidebar(container: HTMLElement) {
  const element = container.querySelector('[data-sidebar-variant="desktop"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function getMobileSidebar(container: HTMLElement) {
  const element = container.querySelector('[data-sidebar-variant="mobile"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("Layout", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("restores the desktop sidebar width from session storage", () => {
    window.sessionStorage.setItem(DESKTOP_SIDEBAR_SESSION_STORAGE_KEY, "320");

    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);

    expect(desktopSidebar).toHaveStyle({ width: "320px" });
    expect(within(desktopSidebar).getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
      "aria-valuenow",
      "320"
    );
  });

  it("supports pointer resize with compact and max-width bounds", () => {
    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);
    const separator = within(desktopSidebar).getByRole("separator", { name: "Resize sidebar" });

    fireEvent.pointerDown(separator, { button: 0, clientX: 256 });
    fireEvent.pointerMove(window, { clientX: 180 });
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_COMPACT_WIDTH}px` });

    fireEvent.pointerMove(window, { clientX: 640 });
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_MAX_WIDTH}px` });
    fireEvent.pointerUp(window);
  });

  it("supports keyboard resize and hides sidebar action in compact mode", () => {
    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);
    const separator = within(desktopSidebar).getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(separator, { key: "Home" });
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_COMPACT_WIDTH}px` });
    expect(within(desktopSidebar).queryByText("Quick action")).not.toBeInTheDocument();

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_COLLAPSE_THRESHOLD}px` });

    fireEvent.keyDown(separator, { key: "End" });
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_MAX_WIDTH}px` });
    expect(within(desktopSidebar).getByText("Quick action")).toBeInTheDocument();
  });

  it("keeps the mobile drawer behavior unchanged and without a resize handle", () => {
    const { container } = renderLayout();
    const mobileSidebar = getMobileSidebar(container);
    const mobilePanel = container.querySelector("#mobile-navigation-panel");

    expect(mobilePanel).toHaveClass("w-[18.5rem]");
    expect(within(mobileSidebar).queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
    expect(mobileSidebar).toHaveClass("-translate-x-full");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(mobileSidebar).toHaveClass("translate-x-0");

    fireEvent.click(screen.getByRole("button", { name: "Close mobile navigation" }));
    expect(mobileSidebar).toHaveClass("-translate-x-full");
  });
});
