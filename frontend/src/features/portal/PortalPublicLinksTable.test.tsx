import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PortalPublicLinksTable from "./PortalPublicLinksTable";

const publicLink = {
  id: 1,
  storage_space_id: "space-1",
  storage_space_name: "Research data",
  object_key: "reports/2026/report.csv",
  object_name: "report.csv",
  url: "https://storage.example.test/public-links/a-very-long-public-link-token-that-must-not-overlap-actions/download",
  created_at: "2026-08-01T10:00:00Z",
  expires_at: null,
  status: "Active",
};

describe("PortalPublicLinksTable", () => {
  it("constrains long URLs before the action buttons in drawer layouts", () => {
    render(
      <PortalPublicLinksTable
        links={[publicLink]}
        status="ready"
        emptyMessage="No public links"
        fitContainer
        onCopy={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    const url = screen.getByTitle(publicLink.url);
    const table = url.closest("table");
    expect(url).toHaveClass("block", "min-w-0", "truncate");
    expect(url.closest("td")).toHaveClass("min-w-0", "max-w-0");
    expect(table).toHaveClass("!table-fixed", "!w-full");
    expect(table?.parentElement).toHaveClass("overflow-x-hidden");

    const actions = screen.getByRole("columnheader", { name: "Action" });
    expect(actions).not.toHaveAttribute("data-table-actions");
    expect(within(screen.getByRole("row", { name: /report.csv/ })).getByRole("button", { name: "Copy link" }))
      .toBeInTheDocument();
  });
});
