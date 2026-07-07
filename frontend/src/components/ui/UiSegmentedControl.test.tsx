import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import UiSegmentedControl from "./UiSegmentedControl";

describe("UiSegmentedControl", () => {
  const options = [
    { label: "24h", value: "day" },
    { label: "7d", value: "week" },
    { label: "30d", value: "month" },
  ] as const;

  it("marks the current option and calls back with the selected value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <UiSegmentedControl
        ariaLabel="Traffic window"
        options={[...options]}
        value="week"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("group", { name: "Traffic window" })).toHaveClass("ui-surface-muted");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "30d" }));

    expect(onChange).toHaveBeenCalledWith("month");
  });

  it("keeps disabled options inert", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <UiSegmentedControl
        options={[options[0], { ...options[1], disabled: true }, options[2]]}
        value="day"
        onChange={onChange}
      />,
    );

    const disabledOption = screen.getByRole("button", { name: "7d" });
    expect(disabledOption).toBeDisabled();

    await user.click(disabledOption);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses helper text as an option title", () => {
    render(
      <UiSegmentedControl
        options={[{ label: "7d", value: "week", helper: "Last 7 days" }]}
        value="week"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("title", "Last 7 days");
  });
});
