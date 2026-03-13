import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Sidebar from "../Sidebar";

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
});
