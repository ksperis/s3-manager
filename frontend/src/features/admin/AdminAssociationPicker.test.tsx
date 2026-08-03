import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AdminAssociationLinkedTable,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
} from "./AdminAssociationPicker";

describe("AdminAssociationPicker", () => {
  it("renders the shared linked table and its picker action", () => {
    const onAction = vi.fn();
    render(
      <AdminAssociationLinkedTable
        title="Linked UI groups"
        countLabel="1 linked"
        actionLabel="Add UI groups"
        onAction={onAction}
        headers={[{ label: "Group" }, { label: "Actions", align: "right" }]}
        hasItems
        emptyLabel="No linked groups yet."
        rows={
          <tr>
            <td>Operators</td>
            <td>Remove</td>
          </tr>
        }
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Operators")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

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
