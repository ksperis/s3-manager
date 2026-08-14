import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkspaceNavCards from "../WorkspaceNavCards";

describe("WorkspaceNavCards", () => {
  it("renders navigation links with descriptions", () => {
    const { container } = render(
      <MemoryRouter>
        <WorkspaceNavCards
          columns={4}
          items={[
            {
              title: "Buckets",
              description: "Cross-account bucket listing and operations.",
              to: "/storage-ops/buckets",
            },
            {
              title: "Metrics",
              description: "Cluster-wide RGW activity overview.",
              to: "/ceph-admin/metrics",
              eyebrow: "Workspace",
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Buckets/i })).toHaveAttribute("href", "/storage-ops/buckets");
    expect(screen.getByText("Cross-account bucket listing and operations.")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
    expect(container.querySelector(".grid")).toHaveClass("xl:grid-cols-4");
  });
});
