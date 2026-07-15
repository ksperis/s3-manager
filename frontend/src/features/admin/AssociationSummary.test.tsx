import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssociationPrincipalStack, CompactAssociationSummary } from "./AssociationSummary";

describe("AssociationPrincipalStack", () => {
  it("merges users and groups into one complete role-aware tooltip", () => {
    const { container } = render(
      <AssociationPrincipalStack
        items={[
          {
            id: 1,
            kind: "user",
            label: "Alice Example",
            email: "alice@example.com",
            avatar: { preference: "initials", source: "initials", initials: "AE" },
            account_role: "portal_user",
          },
          {
            id: 2,
            kind: "group",
            label: "Storage Operators",
            avatar: { source: "preset", initials: "SO", icon: "users" },
            account_admin: true,
          },
        ]}
      />,
    );

    const tooltip = screen.getByLabelText("2 linked principals");
    expect(tooltip).toHaveAccessibleDescription(
      "Linked principals (2)\nAlice Example · alice@example.com — Roles: Portal user, UI user\nStorage Operators — Roles: Account admin, UI group",
    );
    expect(tooltip).toBeInTheDocument();
    expect(container.querySelector(".rounded-lg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit UI user Alice Example" })).toHaveAttribute(
      "href",
      "/admin/users?edit=1&search=alice%40example.com",
    );
    expect(screen.getByRole("link", { name: "Edit UI group Storage Operators" })).toHaveAttribute(
      "href",
      "/admin/groups?edit=2&search=Storage+Operators",
    );
    fireEvent.mouseEnter(tooltip);
    const visualTooltip = screen.getByRole("tooltip", { name: "Linked principals details" });
    expect(visualTooltip.parentElement).toHaveClass("w-96", "p-2");
    expect(within(visualTooltip).getByText("Portal user")).toBeInTheDocument();
    expect(within(visualTooltip).getByText("Portal user")).toHaveClass("text-[9px]");
    expect(within(visualTooltip).getByText("Account admin")).toBeInTheDocument();
  });

  it("bounds very long tooltip lists and reports the remaining principals", () => {
    render(
      <AssociationPrincipalStack
        tooltipLimit={2}
        maxVisible={2}
        items={[
          { id: 1, kind: "user", label: "Alice", email: "alice@example.com", account_role: "portal_user" },
          { id: 2, kind: "group", label: "Operators", account_admin: true },
          { id: 3, kind: "user", label: "Charlie", email: "charlie@example.com" },
        ]}
      />,
    );

    const tooltip = screen.getByLabelText("3 linked principals");
    expect(tooltip).toHaveAccessibleDescription(
      "Linked principals (3)\nAlice · alice@example.com — Roles: Portal user, UI user\nOperators — Roles: Account admin, UI group\n… 1 more",
    );
    expect(tooltip).toBeInTheDocument();
    fireEvent.mouseEnter(tooltip);
    const visualTooltip = screen.getByRole("tooltip", { name: "Linked principals details" });
    expect(within(visualTooltip).queryByText(/Charlie/)).not.toBeInTheDocument();
    expect(within(visualTooltip).getByText("+1 more entry")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows five principals by default before collapsing the remainder", () => {
    render(
      <AssociationPrincipalStack
        items={Array.from({ length: 7 }, (_, index) => ({
          id: index + 1,
          kind: "user" as const,
          label: `User ${index + 1}`,
          email: `user-${index + 1}@example.com`,
        }))}
      />,
    );

    const stack = screen.getByLabelText("7 linked principals");
    expect(within(stack).getAllByRole("link")).toHaveLength(5);
    expect(within(stack).getByText("+2")).toBeInTheDocument();
  });

  it("renders three category badges and bounds the complete association tooltip", () => {
    render(
      <CompactAssociationSummary
        tooltipLimit={3}
        categories={[
          {
            id: "accounts",
            label: "Accounts",
            itemLabel: "RGW account",
            items: [
              { id: 1, label: "Research", role_labels: ["Account admin", "Portal manager"] },
              { id: 2, label: "Archive", role_labels: ["Member"] },
            ],
          },
          {
            id: "s3_users",
            label: "RGW users",
            itemLabel: "RGW user",
            items: [{ id: 3, label: "research-user", role_labels: ["Direct access"] }],
          },
          {
            id: "connections",
            label: "S3 connections",
            itemLabel: "S3 connection",
            items: [{ id: 4, label: "shared-main", role_labels: ["Manager", "Browser"] }],
          },
        ]}
      />,
    );

    const summary = screen.getByLabelText("4 linked associations");
    expect(summary).toHaveAccessibleDescription(
      "Linked associations (4)\nRGW account: Research — Roles: Account admin, Portal manager\nRGW account: Archive — Roles: Member\nRGW user: research-user — Roles: Direct access\n… 1 more",
    );
    fireEvent.focus(summary);
    const visualTooltip = screen.getByRole("tooltip", { name: "Linked associations details" });
    expect(within(visualTooltip).getByText("Portal manager")).toBeInTheDocument();
    expect(within(visualTooltip).getByText("+1 more entry")).toBeInTheDocument();
    expect(screen.getByLabelText("2 accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("1 rgw users")).toBeInTheDocument();
    expect(screen.getByLabelText("1 s3 connections")).toBeInTheDocument();
  });
});
