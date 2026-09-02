import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ManagedPolicySelectionPanel from "./ManagedPolicySelectionPanel";

const policies = [
  { name: "ReadOnlyAccess", arn: "arn:aws:iam::aws:policy/ReadOnlyAccess" },
  { name: "StorageAdmin", arn: "arn:aws:iam::tenant:policy/StorageAdmin" },
];

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof ManagedPolicySelectionPanel>> = {}
) => {
  const props: React.ComponentProps<typeof ManagedPolicySelectionPanel> = {
    title: "Attach policies",
    description: "Select policies to attach immediately.",
    emptyMessage: "No policies available.",
    footer: "Policies can also be attached later.",
    policies,
    selectedPolicyArns: [],
    search: "",
    expanded: true,
    onSearchChange: vi.fn(),
    onExpandedChange: vi.fn(),
    onSelectionChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<ManagedPolicySelectionPanel {...props} />), props };
};

describe("ManagedPolicySelectionPanel", () => {
  it("filters policies by name or ARN", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const { rerender, props } = renderPanel({ onSearchChange });

    await user.type(
      screen.getByPlaceholderText("Search policies by name or ARN"),
      "tenant"
    );
    expect(onSearchChange).toHaveBeenCalled();

    rerender(<ManagedPolicySelectionPanel {...props} search="tenant" />);
    expect(screen.queryByText("ReadOnlyAccess")).not.toBeInTheDocument();
    expect(screen.getByText("StorageAdmin")).toBeInTheDocument();
  });

  it("delegates expansion and ordered selection changes", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    const onSelectionChange = vi.fn();
    renderPanel({
      selectedPolicyArns: [policies[0].arn],
      onExpandedChange,
      onSelectionChange,
    });

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("checkbox", { name: "StorageAdmin" }));
    expect(onSelectionChange).toHaveBeenCalledWith([
      policies[0].arn,
      policies[1].arn,
    ]);
    await user.click(screen.getByRole("checkbox", { name: "ReadOnlyAccess" }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it("keeps the empty-state guidance inside the expanded panel", () => {
    renderPanel({ policies: [] });

    expect(screen.getByText("No policies available.")).toBeInTheDocument();
    expect(screen.getByText("Policies can also be attached later.")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Search policies by name or ARN")
    ).not.toBeInTheDocument();
  });
});
