import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortalAccessKeysPage, PortalGroupsPage, PortalPoliciesPage, PortalUsersPage } from "./PortalAdminMockPages";

const workspace = {
  adminUsers: [{ username: "alice", groups: "research", status: "Active", mfa: "Enabled", lastActive: "2m ago" }],
  groups: [{ name: "research", users: 4, policies: 3, description: "Research team members" }],
  policies: [{ name: "read-only", type: "Managed", usedBy: "3 groups", lastModified: "May 10, 2024" }],
  accessKeys: [{ name: "AKIA********34LF", owner: "alice", status: "Active", created: "May 1, 2024", lastUsed: "2m ago" }],
};

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({ workspace }),
}));

describe("Portal admin mock pages", () => {
  it("renders read-only administration pages without advanced technical details", () => {
    render(
      <>
        <PortalUsersPage />
        <PortalGroupsPage />
        <PortalPoliciesPage />
        <PortalAccessKeysPage />
      </>
    );

    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policies" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access Keys" })).toBeInTheDocument();
    expect(screen.queryByText(/policy JSON/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ARN/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostics/i)).not.toBeInTheDocument();
  });
});
