import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AccountAccessRoleSelectors from "./AccountAccessRoleSelectors";

describe("AccountAccessRoleSelectors", () => {
  it("names both authorization axes visibly", () => {
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        portalEnabled
        value={{ manager_role: null, portal_role: "portal_user" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Portal")).toBeInTheDocument();
  });

  it("highlights assigned Manager and Portal roles", () => {
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        portalEnabled
        value={{ manager_role: "account_administrator", portal_role: "portal_user" }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
    ).toHaveClass("bg-amber-50", "font-semibold");
    expect(
      screen.getByRole("combobox", { name: "Portal role for Research Archive" }),
    ).toHaveClass("bg-sky-50", "font-semibold");
  });

  it("explains why a preserved Portal role is read-only", () => {
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        portalEnabled={false}
        value={{ manager_role: null, portal_role: "portal_manager" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Portal · read-only")).toBeInTheDocument();
    expect(
      screen.getByText("Portal is off; existing roles are preserved."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Portal role for Research Archive" }),
    ).toBeDisabled();
    const managerSelect = screen.getByRole("combobox", {
      name: "Manager role for Research Archive",
    });
    expect(
      within(managerSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeDisabled();
  });

  it("allows an empty draft but explains that it cannot be saved", () => {
    const onChange = vi.fn();
    render(
      <AccountAccessRoleSelectors
        label="Research Archive"
        portalEnabled
        value={{ manager_role: "account_administrator", portal_role: null }}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
      { target: { value: "" } },
    );

    expect(onChange).toHaveBeenCalledWith({
      manager_role: null,
      portal_role: null,
      allow_manager_browser_data_access: false,
    });

    render(
      <AccountAccessRoleSelectors
        label="Empty association"
        portalEnabled
        value={{ manager_role: null, portal_role: null }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Choose at least one role for this association."),
    ).toBeInTheDocument();
  });

  it("prevents clearing the Manager role while Portal is off", () => {
    const onChange = vi.fn();
    render(
      <AccountAccessRoleSelectors
        label="Empty association"
        portalEnabled={false}
        value={{ manager_role: "account_administrator", portal_role: null }}
        onChange={onChange}
      />,
    );

    const managerSelect = screen.getByRole("combobox", {
      name: "Manager role for Empty association",
    });
    expect(
      within(managerSelect).getByRole("option", { name: "No Manager access" }),
    ).toBeDisabled();

    fireEvent.change(managerSelect, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits only API grant fields when the displayed value contains row metadata", () => {
    const onChange = vi.fn();
    const value = {
      id: 7,
      label: "Research Archive",
      manager_role: "account_administrator" as const,
      portal_role: "portal_user" as const,
      allow_manager_browser_data_access: true,
    };
    render(
      <AccountAccessRoleSelectors
        label={value.label}
        portalEnabled
        value={value}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Manager role for Research Archive" }),
      { target: { value: "" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Portal role for Research Archive" }),
      { target: { value: "portal_manager" } },
    );

    expect(onChange).toHaveBeenNthCalledWith(1, {
      manager_role: null,
      portal_role: "portal_user",
      allow_manager_browser_data_access: false,
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      manager_role: "account_administrator",
      portal_role: "portal_manager",
      allow_manager_browser_data_access: true,
    });
  });
});
