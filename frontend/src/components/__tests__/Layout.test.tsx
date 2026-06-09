import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "../Layout";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_DEFAULT_WIDTH } from "../sidebarSizing";

const mocks = vi.hoisted(() => ({
  workspaceSwitcherModel: null as {
    currentWorkspaceId: string;
    currentWorkspaceLabel: string;
    options: Array<{ value: string; label: string }>;
    onChange: (next: string) => void;
  } | null,
}));

vi.mock("../../api/auth", () => ({
  logout: vi.fn(() => Promise.resolve()),
}));

vi.mock("../EnvironmentSwitcher", () => ({
  useWorkspaceSwitcherModel: () => mocks.workspaceSwitcherModel,
  workspaceIconById: () => null,
}));

vi.mock("../Header", () => ({
  default: ({ title }: { title: string }) => <div data-testid="layout-header">{title}</div>,
}));

vi.mock("../Topbar", () => ({
  default: ({
    mobileMenuOpen,
    onMobileMenuToggle,
    showMobileMenuButton,
    showWorkspaceSwitcher,
  }: {
    mobileMenuOpen: boolean;
    onMobileMenuToggle: () => void;
    showMobileMenuButton?: boolean;
    showWorkspaceSwitcher?: boolean;
  }) => (
    <div data-testid="layout-topbar" data-show-workspace-switcher={String(showWorkspaceSwitcher)}>
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
    mocks.workspaceSwitcherModel = null;
  });

  it("renders the desktop sidebar at the fixed expanded width", () => {
    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);

    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_DEFAULT_WIDTH}px` });
    expect(within(desktopSidebar).queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
  });

  it("lets route content shrink so wide inner lists can scroll horizontally", () => {
    const { container } = renderLayout();
    const main = container.querySelector("main");
    const outletWrapper = screen.getByText("Dashboard content").parentElement;

    expect(main).toHaveClass("min-w-0");
    expect(outletWrapper).toHaveClass("min-w-0");
  });

  it("keeps a slightly wider page gutter on standard workspaces", () => {
    const { container } = renderLayout();
    const main = container.querySelector("main");

    expect(main).toHaveClass("px-4", "sm:px-8");
  });

  it("collapses and expands the desktop sidebar", () => {
    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);

    fireEvent.click(within(desktopSidebar).getByRole("button", { name: "Collapse sidebar" }));
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_COMPACT_WIDTH}px` });
    expect(within(desktopSidebar).queryByText("Quick action")).not.toBeInTheDocument();

    fireEvent.click(within(desktopSidebar).getByRole("button", { name: "Expand sidebar" }));
    expect(desktopSidebar).toHaveStyle({ width: `${SIDEBAR_DEFAULT_WIDTH}px` });
    expect(within(desktopSidebar).getByText("Quick action")).toBeInTheDocument();
  });

  it("renders custom sidebar content without the collapse control", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route
            path="/browser"
            element={
              <Layout
                headerTitle="Browser"
                hideHeader
                sidebarContent={<div>Bucket navigation slot</div>}
                sidebarContentLabel="Browser bucket navigation"
                sidebarWidthPx={280}
                allowSidebarCollapse={false}
              />
            }
          >
            <Route index element={<div>Browser content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const desktopSidebar = getDesktopSidebar(container);
    expect(desktopSidebar).toHaveStyle({ width: "280px" });
    expect(within(desktopSidebar).getByRole("region", { name: "Browser bucket navigation" })).toHaveTextContent(
      "Bucket navigation slot",
    );
    expect(within(desktopSidebar).queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    expect(screen.getByTestId("layout-topbar")).toHaveAttribute("data-show-workspace-switcher", "true");
  });

  it("keeps the mobile drawer behavior unchanged and without a resize handle", () => {
    const { container } = renderLayout();
    const mobileSidebar = getMobileSidebar(container);
    const mobilePanel = container.querySelector("#mobile-navigation-panel");

    expect(mobilePanel).toHaveClass("w-[16rem]");
    expect(within(mobileSidebar).queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
    expect(mobileSidebar).toHaveClass("-translate-x-full");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(mobileSidebar).toHaveClass("translate-x-0");

    fireEvent.click(screen.getByRole("button", { name: "Close mobile navigation" }));
    expect(mobileSidebar).toHaveClass("-translate-x-full");
  });

  it("keeps the workspace switcher in the topbar when the sidebar is visible", () => {
    const onWorkspaceChange = vi.fn();
    mocks.workspaceSwitcherModel = {
      currentWorkspaceId: "manager",
      currentWorkspaceLabel: "Manager",
      options: [
        { value: "manager", label: "Manager" },
        { value: "portal", label: "Portal" },
      ],
      onChange: onWorkspaceChange,
    };

    const { container } = renderLayout();
    const desktopSidebar = getDesktopSidebar(container);

    expect(screen.getByTestId("layout-topbar")).toHaveAttribute("data-show-workspace-switcher", "true");
    expect(within(desktopSidebar).queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
  });

  it("keeps the workspace switcher in the topbar when the sidebar is hidden", () => {
    mocks.workspaceSwitcherModel = {
      currentWorkspaceId: "browser",
      currentWorkspaceLabel: "Browser",
      options: [
        { value: "manager", label: "Manager" },
        { value: "browser", label: "Browser" },
      ],
      onChange: vi.fn(),
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<Layout headerTitle="Browser" hideHeader hideSidebar />}>
            <Route index element={<div>Browser content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(container.querySelector('[data-sidebar-variant="desktop"]')).not.toBeInTheDocument();
    expect(screen.getByTestId("layout-topbar")).toHaveAttribute("data-show-workspace-switcher", "true");
    expect(screen.getByText("Browser content")).toBeInTheDocument();
  });
});
