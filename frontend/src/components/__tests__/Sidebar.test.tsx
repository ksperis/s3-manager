import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import Sidebar, { resolveSidebarLinkIconName } from "../Sidebar";
import { SIDEBAR_DEFAULT_WIDTH } from "../sidebarSizing";

describe("Sidebar", () => {
  it("uses specific icons for admin navigation labels instead of the generic dot", () => {
    const adminLinks = [
      { to: "/admin/billing", label: "Billing", iconName: "wallet" },
      { to: "/admin/usage-history", label: "Usage History", iconName: "history" },
      { to: "/admin/audit", label: "Audit trail", iconName: "audit" },
      { to: "/admin/s3-connections", label: "Shared S3 Connections", iconName: "connection" },
      { to: "/admin/storage-endpoints", label: "S3 Endpoints", iconName: "endpoint" },
      { to: "/admin/endpoint-status", label: "Endpoint Status", iconName: "status" },
      { to: "/admin/portal-settings", label: "Portal", iconName: "portal" },
      { to: "/admin/key-rotation", label: "Key Rotation", iconName: "key" },
    ] as const;

    adminLinks.forEach((link) => {
      expect(resolveSidebarLinkIconName(link)).toBe(link.iconName);
      expect(resolveSidebarLinkIconName(link)).not.toBe("dot");
    });
  });

  it("uses disabledHint as title for disabled links", () => {
    render(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Data",
              links: [
                {
                  to: "/ceph-admin/browser",
                  label: "Browser",
                  disabled: true,
                  disabledHint: "Open the bucket from the Buckets list.",
                },
              ],
            },
          ]}
        />
      </MemoryRouter>
    );

    const disabledLink = screen.getByTitle("Open the bucket from the Buckets list.");
    expect(disabledLink).toHaveAttribute("aria-disabled", "true");
  });

  it("uses a generic fallback hint when disabledHint is not provided", () => {
    render(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics", disabled: true }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Unavailable in current context.")).toBeInTheDocument();
  });

  it("keeps disabledHint title in compact mode", () => {
    render(
      <MemoryRouter>
        <Sidebar
          compact
          sections={[
            {
              label: "Data",
              links: [
                {
                  to: "/ceph-admin/browser",
                  label: "Browser",
                  disabled: true,
                  disabledHint: "Open the bucket from the Buckets list.",
                },
              ],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Open the bucket from the Buckets list.")).toBeInTheDocument();
    expect(screen.getByLabelText("Browser")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the generic fallback hint in compact mode when disabledHint is missing", () => {
    render(
      <MemoryRouter>
        <Sidebar
          compact
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics", disabled: true }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Unavailable in current context.")).toBeInTheDocument();
  });

  it("renders a fixed desktop sidebar without a resize separator", () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    const sidebar = container.querySelector('[data-sidebar-variant="desktop"]') as HTMLElement;
    expect(sidebar).toHaveStyle({ width: `${SIDEBAR_DEFAULT_WIDTH}px` });
    expect(screen.getByText("S3 Manager")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse sidebar|expand sidebar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
  });

  it("renders the collapse control when a collapse handler is provided", () => {
    const onCollapseToggle = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar
          onCollapseToggle={onCollapseToggle}
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapseToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps shared chrome and collapse controls around a custom body", () => {
    const onCollapseToggle = vi.fn();
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar
          onCollapseToggle={onCollapseToggle}
          onNavigate={onNavigate}
          renderSidebarBody={({ compact, variant, closeMobile }) => (
            <button type="button" onClick={closeMobile}>
              {variant} {compact ? "compact" : "expanded"} browser body
            </button>
          )}
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("S3 Manager")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "desktop expanded browser body" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Metrics" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "desktop expanded browser body" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapseToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the brand header but keeps workspace selectors out of the sidebar", () => {
    render(
      <MemoryRouter>
        <Sidebar
          title="MANAGER"
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("S3 Manager")).toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "MANAGER navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
  });

  it("keeps compact links titled and labeled for assistive tech", () => {
    render(
      <MemoryRouter>
        <Sidebar
          compact
          sections={[
            {
              label: "Data",
              links: [{ to: "/browser", label: "Browser" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Browser")).toBeInTheDocument();
    expect(screen.getByLabelText("Browser")).toHaveAttribute("href", "/browser");
  });

  it("renders footer content below navigation on desktop", () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Overview",
              links: [{ to: "/portal", label: "Dashboard" }],
            },
          ]}
          footer={<div>Portal account footer</div>}
        />
      </MemoryRouter>
    );

    const sidebar = container.querySelector('[data-sidebar-variant="desktop"]') as HTMLElement;
    expect(sidebar).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "s3-manager navigation" });
    const footer = screen.getByText("Portal account footer");
    expect(nav.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders footer content in the mobile sidebar variant", () => {
    render(
      <MemoryRouter>
        <Sidebar
          variant="mobile"
          sections={[
            {
              label: "Overview",
              links: [{ to: "/portal", label: "Dashboard" }],
            },
          ]}
          footer={<div>Mobile portal account footer</div>}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Mobile portal account footer")).toBeInTheDocument();
  });

  it("opens a collapsed section when parent navigation marks it expanded", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Settings",
              collapsed: true,
              links: [{ to: "/admin/general-settings", label: "General" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: "General" })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Sidebar
          sections={[
            {
              label: "Settings",
              collapsed: false,
              links: [{ to: "/admin/general-settings", label: "General" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/admin/general-settings");
  });

  it("scrolls the active desktop navigation link into view", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <MemoryRouter initialEntries={["/admin/general-settings"]}>
        <Sidebar
          sections={[
            {
              label: "Settings",
              collapsed: false,
              links: [{ to: "/admin/general-settings", label: "General" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
