import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ConfirmActionDialog from "../ConfirmActionDialog";

describe("ConfirmActionDialog", () => {
  it("renders details and triggers callbacks", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmActionDialog
        title="Delete user"
        description="This action removes the UI user and its assignments."
        confirmLabel="Delete user"
        details={[
          { label: "Target", value: "ops@example.com" },
          { label: "Scope", value: "Admin", mono: true },
        ]}
        impacts={["Access to linked workspaces is removed."]}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog", { name: "Delete user" })).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText("Access to linked workspaces is removed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete user" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
