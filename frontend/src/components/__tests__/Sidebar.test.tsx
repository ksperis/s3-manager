import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../Sidebar";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_MAX_WIDTH } from "../sidebarSizing";

describe("Sidebar", () => {
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

  it("renders a resize separator on desktop and no collapse button", () => {
    render(
      <MemoryRouter>
        <Sidebar
          width={256}
          onResizeStart={vi.fn()}
          onResizeKeyDown={vi.fn()}
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: /collapse sidebar|expand sidebar/i })).not.toBeInTheDocument();
    const separator = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(separator).toHaveAttribute("aria-valuemin", String(SIDEBAR_COMPACT_WIDTH));
    expect(separator).toHaveAttribute("aria-valuemax", String(SIDEBAR_MAX_WIDTH));
    expect(separator).toHaveAttribute("aria-valuenow", "256");
  });

  it("renders the collapse control when a collapse handler is provided", () => {
    const onCollapseToggle = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar
          width={232}
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

  it("renders the workspace switcher in the sidebar header", () => {
    const onWorkspaceChange = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar
          workspaceSwitcher={{
            currentWorkspaceId: "manager",
            currentWorkspaceLabel: "Manager",
            options: [
              { value: "manager", label: "Manager" },
              { value: "portal", label: "Portal" },
            ],
            onChange: onWorkspaceChange,
          }}
          sections={[
            {
              label: "Overview",
              links: [{ to: "/manager/metrics", label: "Metrics" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("option", { name: "Portal" }));
    expect(onWorkspaceChange).toHaveBeenCalledWith("portal");
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
});
