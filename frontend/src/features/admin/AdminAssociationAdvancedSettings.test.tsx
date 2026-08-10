import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";

describe("AdminAssociationAdvancedSettings", () => {
  it("keeps a local draft and applies the Manager Browser permission explicitly", () => {
    const onApply = vi.fn();
    render(
      <AdminAssociationAdvancedSettings
        targetLabel="Production account"
        associationKind="account"
        allowManagerBrowserDataAccess={false}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText("Advanced association settings")).toBeInTheDocument();
    expect(screen.getByText(/same association also has the Account administrator role/)).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Allow Manager Browser data access" });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("checkbox", { name: "Allow Manager Browser data access" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow Manager Browser data access" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(true);
  });
});
