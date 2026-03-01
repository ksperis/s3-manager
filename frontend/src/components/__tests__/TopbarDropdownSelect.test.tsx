import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import TopbarDropdownSelect from "../TopbarDropdownSelect";

const options = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "portal", label: "Portal" },
];

describe("TopbarDropdownSelect", () => {
  it("passes a11y checks [a11y]", async () => {
    const { container } = render(
      <TopbarDropdownSelect value="manager" options={options} onChange={() => undefined} ariaLabel="Select workspace" />
    );
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
});
