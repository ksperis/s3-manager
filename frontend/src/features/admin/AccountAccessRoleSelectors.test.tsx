import { fireEvent, render, screen } from "@testing-library/react";
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

  it("does not suggest a Portal role while Portal is off", () => {
    render(
      <AccountAccessRoleSelectors
        label="Empty association"
        portalEnabled={false}
        value={{ manager_role: null, portal_role: null }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Choose a Manager role; Portal is off.")).toBeInTheDocument();
  });

});
