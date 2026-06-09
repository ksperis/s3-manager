import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../Sidebar";
import { SIDEBAR_DEFAULT_WIDTH } from "../sidebarSizing";

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

  it("renders custom content instead of navigation at a custom desktop width", () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar
          title="BROWSER"
          widthPx={280}
          contentLabel="Browser bucket navigation"
          content={<div>Bucket sidebar content</div>}
          sections={[
            {
              label: "Data",
              links: [{ to: "/browser", label: "Browser" }],
            },
          ]}
        />
      </MemoryRouter>
    );

    const sidebar = container.querySelector('[data-sidebar-variant="desktop"]') as HTMLElement;
    expect(sidebar).toHaveStyle({ width: "280px" });
    expect(screen.getByRole("region", { name: "Browser bucket navigation" })).toHaveTextContent("Bucket sidebar content");
    expect(screen.queryByRole("navigation", { name: "BROWSER navigation" })).not.toBeInTheDocument();
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
