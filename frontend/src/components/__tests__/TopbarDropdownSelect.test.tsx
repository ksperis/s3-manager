import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import TopbarDropdownSelect from "../TopbarDropdownSelect";

const options = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "portal", label: "Portal" },
];

const searchableOptions = [
  ...options,
  { value: "browser", label: "Browser" },
  { value: "storage", label: "Storage Ops" },
  { value: "ceph", label: "Ceph Admin" },
  {
    value: "metrics",
    label: "Metrics",
    searchText: "observability special target",
  },
];

const search = {
  threshold: 6,
  ariaLabel: "Search workspaces",
  placeholder: "Search workspace...",
  emptyMessage: "No workspace matches your search.",
};

describe("TopbarDropdownSelect", () => {
  it("passes a11y checks [a11y]", async () => {
    const { container } = render(
      <TopbarDropdownSelect value="manager" options={options} onChange={() => undefined} ariaLabel="Select workspace" />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("passes a11y checks with the searchable menu open [a11y]", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TopbarDropdownSelect
        value="manager"
        options={searchableOptions}
        onChange={() => undefined}
        ariaLabel="Select workspace"
        search={search}
        openInPortal={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Select workspace" }));

    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports keyboard listbox navigation and selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TopbarDropdownSelect value="manager" options={options} onChange={onChange} ariaLabel="Select workspace" />);

    const trigger = screen.getByRole("button", { name: "Select workspace" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox", { name: "Select workspace" });
    expect(listbox).toBeInTheDocument();

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("portal");
    expect(trigger).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox", { name: "Select workspace" })).toBeInTheDocument();
  });

  it("renders the menu in document.body by default", () => {
    const { container } = render(
      <TopbarDropdownSelect value="manager" options={options} onChange={() => undefined} ariaLabel="Select workspace" />
    );
    const trigger = screen.getByRole("button", { name: "Select workspace" });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Select workspace" });
    expect(document.body.contains(listbox)).toBe(true);
    expect(container.contains(listbox)).toBe(false);
  });

  it("closes on Escape and restores focus to trigger", () => {
    render(<TopbarDropdownSelect value="manager" options={options} onChange={() => undefined} ariaLabel="Select workspace" />);

    const trigger = screen.getByRole("button", { name: "Select workspace" });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Select workspace" });
    fireEvent.keyDown(listbox, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Select workspace" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders option details in the menu and trigger addons for the selected value", () => {
    render(
      <TopbarDropdownSelect
        value="manager"
        options={[
          {
            value: "manager",
            label: "Manager",
            inlineAddon: <span>inline-tag</span>,
            details: <span>primary-tag</span>,
            triggerAddon: <span>selected-tag</span>,
          },
          { value: "portal", label: "Portal" },
        ]}
        onChange={() => undefined}
        ariaLabel="Select workspace"
      />
    );

    const trigger = screen.getByRole("button", { name: "Select workspace" });
    const valueSlot = trigger.querySelector('[data-slot="topbar-trigger-value"]');
    const addonSlot = trigger.querySelector('[data-slot="topbar-trigger-addon"]');
    expect(valueSlot).toHaveTextContent("Manager");
    expect(addonSlot).toHaveTextContent("selected-tag");
    expect(addonSlot).toHaveClass("items-center");
    expect(trigger).toHaveTextContent("selected-tag");

    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Select workspace" });
    expect(within(listbox).getByText("inline-tag")).toBeInTheDocument();
    expect(within(listbox).getByText("primary-tag")).toBeInTheDocument();
  });

  it("keeps opt-in search hidden at the configured threshold", async () => {
    const user = userEvent.setup();
    render(
      <TopbarDropdownSelect
        value="manager"
        options={options}
        onChange={() => undefined}
        ariaLabel="Select workspace"
        search={search}
      />
    );

    await user.click(screen.getByRole("button", { name: "Select workspace" }));

    expect(
      screen.queryByRole("searchbox", { name: "Search workspaces" })
    ).not.toBeInTheDocument();
  });

  it("filters optional search text, selects filtered results, and resets its query", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TopbarDropdownSelect
        value="manager"
        options={searchableOptions}
        onChange={onChange}
        ariaLabel="Select workspace"
        search={search}
      />
    );

    const trigger = screen.getByRole("button", { name: "Select workspace" });
    await user.click(trigger);
    const searchbox = screen.getByRole("searchbox", {
      name: "Search workspaces",
    });
    await user.type(searchbox, "SPECIAL");

    const listbox = screen.getByRole("listbox", { name: "Select workspace" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option")).toHaveTextContent("Metrics");

    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("metrics");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const reopenedSearchbox = screen.getByRole("searchbox", {
      name: "Search workspaces",
    });
    expect(reopenedSearchbox).toHaveValue("");
    await user.type(reopenedSearchbox, "missing");
    expect(
      screen.getByText("No workspace matches your search.")
    ).toBeInTheDocument();

    fireEvent.keyDown(reopenedSearchbox, { key: "Escape" });
    expect(
      screen.queryByRole("listbox", { name: "Select workspace" })
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
