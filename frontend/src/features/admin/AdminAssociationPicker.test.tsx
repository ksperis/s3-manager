import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
} from "./AdminAssociationPicker";

describe("AdminAssociationPicker", () => {
  it("renders a reusable section header action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <AdminAssociationSectionHeader
        title="Linked users"
        countLabel="2 linked"
        actionLabel="Add users"
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add users" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders common search, states, and footer actions", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onCancel = vi.fn();
    const onAdd = vi.fn();

    render(
      <AdminAssociationPickerPanel
        title="Add accounts"
        hint="(search by name)"
        search=""
        onSearchChange={onSearchChange}
        loading={false}
        availableCount={1}
        maxVisibleOptions={10}
        selectedCount={1}
        loadingLabel="Loading accounts..."
        searchAriaLabel="Search accounts"
        addDisabled={false}
        onCancel={onCancel}
        onAdd={onAdd}
      >
        <div>Helios Retail</div>
      </AdminAssociationPickerPanel>
    );

    await user.type(screen.getByRole("textbox", { name: "Search accounts" }), "hel");
    expect(onSearchChange).toHaveBeenLastCalledWith("l");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Add selected" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
